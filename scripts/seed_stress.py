"""Fills a slide's collection with lots of annotations and cell counts, for
testing how the viewer copes with a heavy load (the WebGL layers in
particular). Everything added has its notes set to "stress-test", so
clean_stress.py can remove exactly these and nothing else.

Needs annotation-store running. Standard library only - no pip install.

    python scripts/seed_stress.py
    python scripts/seed_stress.py --annotations 5000 --dots 1000 10000 100000
"""
import argparse
import json
import math
import random
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

TAG = "stress-test"
COLOURS = ["#ff0000", "#0000ff", "#ff00ff", "#000000", "#008000", "#00e5ff", "#fff614", "#ffffff"]
SHAPES = ["polygon", "rectangle", "circle", "line", "arrow", "freehand"]
SHAPE_WEIGHTS = [3, 2, 2, 1, 1, 2]


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--store", default="http://localhost:5252", help="annotation-store URL (default: %(default)s)")
    parser.add_argument("--tiler", default="http://localhost:5095", help="tiler URL, used to look up the slide's size (default: %(default)s)")
    parser.add_argument("--slide", default="003", help="slide id (default: %(default)s)")
    parser.add_argument("--user", default="001", help="user id - the viewer's placeholder user (default: %(default)s)")
    parser.add_argument("--annotations", type=int, default=2000, help="how many annotations to add (default: %(default)s)")
    parser.add_argument("--dots", type=int, nargs="*", default=[1_000, 10_000, 50_000],
                        help="one cell count per value, with that many dots (default: 1000 10000 50000)")
    parser.add_argument("--seed", type=int, default=42, help="random seed, so runs are repeatable (default: %(default)s)")
    return parser.parse_args()


def post(store, path, body):
    req = urllib.request.Request(store + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as response:
        return json.load(response)


def slide_bounds(tiler, slide):
    # Map coordinates are slide pixels, with y running from 0 at the top to
    # -height at the bottom. Keeps a 10% margin so shapes land on the slide,
    # not hard up against its edge.
    with urllib.request.urlopen(f"{tiler}/slides/{slide}") as response:
        info = json.load(response)
    width, height = info["width"], info["height"]
    return 0.1 * width, 0.9 * width, -0.93 * height, -0.07 * height


def geojson(kind, coords):
    return json.dumps({"type": "Feature", "geometry": {"type": kind, "coordinates": coords}, "properties": None})


def random_shape(bounds):
    x0, x1, y0, y1 = bounds
    cx, cy = random.uniform(x0, x1), random.uniform(y0, y1)
    size = random.uniform(400, 4000)
    kind = random.choices(SHAPES, SHAPE_WEIGHTS)[0]

    if kind == "rectangle":
        w, h = size, size * random.uniform(0.4, 1.6)
        return kind, geojson("Polygon", [[[cx, cy], [cx + w, cy], [cx + w, cy + h], [cx, cy + h], [cx, cy]]])
    if kind == "circle":
        # The viewer's circle tool draws a 50-sided polygon, so match that.
        ring = [[cx + size * math.cos(2 * math.pi * i / 50), cy + size * math.sin(2 * math.pi * i / 50)] for i in range(50)]
        return kind, geojson("Polygon", [ring + [ring[0]]])
    if kind == "polygon":
        n = random.randint(6, 20)
        ring = [[cx + size * random.uniform(0.5, 1) * math.cos(2 * math.pi * i / n),
                 cy + size * random.uniform(0.5, 1) * math.sin(2 * math.pi * i / n)] for i in range(n)]
        return kind, geojson("Polygon", [ring + [ring[0]]])
    if kind in ("line", "arrow"):
        angle = random.uniform(0, 2 * math.pi)
        return kind, geojson("LineString", [[cx, cy], [cx + size * math.cos(angle), cy + size * math.sin(angle)]])

    # Freehand - a wandering line of 120 points, like a real mouse trace.
    points, x, y, angle = [], cx, cy, random.uniform(0, 2 * math.pi)
    for _ in range(120):
        angle += random.uniform(-0.35, 0.35)
        x += math.cos(angle) * size / 40
        y += math.sin(angle) * size / 40
        points.append([x, y])
    return kind, geojson("LineString", points)


def add_annotation(store, collection_id, bounds, index):
    kind, shape_geojson = random_shape(bounds)
    return post(store, "/annotations", {
        "collectionId": collection_id,
        "label": f"Stress {index + 1}",
        "notes": TAG,
        "colour": random.choice(COLOURS),
        "shape": kind,
        "lineStyle": random.choice(["solid", "solid", "dashed"]),
        "lineThickness": random.choice([1, 2, 2, 3, 4]),
        "geoJson": shape_geojson,
    })


def add_cell_count(store, collection_id, bounds, dots, with_roi):
    # Dots clustered in blobs, like cells in tissue, around a random centre
    # in the middle half of the slide.
    x0, x1, y0, y1 = bounds
    cx = random.uniform(x0 + (x1 - x0) / 4, x1 - (x1 - x0) / 4)
    cy = random.uniform(y0 + (y1 - y0) / 4, y1 - (y1 - y0) / 4)
    half = 4_000 + dots / 5
    blobs = [(cx + random.uniform(-half, half), cy + random.uniform(-half, half)) for _ in range(max(5, dots // 400))]
    points = []
    for _ in range(dots):
        bx, by = random.choice(blobs)
        points.append({"x": round(bx + random.gauss(0, half / 12), 1),
                       "y": round(by + random.gauss(0, half / 12), 1),
                       "colour": random.choice(COLOURS[:7])})

    roi = None
    if with_roi:
        r = half * 1.3
        roi = {"geoJson": geojson("Polygon", [[[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r], [cx - r, cy - r]]])}

    return post(store, "/cellcounts", {
        "collectionId": collection_id,
        "label": f"Stress {dots:,} dots",
        "notes": TAG,
        "dots": json.dumps(points),
        "withAnnotation": True,
        "withRoi": with_roi,
        "count": dots,
        "dotSize": 6,
        "locationX": cx,
        "locationY": cy,
        "regionOfInterest": roi,
    })


def main():
    args = parse_args()
    random.seed(args.seed)
    bounds = slide_bounds(args.tiler, args.slide)
    collection_id = post(args.store, "/collections/ensure", {"slideId": args.slide, "userId": args.user})["collectionId"]
    print(f"Slide {args.slide}, user {args.user}, collection {collection_id}")

    start = time.time()
    with ThreadPoolExecutor(8) as pool:
        added = list(pool.map(lambda i: add_annotation(args.store, collection_id, bounds, i), range(args.annotations)))
    print(f"  {len(added)} annotations added in {time.time() - start:.1f}s")

    # Every second count gets an ROI box, so both kinds are covered.
    for i, dots in enumerate(args.dots):
        add_cell_count(args.store, collection_id, bounds, dots, with_roi=i % 2 == 1)
        print(f"  cell count with {dots:,} dots added" + (" (with ROI)" if i % 2 == 1 else ""))

    print("Done. Remove it all again with: python scripts/clean_stress.py")


if __name__ == "__main__":
    main()
