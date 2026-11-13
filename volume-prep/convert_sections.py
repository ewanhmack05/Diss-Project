"""Converts a folder of serial sections from Olympus cellSens VSI into tiled,
pyramidal TIFFs that OpenSlide (and so the tiler) can read, one per section,
and writes a manifest.json saying what each one is.

Each .vsi holds several images - label, overview, the full scan, macro - so the
full scan is picked by name (20x_BF_01 on the EPFL liver set), not by number.
Bio-Formats' bfconvert pulls that one out as a flat tiled TIFF, then libvips
builds the pyramid. Pixel size comes through both, and every output is checked
against the source's size and pixel size before it counts as done.

Sections already in the manifest with their file in place are skipped, so a
stopped run picks up where it left off. --force does them all again.

Needs Bio-Formats bftools and libvips on disk, see volume-prep/README.md. The script
itself is standard library only.

    python volume-prep/convert_sections.py --raw ../zstack-data/liver/raw --out ../zstack-data/liver/converted \\
        --bftools ../zstack-data/tools/bftools --vips ../zstack-data/tools/vips-dev-8.18/bin
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path

MANIFEST = "manifest.json"
# Source and output pixel sizes have to agree this closely. vips stores
# resolution as a float, so the last few digits move a little.
MPP_TOLERANCE = 1e-4


@dataclass
class Series:
    index: int
    name: str
    width: int
    height: int
    mpp_x: float | None
    mpp_y: float | None
    planes: int


@dataclass
class Section:
    order: int
    source: str
    file: str
    series: int
    series_name: str
    # What was scanned, which is what the .tif is. declared_* is what the VSI
    # said, bigger when it claims rows or columns it has no pixels for.
    width: int
    height: int
    declared_width: int
    declared_height: int
    mpp_x: float
    mpp_y: float
    bytes: int
    seconds: float


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--raw", required=True, type=Path, help="folder with the .vsi files and their _Name_ folders")
    parser.add_argument("--out", required=True, type=Path, help="folder for the .tif files and manifest.json")
    parser.add_argument("--bftools", required=True, type=Path, help="Bio-Formats bftools folder (has bfconvert and showinf)")
    parser.add_argument("--vips", required=True, type=Path, help="folder with the vips and vipsheader executables")
    parser.add_argument("--series-name", default="20x_BF_01", help="name of the image to take from each .vsi (default: %(default)s)")
    parser.add_argument("--quality", type=int, default=85, help="JPEG quality of the tiles (default: %(default)s)")
    parser.add_argument("--only", type=int, nargs="*", help="section numbers to do, e.g. --only 0 3 (default: all)")
    parser.add_argument("--force", action="store_true", help="convert again even if the manifest says it's done")
    return parser.parse_args(argv)


def tool(folder, name):
    """bftools ships .bat files for Windows and shell scripts elsewhere; vips is .exe on Windows."""
    if name in ("bfconvert", "showinf"):
        return str(folder / (name + ".bat" if os.name == "nt" else name))
    return str(folder / (name + ".exe" if os.name == "nt" else name))


def section_order(path):
    """Image_07.vsi is section 7. Sections are in cutting order by their number, not by name."""
    match = re.search(r"(\d+)$", Path(path).stem)
    if match is None:
        raise ValueError(f"no section number at the end of {Path(path).name}")
    return int(match.group(1))


def find_sections(raw, only=None):
    files = sorted(Path(raw).glob("*.vsi"), key=section_order)
    if only is not None:
        files = [f for f in files if section_order(f) in set(only)]
    return files


def parse_ome(text):
    """Every image in showinf's OME-XML. showinf prints its own lines before the XML, and the
    micron sign comes out however the console likes, so both are dealt with here."""
    start = text.find("<?xml")
    if start < 0:
        start = text.find("<OME")
    if start < 0:
        raise ValueError("no OME-XML in showinf's output")
    root = ET.fromstring(text[start:].encode("utf-8", "replace"))
    ns = root.tag[: root.tag.index("}") + 1] if root.tag.startswith("{") else ""
    series = []
    for index, image in enumerate(root.findall(f"{ns}Image")):
        pixels = image.find(f"{ns}Pixels")
        series.append(Series(
            index=index,
            name=image.get("Name", ""),
            width=int(pixels.get("SizeX")),
            height=int(pixels.get("SizeY")),
            mpp_x=_float(pixels.get("PhysicalSizeX")),
            mpp_y=_float(pixels.get("PhysicalSizeY")),
            planes=int(pixels.get("SizeZ", "1")),
        ))
    return series


def _float(value):
    return None if value is None else float(value)


def pick_series(series, name):
    matches = [s for s in series if s.name == name]
    if len(matches) != 1:
        names = ", ".join(s.name for s in series)
        raise ValueError(f"expected one image called {name!r}, found {len(matches)} among: {names}")
    picked = matches[0]
    if picked.mpp_x is None or picked.mpp_y is None:
        raise ValueError(f"{name!r} has no pixel size, so measurements on it would be wrong")
    if picked.planes != 1:
        raise ValueError(f"{name!r} has {picked.planes} focal planes, this only handles one")
    return picked


def pyramid_of(series, scan):
    """The scan's own smaller levels: the images straight after it, which have no pixel size
    of their own. They stop at the next named image (the macro, say)."""
    levels = []
    for s in series[scan.index + 1:]:
        if s.mpp_x is not None:
            break
        levels.append(s)
    return levels


def scanned_extent(scan, levels):
    """How much of the scan really has pixels. A VSI can say it's bigger than what was
    scanned - section 8 of the EPFL liver set says 37531 rows but every level of its
    pyramid stops at 35840 - and Bio-Formats fills the rest with black. Each level is
    half the one before, rounded up, so level k times 2^k is never less than the full
    size unless rows or columns are missing."""
    width, height = scan.width, scan.height
    for k, level in enumerate(levels, 1):
        width = min(width, level.width * 2**k)
        height = min(height, level.height * 2**k)
    return width, height


def bfconvert_args(bftools, source, series, flat, extent=None):
    args = [tool(bftools, "bfconvert"), "-series", str(series), "-tilex", "512", "-tiley", "512",
            "-compression", "JPEG", "-bigtiff", "-overwrite"]
    if extent is not None:
        args += ["-crop", f"0,0,{extent[0]},{extent[1]}"]
    return args + [str(source), str(flat)]


def vips_args(vips, flat, out, quality):
    return [tool(vips, "vips"), "tiffsave", str(flat), str(out), "--tile", "--tile-width", "256",
            "--tile-height", "256", "--pyramid", "--compression", "jpeg", "--Q", str(quality), "--bigtiff"]


def header_args(vips, path):
    return [tool(vips, "vipsheader"), "-a", str(path)]


def parse_header(text):
    """vipsheader -a prints one 'name: value' per line. Resolution is in pixels per mm."""
    fields = {}
    for line in text.splitlines():
        name, sep, value = line.partition(":")
        if sep:
            fields[name.strip()] = value.strip()
    return {
        "width": int(fields["width"]),
        "height": int(fields["height"]),
        "mpp_x": 1000 / float(fields["xres"]),
        "mpp_y": 1000 / float(fields["yres"]),
    }


def check_output(expected, header, extent=None):
    """Problems with a converted section, if any. Empty means it matches its source."""
    problems = []
    width, height = extent or (expected.width, expected.height)
    if (header["width"], header["height"]) != (width, height):
        problems.append(f"size {header['width']}x{header['height']}, expected {width}x{height}")
    for axis in ("x", "y"):
        got, want = header[f"mpp_{axis}"], getattr(expected, f"mpp_{axis}")
        if abs(got - want) / want > MPP_TOLERANCE:
            problems.append(f"mpp-{axis} {got:.6f}, source is {want:.6f}")
    return problems


def load_manifest(out):
    path = Path(out) / MANIFEST
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {s["order"]: s for s in data["sections"]}


def save_manifest(out, done):
    sections = sorted(done.values(), key=lambda s: s["order"])
    data = {"sections": sections}
    tmp = Path(out) / (MANIFEST + ".part")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, Path(out) / MANIFEST)


def still_to_do(files, done, out, force):
    """Sections that need converting: all with --force, otherwise any not in the manifest
    or whose file has gone or changed size since."""
    if force:
        return list(files)
    todo = []
    for f in files:
        entry = done.get(section_order(f))
        target = Path(out) / f"{f.stem}.tif"
        if entry is None or not target.exists() or target.stat().st_size != entry["bytes"]:
            todo.append(f)
    return todo


def progress(done, total, elapsed):
    """'3/15 20% ETA 4m 12s' - the ETA is the mean time so far times what's left."""
    percent = round(100 * done / total) if total else 100
    if done == 0:
        return f"{done}/{total} {percent}% ETA unknown"
    left = elapsed / done * (total - done)
    return f"{done}/{total} {percent}% ETA {int(left // 60)}m {int(left % 60)}s"


