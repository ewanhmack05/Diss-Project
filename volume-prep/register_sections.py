"""Lines up converted serial sections so they stack into a volume, then writes
each one out already lined up, all on one canvas.

Works on a small copy of each section, its longest side about WORK_SIZE pixels
(1/16 scale on the EPFL liver set, about 4.4 um a pixel). For each section and the next one:

- RootSIFT features on the tissue, matched both ways with a ratio test. RANSAC
  picks the matches that agree, and a rigid transform (turn and shift) is
  fitted to those. That needs MIN_INLIERS matches that agree. Neighbouring liver sections give 48-165;
  sections far apart or across a gap give 3-17, which is noise.
- Below that the link is a gap: the cuts either side don't share structure,
  so only the outline of the tissue is lined up (moments, then ECC on the
  blurred tissue masks). On pairs where features work, outline alignment lands
  27-271 um from the feature result, so a gap link is only good to a few hundred
  microns and is recorded as one.

Each section is then chained to the middle one and everything goes on a canvas
big enough for all of them. With --write, libvips applies each transform to
the full-resolution section and saves the result as a tiled pyramid.

Measures what it did and saves it in registration.json: inliers and median
residual for each link, a skip-one check (i to i+2 straight, against i to i+1
to i+2 chained - an independent error estimate needing no landmarks), and how
much neighbouring tissue overlaps before and after.

    python volume-prep/register_sections.py --sections ../zstack-data/liver/converted \\
        --out ../zstack-data/liver/registered --vips ../zstack-data/tools/vips-dev-8.18/bin --write
"""
import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import cv2
import numpy as np

# How big the working copies are: the biggest section's longest side comes
# out about this many pixels, at a power-of-two downsample so it lines up with
# the pyramid's own levels. The EPFL liver (32430 px) gets 16 - about 4.4 um a
# pixel, which is what the matching was tuned on. Bigger sets get a bigger
# downsample, so 260 sections still fit in memory.
WORK_SIZE = 2000
# Previews are for looking at, not measuring: at most this many frames, this wide.
PREVIEW_FRAMES = 60
PREVIEW_SIZE = 600
MIN_INLIERS = 30
RATIO = 0.8
RANSAC_PX = 3.0
SATURATION = 25
N_FEATURES = 20000
# Guided matching, for links where features alone don't agree enough: the
# outline says roughly where each feature should land, and only matches within
# this distance of that count. On Kartasalo's liver - uniform tissue, so the
# usual ratio test throws most matches out as ambiguous - it took the median
# landmark error from 68 um (outline only) to 41 um.
GUIDED_RADIUS_UM = 300
GUIDED_RATIO = 0.9
GUIDED_MIN_INLIERS = 5
# Outline alignment tries every rotation this many degrees apart, not just the
# tissue's main axis and its flip - a near-symmetric piece fooled that.
OUTLINE_STEP_DEGREES = 5
RESULT = "registration.json"
# Reading the written pyramid back goes through JPEG and a second resample, so
# overlap moves a little. A wrong transform moves it by tenths.
WRITTEN_TOLERANCE = 0.02


@dataclass
class Link:
    a: int
    b: int
    kind: str  # "features", "guided" or "gap"
    matches: int
    inliers: int
    residual_um: float | None
    rotation_deg: float
    scale: float
    dice_before: float
    dice_after: float
    skip_one_um: float | None = None


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--sections", required=True, type=Path, help="folder with convert_sections.py's .tif files and manifest.json")
    parser.add_argument("--out", required=True, type=Path, help="folder for registration.json, previews and registered .tif files")
    parser.add_argument("--vips", type=Path, help="folder with the vips and vipsheader executables (needed for --write)")
    parser.add_argument("--write", action="store_true", help="also write the full-resolution registered sections")
    parser.add_argument("--quality", type=int, default=85, help="JPEG quality of the written tiles (default: %(default)s)")
    parser.add_argument("--downsample", type=int, help="working scale, e.g. 16 (default: worked out from the sections' size)")
    parser.add_argument("--guided", action="store_true",
                        help="where features alone fail, try again near where the outline puts them, and call the "
                             "link guided rather than a gap - only for sets with no missing cuts, since a gap "
                             "means cuts are missing")
    parser.add_argument("--clahe", action="store_true",
                        help="even out staining (CLAHE) before finding features - for sections stained very differently")
    parser.add_argument("--section-microns", type=float,
                        help="how thick each section was cut, if known - saved for the 3D view, which assumes 4 otherwise")
    args = parser.parse_args(argv)
    if args.write and args.vips is None:
        parser.error("--write needs --vips")
    return args


