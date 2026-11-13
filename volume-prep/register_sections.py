"""Lines up converted serial sections so they stack into a volume, then writes
each one out already lined up, all on one canvas.

Works on a small copy of each section (1/16 scale, about 4.4 um a pixel on the
liver set). For each section and the next one:

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

WORK_DOWNSAMPLE = 16
MIN_INLIERS = 30
RATIO = 0.8
RANSAC_PX = 3.0
SATURATION = 25
N_FEATURES = 20000
RESULT = "registration.json"
# Reading the written pyramid back goes through JPEG and a second resample, so
# overlap moves a little. A wrong transform moves it by tenths.
WRITTEN_TOLERANCE = 0.02


@dataclass
class Link:
    a: int
    b: int
    kind: str  # "features" or "gap"
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
    args = parser.parse_args(argv)
    if args.write and args.vips is None:
        parser.error("--write needs --vips")
    return args


# ---- geometry: plain numpy, no images ----

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
            f"{a} {b} {c} {d}",
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


def rootsift(rgb, mask):
    """SIFT with each descriptor L1-normalised and square-rooted (Arandjelovic and
    Zisserman 2012), which matches better than plain SIFT for the same cost."""
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
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


def outline_transform(mask_a, mask_b):
    """Rigid transform from a to b using only the tissue's outline: centroids and
    main axes first (trying the axis both ways round), then ECC on blurred masks."""
    def centre_and_angle(mask):
        mo = cv2.moments(mask, binaryImage=True)
        centre = np.array([mo["m10"] / mo["m00"], mo["m01"] / mo["m00"]])
        return centre, 0.5 * np.arctan2(2 * mo["mu11"], mo["mu20"] - mo["mu02"])

    (centre_a, angle_a), (centre_b, angle_b) = centre_and_angle(mask_a), centre_and_angle(mask_b)
    size = (mask_b.shape[1], mask_b.shape[0])
    best = None
    for flip in (0.0, np.pi):
        r = angle_b - angle_a + flip
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

def register(images, masks, um_per_pixel):
    """Links between neighbours, every section's transform onto the reference, and the canvas -
    all at the working scale."""
    features = [rootsift(img, m) for img, m in zip(images, masks)]
    pair_transforms, links = [], []
    for i in range(len(images) - 1):
        m, matches, inliers, residual = feature_transform(features[i], features[i + 1])
        kind = "features" if m is not None and inliers >= MIN_INLIERS else "gap"
        if kind == "gap":
            m = outline_transform(masks[i], masks[i + 1])
            residual = None
        rotation, scale = rotation_and_scale(m)
        pair_transforms.append(m)
        links.append(Link(i, i + 1, kind, matches, inliers,
                          None if residual is None else round(residual * um_per_pixel, 1),
                          round(rotation, 2), round(scale, 4), 0.0, 0.0))

    for i in range(len(images) - 2):
        if links[i].kind == links[i + 1].kind == "features":
            direct, _, inliers, _ = feature_transform(features[i], features[i + 2])
            if direct is not None and inliers >= MIN_INLIERS:
                chained = as_3x3(pair_transforms[i + 1]) @ as_3x3(pair_transforms[i])
                ys, xs = np.nonzero(masks[i][::4, ::4])
                points = np.stack([xs * 4, ys * 4], axis=1)
                links[i].skip_one_um = round(mean_displacement(direct, chained, points) * um_per_pixel, 1)

    reference = len(images) // 2
    to_ref = chain_to_reference(pair_transforms, reference)
    sizes = [(img.shape[1], img.shape[0]) for img in images]
    width, height, on_canvas = canvas_for(sizes, to_ref)

    before = [place(m, (width, height), 0) for m in masks]
    after = [cv2.warpAffine(m, t[:2], (width, height), flags=cv2.INTER_NEAREST) for m, t in zip(masks, on_canvas)]
    for link in links:
        link.dice_before = round(dice(before[link.a], before[link.b]), 3)
        link.dice_after = round(dice(after[link.a], after[link.b]), 3)
    return links, reference, on_canvas, (width, height)


def summary(links):
    feats = [link for link in links if link.kind == "features"]
    skip = [link.skip_one_um for link in links if link.skip_one_um is not None]
    return {
        "feature_links": len(feats),
        "gap_links": len(links) - len(feats),
        "median_residual_um": round(float(np.median([link.residual_um for link in feats])), 1) if feats else None,
        "median_skip_one_um": round(float(np.median(skip)), 1) if skip else None,
        "mean_dice_before": round(float(np.mean([link.dice_before for link in links])), 3),
        "mean_dice_after": round(float(np.mean([link.dice_after for link in links])), 3),
    }


def save_previews(images, on_canvas, size, backgrounds, out):
    """Animated GIFs stepping through the sections, before and after - the quickest way to see it worked."""
    from PIL import Image

    before = [Image.fromarray(place(img, size, bg)) for img, bg in zip(images, backgrounds)]
    after = [Image.fromarray(cv2.warpAffine(img, t[:2], size, flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
                                            borderValue=bg)) for img, t, bg in zip(images, on_canvas, backgrounds)]
    for name, frames in (("before", before), ("after", after)):
        small = [f.resize((f.width // 2, f.height // 2)) for f in frames]
        small[0].save(out / f"preview_{name}.gif", save_all=True, append_images=small[1:], duration=250, loop=0)


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


def check_written(out, sections, links):
    """Reads the written sections back small and measures neighbour overlap again. It should match
    what registration predicted from the small copies - if not, the full-size transform is wrong."""
    masks = [tissue_mask(read_small(out / s["file"], WORK_DOWNSAMPLE)) for s in sections]
    result = []
    for link in links:
        a, b = masks[link.a], masks[link.b]
        h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
        measured = round(dice(a[:h, :w], b[:h, :w]), 3)
        result.append({"a": link.a, "b": link.b, "predicted": link.dice_after, "measured": measured})
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
    um_per_pixel = float(np.mean(mpps)) * WORK_DOWNSAMPLE
    args.out.mkdir(parents=True, exist_ok=True)

    started = time.monotonic()
    images = [read_small(args.sections / s["file"], WORK_DOWNSAMPLE) for s in manifest]
    masks = [tissue_mask(img) for img in images]
    backgrounds = [background_colour(img, m) for img, m in zip(images, masks)]
    links, reference, on_canvas, size = register(images, masks, um_per_pixel)
    print(f"registered {len(images)} sections in {time.monotonic() - started:.1f}s", flush=True)
    for link in links:
        note = "" if link.kind == "features" else "  <- gap: outline only"
        print(f"  {link.a:02d}->{link.b:02d} {link.kind:8s} inliers={link.inliers:3d} residual={link.residual_um} um "
              f"skip-one={link.skip_one_um} um rot={link.rotation_deg:+.2f} scale={link.scale:.4f} "
              f"dice {link.dice_before:.3f}->{link.dice_after:.3f}{note}", flush=True)

    full = [to_full_res(t, WORK_DOWNSAMPLE) for t in on_canvas]
    full_size = (size[0] * WORK_DOWNSAMPLE, size[1] * WORK_DOWNSAMPLE)
    result = {
        "method": {"downsample": WORK_DOWNSAMPLE, "min_inliers": MIN_INLIERS, "ratio": RATIO, "ransac_px": RANSAC_PX,
                   "saturation": SATURATION, "features": N_FEATURES, "opencv": cv2.__version__},
        "reference": reference,
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
        checks = check_written(args.out, manifest, links)
        worst = max(abs(c["predicted"] - c["measured"]) for c in checks)
        result["written_check"] = {"max_dice_difference": round(worst, 3), "links": checks}
        (args.out / RESULT).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(f"written sections re-measured: largest overlap difference from prediction {worst:.3f}", flush=True)
        if worst > WRITTEN_TOLERANCE:
            sys.exit(f"written sections don't line up the way registration said (off by {worst:.3f} Dice)")


if __name__ == "__main__":
    main()