def run(args, label):
    result = subprocess.run(args, check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        tail = (result.stderr or result.stdout).strip().splitlines()[-5:]
        raise RuntimeError(f"{label} failed ({result.returncode}): " + " | ".join(tail))
    return result.stdout


def convert(source, out, args):
    started = time.monotonic()
    every = parse_ome(run([tool(args.bftools, "showinf"), "-nopix", "-omexml-only", str(source)], "showinf"))
    series = pick_series(every, args.series_name)
    extent = scanned_extent(series, pyramid_of(every, series))
    crop = extent if extent != (series.width, series.height) else None
    if crop:
        print(f"  {source.name}: says {series.width}x{series.height}, only {extent[0]}x{extent[1]} was scanned - cropping", flush=True)
    flat = out / f"{source.stem}.flat.ome.tif"
    part = out / f"{source.stem}.tif.part"
    target = out / f"{source.stem}.tif"
    try:
        run(bfconvert_args(args.bftools, source, series.index, flat, crop), "bfconvert")
        run(vips_args(args.vips, flat, part, args.quality), "vips")
        problems = check_output(series, parse_header(run(header_args(args.vips, part), "vipsheader")), extent)
        if problems:
            raise RuntimeError(f"{source.name}: " + "; ".join(problems))
        os.replace(part, target)
    finally:
        flat.unlink(missing_ok=True)
        part.unlink(missing_ok=True)
    return Section(
        order=section_order(source),
        source=source.name,
        file=target.name,
        series=series.index,
        series_name=series.name,
        width=extent[0],
        height=extent[1],
        declared_width=series.width,
        declared_height=series.height,
        mpp_x=series.mpp_x,
        mpp_y=series.mpp_y,
        bytes=target.stat().st_size,
        seconds=round(time.monotonic() - started, 1),
    )


def main(argv=None):
    args = parse_args(argv)
    files = find_sections(args.raw, args.only)
    if not files:
        sys.exit(f"no .vsi files in {args.raw}")
    args.out.mkdir(parents=True, exist_ok=True)
    done = load_manifest(args.out)
    todo = still_to_do(files, done, args.out, args.force)
    print(f"{len(files)} sections, {len(files) - len(todo)} already done, {len(todo)} to convert", flush=True)

    started = time.monotonic()
    for i, source in enumerate(todo):
        section = convert(source, args.out, args)
        done[section.order] = asdict(section)
        save_manifest(args.out, done)
        stamp = time.strftime("%H:%M:%S")
        print(f"[{stamp}] convert-sections {progress(i + 1, len(todo), time.monotonic() - started)} - "
              f"{section.file} {section.width}x{section.height} {section.bytes / 1e6:.0f} MB in {section.seconds}s", flush=True)
    print(f"manifest: {args.out / MANIFEST}", flush=True)


if __name__ == "__main__":
    main()