# ---- geometry: plain numpy, no images ----

def working_downsample(widths, heights, target=WORK_SIZE):
    """The power of two that brings the biggest section's longest side nearest target."""
    longest = max(max(widths), max(heights))
    if longest <= target:
        return 1
    return int(2 ** round(np.log2(longest / target)))

def as_3x3(m):
    return np.vstack([np.asarray(m, dtype=np.float64)[:2], [0.0, 0.0, 1.0]])


def to_full_res(m, downsample):
    """A transform found on the 1/downsample copies, for the full-size sections.
    x_small = x_full / d, so x_full -> d * (A x_full / d + t) = A x_full + d t."""
    full = as_3x3(m).copy()
    full[:2, 2] *= downsample
    return full


def chain_to_reference(pair_transforms, reference):
    """pair_transforms[i] maps section i onto section i+1. Gives, for every
    section, the transform onto the reference section."""
    n = len(pair_transforms) + 1
    to_ref = [None] * n
    to_ref[reference] = np.eye(3)
    for i in range(reference - 1, -1, -1):
        to_ref[i] = to_ref[i + 1] @ as_3x3(pair_transforms[i])
    for i in range(reference + 1, n):
        to_ref[i] = to_ref[i - 1] @ np.linalg.inv(as_3x3(pair_transforms[i - 1]))
    return to_ref


def canvas_for(sizes, transforms):
    """Smallest canvas holding every transformed section, and the shift that puts
    its top left corner at 0,0. Returns (width, height, shifted transforms)."""
    corners = []
    for (w, h), t in zip(sizes, transforms):
        box = np.array([[0, 0, 1], [w, 0, 1], [0, h, 1], [w, h, 1]], dtype=np.float64).T
        corners.append((t @ box)[:2].T)
    corners = np.vstack(corners)
    low = np.floor(corners.min(axis=0))
    high = np.ceil(corners.max(axis=0))
    shift = np.array([[1, 0, -low[0]], [0, 1, -low[1]], [0, 0, 1]], dtype=np.float64)
    width, height = (high - low).astype(int)
    return int(width), int(height), [shift @ t for t in transforms]


def rotation_and_scale(m):
    m = np.asarray(m, dtype=np.float64)
    return float(np.degrees(np.arctan2(m[1, 0], m[0, 0]))), float(np.sqrt(abs(np.linalg.det(m[:2, :2]))))


def mean_displacement(m1, m2, points):
    """Mean distance between where two transforms send the same points."""
    p = np.asarray(points, dtype=np.float64)
    d = (p @ as_3x3(m1)[:2, :2].T + as_3x3(m1)[:2, 2]) - (p @ as_3x3(m2)[:2, :2].T + as_3x3(m2)[:2, 2])
    return float(np.linalg.norm(d, axis=1).mean())


def dice(a, b):
    a, b = a.astype(bool), b.astype(bool)
    total = a.sum() + b.sum()
    return float(2 * (a & b).sum() / total) if total else 1.0


def vips_affine_args(vips, source, target, m, width, height, background):
    """libvips' affine sends input x to a*x + b*y + odx (and the same for y), and
    --oarea picks which part of that output to keep - the canvas."""
    # float() first: numpy 2's repr of its own floats is "np.float64(0.98)", which libvips can't read.
    a, b, odx, c, d, ody = (repr(float(v)) for v in as_3x3(m)[:2].ravel())
    exe = str(Path(vips) / ("vips.exe" if os.name == "nt" else "vips"))
    return [exe, "affine", str(source), str(target),
            # The leading space: a section turned past 90 degrees starts with a minus, and
            # vips' option parser takes any argument starting "-" for an option.
            f" {a} {b} {c} {d}",
            "--odx", odx, "--ody", ody,
            "--oarea", f"0 0 {width} {height}",
            "--interpolate", "bilinear",
            "--extend", "background", "--background", " ".join(str(int(c)) for c in background)]


