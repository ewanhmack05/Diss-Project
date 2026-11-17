"""How far apart registration leaves points that should be in the same place, in
microns - against landmarks people marked by hand, so it needs no trust in the
registration's own numbers.

For Kartasalo et al.'s data (see docs/zstack.md). Two kinds of landmark file,
tab-separated, one row per section, coordinates as Y then X in that section's
pixels:

- through: the same points on every section - the liver's four laser-cut holes
  that go through the whole block. Neighbouring sections are compared.
- pairs: points on a section and the same points on the next one - the
  prostate's nuclei halved by the blade. Eight Y,X per row: four on this
  section, then the same four on the next.

Each point goes through its section's transform from registration.json onto the
canvas, and the distance between where the two copies land is the error. The
same with no transform at all is the "before". With two observers' files, how
far apart the observers put the same point is the floor no registration can get
under.

    python volume-prep/landmark_error.py --registration path/to/registered/liver/registration.json \
        --kind through --landmarks fiducialcoordinates_liver_observer1.txt fiducialcoordinates_liver_observer2.txt
"""
import argparse
import json
import statistics
import sys
from pathlib import Path


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--registration", required=True, type=Path, help="register_sections.py's registration.json")
    parser.add_argument("--kind", required=True, choices=["through", "pairs"], help="through: same points on every section; pairs: points on a section and the next")
    parser.add_argument("--landmarks", required=True, type=Path, nargs="+", help="one landmark file per observer")
    parser.add_argument("--json", type=Path, help="also write the results here")
    return parser.parse_args(argv)


def parse_landmarks(text):
    """{file name: [(x, y), ...]} from a tab-separated file with a header row. Coordinates
    come as Y then X; they're returned as (x, y)."""
    rows = {}
    for line in text.splitlines()[1:]:
        cells = [c for c in line.strip().split("\t") if c != ""]
        if not cells:
            continue
        numbers = [float(c) for c in cells[1:]]
        if len(numbers) % 2:
            raise ValueError(f"{cells[0]}: odd number of coordinates")
        rows[cells[0]] = [(numbers[i + 1], numbers[i]) for i in range(0, len(numbers), 2)]
    return rows


def apply(transform, point):
    (a, b, c), (d, e, f) = transform
    x, y = point
    return a * x + b * y + c, d * x + e * y + f


IDENTITY = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]


def distance(p, q):
    return ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) ** 0.5


def through_errors(landmarks, files, transforms):
    """For each neighbouring pair of sections that both have landmarks, the distance between
    each through-point's two copies once each is on the canvas. In pixels."""
    errors = []
    for i in range(len(files) - 1):
        a, b = landmarks.get(files[i]), landmarks.get(files[i + 1])
        if not a or not b:
            continue
        for p, q in zip(a, b):
            errors.append(distance(apply(transforms[i], p), apply(transforms[i + 1], q)))
    return errors


def pair_errors(landmarks, files, transforms):
    """For each section with a row, the distance between each point on it and the same point on
    the next section, both on the canvas. In pixels."""
    errors = []
    for i in range(len(files) - 1):
        row = landmarks.get(files[i])
        if not row:
            continue
        half = len(row) // 2
        for p, q in zip(row[:half], row[half:]):
            errors.append(distance(apply(transforms[i], p), apply(transforms[i + 1], q)))
    return errors


def observer_gap(first, second):
    """How far apart two observers put the same point, on the same section. In pixels."""
    gaps = []
    for name in first.keys() & second.keys():
        gaps.extend(distance(p, q) for p, q in zip(first[name], second[name]))
    return gaps


def describe(errors, mpp):
    if not errors:
        return None
    microns = sorted(e * mpp for e in errors)
    return {
        "points": len(microns),
        "mean_um": round(statistics.fmean(microns), 1),
        "median_um": round(statistics.median(microns), 1),
        "p90_um": round(microns[int(0.9 * (len(microns) - 1))], 1),
    }


def evaluate(registration, kind, observers):
    """Before and after for each observer's landmarks, and how far the observers are apart."""
    sections = sorted(registration["sections"], key=lambda s: s["order"])
    files = [s["file"] for s in sections]
    after = [s["transform"] for s in sections]
    before = [IDENTITY] * len(sections)
    mpp = registration["canvas"]["mpp"]
    errors = through_errors if kind == "through" else pair_errors
    result = {"kind": kind, "sections": len(files), "mpp": mpp, "observers": []}
    for landmarks in observers:
        result["observers"].append({
            "before": describe(errors(landmarks, files, before), mpp),
            "after": describe(errors(landmarks, files, after), mpp),
        })
    # Only through points are the same points for both observers. For pairs each picked
    # their own nuclei, so lining their lists up compares unrelated points.
    if kind == "through" and len(observers) >= 2:
        result["between_observers"] = describe(observer_gap(observers[0], observers[1]), mpp)
    return result


def main(argv=None):
    args = parse_args(argv)
    registration = json.loads(args.registration.read_text(encoding="utf-8"))
    observers = [parse_landmarks(path.read_text(encoding="latin-1")) for path in args.landmarks]
    files = {s["file"] for s in registration["sections"]}
    for path, landmarks in zip(args.landmarks, observers):
        missing = sorted(set(landmarks) - files)
        if len(missing) == len(landmarks):
            sys.exit(f"none of {path.name}'s files are in {args.registration}")
    result = evaluate(registration, args.kind, observers)
    for i, observer in enumerate(result["observers"], 1):
        print(f"observer {i}: before {observer['before']}  after {observer['after']}", flush=True)
    if "between_observers" in result:
        print(f"between observers: {result['between_observers']}", flush=True)
    if args.json:
        args.json.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