# ---- images ----

def tissue_mask(rgb):
    """Stained tissue is coloured, the glass is grey, so saturation picks it out."""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    mask = (hsv[..., 1] > SATURATION).astype(np.uint8)
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))


def background_colour(rgb, mask):
    glass = rgb[mask == 0]
    return tuple(int(c) for c in np.median(glass, axis=0)) if len(glass) else (255, 255, 255)


def feature_image(rgb, clahe=False):
    """What features are found on: grey, or with clahe, contrast evened out tile by tile and
    slightly blurred - so a pale section and a dark one look alike, and features are cell
    clusters rather than single nuclei."""
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    if not clahe:
        return gray
    gray = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8)).apply(gray)
    return cv2.GaussianBlur(gray, (0, 0), 2)


def rootsift(rgb, mask, clahe=False):
    """SIFT with each descriptor L1-normalised and square-rooted (Arandjelovic and
    Zisserman 2012), which matches better than plain SIFT for the same cost."""
    gray = feature_image(rgb, clahe)
    keypoints, descriptors = cv2.SIFT_create(nfeatures=N_FEATURES).detectAndCompute(gray, mask)
    points = np.float32([k.pt for k in keypoints]).reshape(-1, 2)
    if descriptors is None:
        return points, np.zeros((0, 128), np.float32)
    descriptors = descriptors / (descriptors.sum(axis=1, keepdims=True) + 1e-7)
    return points, np.sqrt(descriptors).astype(np.float32)


def mutual_matches(features_a, features_b):
    """Matches that pass the ratio test both ways round."""
    (points_a, desc_a), (points_b, desc_b) = features_a, features_b
    if len(desc_a) < 2 or len(desc_b) < 2:
        return np.zeros((0, 2), np.float32), np.zeros((0, 2), np.float32)
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    back = {m.queryIdx: m.trainIdx for m, n in matcher.knnMatch(desc_b, desc_a, k=2) if m.distance < RATIO * n.distance}
    good = [m for m, n in matcher.knnMatch(desc_a, desc_b, k=2)
            if m.distance < RATIO * n.distance and back.get(m.trainIdx) == m.queryIdx]
    return points_a[[m.queryIdx for m in good]], points_b[[m.trainIdx for m in good]]


def rigid_fit(src, dst):
    """Least-squares rotation and shift (no scale, no mirror) taking src onto dst - Kabsch."""
    src, dst = np.asarray(src, dtype=np.float64), np.asarray(dst, dtype=np.float64)
    centre_src, centre_dst = src.mean(axis=0), dst.mean(axis=0)
    u, _, vt = np.linalg.svd((src - centre_src).T @ (dst - centre_dst))
    mirror = np.sign(np.linalg.det(vt.T @ u.T))
    rot = vt.T @ np.diag([1.0, mirror]) @ u.T
    return np.hstack([rot, (centre_dst - rot @ centre_src)[:, None]])


def feature_transform(features_a, features_b):
    """Rigid transform from a to b, the matches it used, how many agreed, and their median residual.
    RANSAC on a similarity transform picks which matches agree; the transform itself is then refitted
    rigid on those. Sections cut from one block don't change scale, and leaving scale free let it
    drift 1.5% - 80 um across a section - which doubled the skip-one error on the liver set."""
    src, dst = mutual_matches(features_a, features_b)
    if len(src) < 3:
        return None, len(src), 0, None
    m, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=RANSAC_PX,
                                             maxIters=10000, confidence=0.999)
    if m is None:
        return None, len(src), 0, None
    keep = inliers.ravel().astype(bool)
    if keep.sum() < 2:
        return None, len(src), int(keep.sum()), None
    m = rigid_fit(src[keep], dst[keep])
    residual = np.linalg.norm(src[keep] @ m[:, :2].T + m[:, 2] - dst[keep], axis=1)
    return m, len(src), int(keep.sum()), float(np.median(residual))


def guided_transform(features_a, features_b, rough, radius_px):
    """Rigid transform from a to b using only matches that land near where rough puts them.
    A looser, one-way ratio test than mutual_matches, since rough does the job of throwing
    out the wrong ones. Same return as feature_transform."""
    (points_a, desc_a), (points_b, desc_b) = features_a, features_b
    if len(desc_a) < 2 or len(desc_b) < 2:
        return None, 0, 0, None
    pairs = [m for m, n in (p for p in cv2.BFMatcher(cv2.NORM_L2).knnMatch(desc_a, desc_b, k=2) if len(p) == 2)
             if m.distance < GUIDED_RATIO * n.distance]
    if len(pairs) < 3:
        return None, len(pairs), 0, None
    src = points_a[[m.queryIdx for m in pairs]]
    dst = points_b[[m.trainIdx for m in pairs]]
    rough = np.asarray(rough, dtype=np.float64)[:2]
    near = np.linalg.norm(src @ rough[:, :2].T + rough[:, 2] - dst, axis=1) <= radius_px
    if near.sum() < 3:
        return None, len(pairs), int(near.sum()), None
    src, dst = src[near], dst[near]
    m, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=RANSAC_PX,
                                             maxIters=10000, confidence=0.999)
    if m is None:
        return None, len(pairs), 0, None
    keep = inliers.ravel().astype(bool)
    if keep.sum() < 2:
        return None, len(pairs), int(keep.sum()), None
    m = rigid_fit(src[keep], dst[keep])
    residual = np.linalg.norm(src[keep] @ m[:, :2].T + m[:, 2] - dst[keep], axis=1)
    return m, len(pairs), int(keep.sum()), float(np.median(residual))


def outline_transform(mask_a, mask_b):
    """Rigid transform from a to b using only the tissue's outline: centroids together, every
    rotation OUTLINE_STEP_DEGREES apart (and the main axes both ways round), the best overlap,
    then ECC on blurred masks."""
    def centre_and_angle(mask):
        mo = cv2.moments(mask, binaryImage=True)
        centre = np.array([mo["m10"] / mo["m00"], mo["m01"] / mo["m00"]])
        return centre, 0.5 * np.arctan2(2 * mo["mu11"], mo["mu20"] - mo["mu02"])

    (centre_a, angle_a), (centre_b, angle_b) = centre_and_angle(mask_a), centre_and_angle(mask_b)
    size = (mask_b.shape[1], mask_b.shape[0])
    best = None
    candidates = [angle_b - angle_a, angle_b - angle_a + np.pi]
    candidates += list(np.radians(np.arange(0, 360, OUTLINE_STEP_DEGREES)))
    for r in candidates:
        rot = np.array([[np.cos(r), -np.sin(r)], [np.sin(r), np.cos(r)]])
        m = np.hstack([rot, (centre_b - rot @ centre_a)[:, None]])
        score = dice(cv2.warpAffine(mask_a, m, size, flags=cv2.INTER_NEAREST), mask_b)
        if best is None or score > best[0]:
            best = (score, m)
    blur_a = cv2.GaussianBlur(mask_a.astype(np.float32), (0, 0), 8)
    blur_b = cv2.GaussianBlur(mask_b.astype(np.float32), (0, 0), 8)
    # ECC's warp goes from the template (b) to the input (a), so it starts from the inverse.
    warp = cv2.invertAffineTransform(best[1]).astype(np.float32)
    try:
        _, warp = cv2.findTransformECC(blur_b, blur_a, warp, cv2.MOTION_EUCLIDEAN,
                                       (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 500, 1e-7), None, 1)
    except cv2.error:
        return best[1]
    return cv2.invertAffineTransform(warp)


def read_small(path, downsample):
    """The section at 1/downsample of full size, as RGB."""
    import openslide

    slide = openslide.OpenSlide(str(path))
    level = slide.get_best_level_for_downsample(downsample + 0.1)
    have = slide.level_downsamples[level]
    region = slide.read_region((0, 0), level, slide.level_dimensions[level]).convert("RGB")
    rgb = np.asarray(region)
    if abs(have - downsample) > 1e-6:
        rgb = cv2.resize(rgb, None, fx=have / downsample, fy=have / downsample, interpolation=cv2.INTER_AREA)
    return rgb


def place(image, size, fill):
    """The image as it comes, top left on a canvas of size - the 'before' picture."""
    canvas = np.full((size[1], size[0]) + image.shape[2:], fill, dtype=image.dtype)
    h, w = min(image.shape[0], size[1]), min(image.shape[1], size[0])
    canvas[:h, :w] = image[:h, :w]
    return canvas


# ---- the run ----

def register(images, masks, um_per_pixel, clahe=False, use_guided=False):
    """Links between neighbours, every section's transform onto the reference, and the canvas -
    all at the working scale. A link is "features" when features alone agree, "guided" when
    they agree once the outline has said roughly where to look, and "gap" when only the
    outline lines them up."""
    # Features for three sections at a time - a section, the next, and the one
    # after for the skip-one check. 20000 RootSIFT descriptors are 10 MB a
    # section, so keeping all 260 of a big set would be 2.6 GB for nothing.
    window = {}

    def features(i):
        if i not in window:
            window[i] = rootsift(images[i], masks[i], clahe)
            for old in [k for k in window if k < i - 2]:
                del window[old]
        return window[i]

    pair_transforms, links = [], []
    for i in range(len(images) - 1):
        m, matches, inliers, residual = feature_transform(features(i), features(i + 1))
        kind = "features" if m is not None and inliers >= MIN_INLIERS else "gap"
        if kind == "gap":
            rough = outline_transform(masks[i], masks[i + 1])
            m, residual = rough, None
        if kind == "gap" and use_guided:
            guided, guided_matches, guided_inliers, guided_residual = guided_transform(
                features(i), features(i + 1), rough, GUIDED_RADIUS_UM / um_per_pixel)
            if guided is not None and guided_inliers >= GUIDED_MIN_INLIERS:
                kind, m, matches, inliers, residual = "guided", guided, guided_matches, guided_inliers, guided_residual
        rotation, scale = rotation_and_scale(m)
        pair_transforms.append(m)
        links.append(Link(i, i + 1, kind, matches, inliers,
                          None if residual is None else round(residual * um_per_pixel, 1),
                          round(rotation, 2), round(scale, 4), 0.0, 0.0))

    window.clear()
    for i in range(len(images) - 2):
        if links[i].kind == links[i + 1].kind == "features":
            direct, _, inliers, _ = feature_transform(features(i), features(i + 2))
            if direct is not None and inliers >= MIN_INLIERS:
                chained = as_3x3(pair_transforms[i + 1]) @ as_3x3(pair_transforms[i])
                ys, xs = np.nonzero(masks[i][::4, ::4])
                points = np.stack([xs * 4, ys * 4], axis=1)
                links[i].skip_one_um = round(mean_displacement(direct, chained, points) * um_per_pixel, 1)

    reference = len(images) // 2
    to_ref = chain_to_reference(pair_transforms, reference)
    sizes = [(img.shape[1], img.shape[0]) for img in images]
    width, height, on_canvas = canvas_for(sizes, to_ref)

    # Neighbour by neighbour - a canvas-sized mask per section for all of them
    # at once is gigabytes on a big set.
    def placed(i):
        return place(masks[i], (width, height), 0), cv2.warpAffine(masks[i], on_canvas[i][:2], (width, height), flags=cv2.INTER_NEAREST)

    previous = placed(0) if links else None
    for link in links:
        following = placed(link.b)
        link.dice_before = round(dice(previous[0], following[0]), 3)
        link.dice_after = round(dice(previous[1], following[1]), 3)
        previous = following
    return links, reference, on_canvas, (width, height)


def summary(links):
    feats = [link for link in links if link.kind in ("features", "guided")]
    skip = [link.skip_one_um for link in links if link.skip_one_um is not None]
    return {
        "feature_links": sum(link.kind == "features" for link in links),
        "guided_links": sum(link.kind == "guided" for link in links),
        "gap_links": sum(link.kind == "gap" for link in links),
        "median_residual_um": round(float(np.median([link.residual_um for link in feats])), 1) if feats else None,
        "median_skip_one_um": round(float(np.median(skip)), 1) if skip else None,
        "mean_dice_before": round(float(np.mean([link.dice_before for link in links])), 3),
        "mean_dice_after": round(float(np.mean([link.dice_after for link in links])), 3),
    }


def preview_frames(count, most=PREVIEW_FRAMES):
    """Which sections go in a preview: all of them, or evenly spread if there are more than most."""
    if count <= most:
        return list(range(count))
    return sorted({round(i * (count - 1) / (most - 1)) for i in range(most)})


def save_previews(images, on_canvas, size, backgrounds, out):
    """Animated GIFs stepping through the sections, before and after - the quickest way to see it worked.
    Made a frame at a time and kept small, so a big set doesn't hold every canvas in memory."""
    from PIL import Image

    scale = min(1.0, PREVIEW_SIZE / max(size))
    small_size = (max(1, round(size[0] * scale)), max(1, round(size[1] * scale)))
    chosen = preview_frames(len(images))
    for name in ("before", "after"):
        frames = []
        for i in chosen:
            if name == "before":
                frame = place(images[i], size, backgrounds[i])
            else:
                frame = cv2.warpAffine(images[i], on_canvas[i][:2], size, flags=cv2.INTER_LINEAR,
                                       borderMode=cv2.BORDER_CONSTANT, borderValue=backgrounds[i])
            frames.append(Image.fromarray(cv2.resize(frame, small_size, interpolation=cv2.INTER_AREA)))
        frames[0].save(out / f"preview_{name}.gif", save_all=True, append_images=frames[1:], duration=250, loop=0)


def run(args, label):
    result = subprocess.run(args, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        tail = (result.stderr or result.stdout).strip().splitlines()[-5:]
        raise RuntimeError(f"{label} failed ({result.returncode}): " + " | ".join(tail))
    return result.stdout


def pyramid_target(path, quality):
    """libvips takes save options in brackets after the file name, so affine can write the tiled
    pyramid straight out. An uncompressed file in between would be 5.4 GB a section on the liver set."""
    return f"{path}[tile,tile-width=256,tile-height=256,pyramid,compression=jpeg,Q={quality},bigtiff]"


def write_sections(sections, folder, out, transforms, size, backgrounds, vips, quality):
    """Each section turned onto the canvas at full resolution, as a tiled pyramid."""
    header = Path(vips) / ("vipsheader.exe" if os.name == "nt" else "vipsheader")
    started = time.monotonic()
    for i, (section, m, bg) in enumerate(zip(sections, transforms, backgrounds)):
        # The .part name still ends .tif, so libvips picks its TIFF writer from it.
        part = out / f"{Path(section['file']).stem}.part.tif"
        target = out / section["file"]
        try:
            run(vips_affine_args(vips, folder / section["file"], pyramid_target(part, quality), m, size[0], size[1], bg),
                "vips affine")
            dims = (run([str(header), "-f", "width", str(part)], "vipsheader").strip(),
                    run([str(header), "-f", "height", str(part)], "vipsheader").strip())
            if (int(dims[0]), int(dims[1])) != size:
                raise RuntimeError(f"{target.name} came out {dims[0]}x{dims[1]}, canvas is {size[0]}x{size[1]}")
            os.replace(part, target)
        finally:
            part.unlink(missing_ok=True)
        done = i + 1
        left = (time.monotonic() - started) / done * (len(sections) - done)
        print(f"[{time.strftime('%H:%M:%S')}] register-sections write {done}/{len(sections)} {round(100 * done / len(sections))}% "
              f"ETA {int(left // 60)}m {int(left % 60)}s - {target.name}", flush=True)


def check_written(out, sections, links, downsample):
    """Reads the written sections back small and measures neighbour overlap again. It should match
    what registration predicted from the small copies - if not, the full-size transform is wrong.
    Two sections at a time."""
    result = []
    previous = tissue_mask(read_small(out / sections[0]["file"], downsample)) if links else None
    for link in links:
        following = tissue_mask(read_small(out / sections[link.b]["file"], downsample))
        h, w = min(previous.shape[0], following.shape[0]), min(previous.shape[1], following.shape[1])
        measured = round(dice(previous[:h, :w], following[:h, :w]), 3)
        result.append({"a": link.a, "b": link.b, "predicted": link.dice_after, "measured": measured})
        previous = following
    return result


def main(argv=None):
    args = parse_args(argv)
    cv2.setRNGSeed(0)
    manifest = json.loads((args.sections / "manifest.json").read_text(encoding="utf-8"))["sections"]
    if len(manifest) < 2:
        sys.exit("need at least two sections")
    mpps = [s["mpp_x"] for s in manifest]
    if (max(mpps) - min(mpps)) / min(mpps) > 1e-3:
        sys.exit(f"sections have different pixel sizes ({min(mpps)} to {max(mpps)}), scale them first")
    downsample = args.downsample or working_downsample([s["width"] for s in manifest], [s["height"] for s in manifest])
    um_per_pixel = float(np.mean(mpps)) * downsample
    args.out.mkdir(parents=True, exist_ok=True)
    print(f"{len(manifest)} sections, working at 1/{downsample} ({um_per_pixel:.2f} um a pixel)", flush=True)

    started = time.monotonic()
    images = [read_small(args.sections / s["file"], downsample) for s in manifest]
    masks = [tissue_mask(img) for img in images]
    backgrounds = [background_colour(img, m) for img, m in zip(images, masks)]
    links, reference, on_canvas, size = register(images, masks, um_per_pixel, args.clahe, args.guided)
    print(f"registered {len(images)} sections in {time.monotonic() - started:.1f}s", flush=True)
    for link in links:
        note = {"features": "", "guided": "  <- guided by the outline"}.get(link.kind, "  <- gap: outline only")
        print(f"  {link.a:02d}->{link.b:02d} {link.kind:8s} inliers={link.inliers:3d} residual={link.residual_um} um "
              f"skip-one={link.skip_one_um} um rot={link.rotation_deg:+.2f} scale={link.scale:.4f} "
              f"dice {link.dice_before:.3f}->{link.dice_after:.3f}{note}", flush=True)

    full = [to_full_res(t, downsample) for t in on_canvas]
    full_size = (size[0] * downsample, size[1] * downsample)
    result = {
        "method": {"downsample": downsample, "min_inliers": MIN_INLIERS, "ratio": RATIO, "ransac_px": RANSAC_PX,
                   "saturation": SATURATION, "features": N_FEATURES, "clahe": args.clahe,
                   "guided": {"radius_um": GUIDED_RADIUS_UM, "ratio": GUIDED_RATIO,
                              "min_inliers": GUIDED_MIN_INLIERS} if args.guided else None,
                   "outline_step_degrees": OUTLINE_STEP_DEGREES, "opencv": cv2.__version__},
        "reference": reference,
        # How thick the sections were cut, if anyone said - the tiler passes it on to the 3D view.
        "sectionMicrons": args.section_microns,
        "canvas": {"width": full_size[0], "height": full_size[1], "mpp": float(np.mean(mpps))},
        "summary": summary(links),
        "links": [asdict(link) for link in links],
        "sections": [{"order": s["order"], "file": s["file"], "background": list(bg),
                      "transform": [[round(float(v), 9) for v in row] for row in t[:2]]}
                     for s, t, bg in zip(manifest, full, backgrounds)],
    }
    (args.out / RESULT).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    save_previews(images, on_canvas, size, backgrounds, args.out)
    print(f"summary: {json.dumps(result['summary'])}", flush=True)
    print(f"wrote {args.out / RESULT} and preview_before.gif / preview_after.gif", flush=True)

    if args.write:
        write_sections(manifest, args.sections, args.out, full, full_size, backgrounds, args.vips, args.quality)
        checks = check_written(args.out, manifest, links, downsample)
        worst = max(abs(c["predicted"] - c["measured"]) for c in checks)
        result["written_check"] = {"max_dice_difference": round(worst, 3), "links": checks}
        (args.out / RESULT).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(f"written sections re-measured: largest overlap difference from prediction {worst:.3f}", flush=True)
        if worst > WRITTEN_TOLERANCE:
            sys.exit(f"written sections don't line up the way registration said (off by {worst:.3f} Dice)")


if __name__ == "__main__":
    main()
