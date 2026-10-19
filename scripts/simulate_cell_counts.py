"""Simulated people counting cells in a session, live - for watching how the
viewer copes with several people counting at once.

Same as simulate_session.py - give it a session's invite link and the sim
people join and look round the slide - but every so often each one who can
edit stops and counts: they click dots inside what they're looking at, a
few a second, sometimes inside a region of interest box. The dots and tally
show on everyone's map as they go (the hub's sketches), then the count is
saved to annotation-store and everyone's told, the same as from the viewer.
View-only people just watch.

Every count made has its notes set to "sim-session"; --clean removes them.

    python scripts/simulate_cell_counts.py "https://localhost:5173/?invite=juyhsUFHC4gB"
    python scripts/simulate_cell_counts.py juyhsUFHC4gB --dots 50 150 --clicks-per-second 5
    python scripts/simulate_cell_counts.py juyhsUFHC4gB --clean    # remove their counts
"""
import argparse
import json
import time
import uuid

from simulate_session import SIM_TAG, add_session_args, call, editor_token, now_iso, run, send_op, tagged_ids, tell_deleted

# The viewer's palette (image-viewer/src/components/annotation/Tools.ts) and
# its starting dot size (CellCountDrawContext).
COLOURS = ["#FB0909", "#0913FB", "#FB09FB", "#000000", "#168304", "#06EAF9", "#F9E006", "#FFFFFF"]
DOT_SIZE = 6


def roi_box(extent, rng):
    """A region of interest inside the view - about half of it, somewhere in it."""
    x0, y0, x1, y1 = extent
    w, h = (x1 - x0) * rng.uniform(0.35, 0.6), (y1 - y0) * rng.uniform(0.35, 0.6)
    left, bottom = rng.uniform(x0 + 0.1 * (x1 - x0), x1 - w), rng.uniform(y0 + 0.1 * (y1 - y0), y1 - h)
    return left, bottom, left + w, bottom + h


def box_geojson(box):
    x0, y0, x1, y1 = box
    ring = [[x0, y1], [x1, y1], [x1, y0], [x0, y0], [x0, y1]]
    return json.dumps({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": None})


def cell_dots(area, count, colours, rng):
    """Dots in clumps, like cells are - a few centres, dots scattered round
    each. All inside area (x0, y0, x1, y1). colours are used in turn, a run
    of dots each, the way someone switches colour part way through."""
    x0, y0, x1, y1 = area
    spread = min(x1 - x0, y1 - y0) / 10
    centres = [(rng.uniform(x0, x1), rng.uniform(y0, y1)) for _ in range(rng.randint(3, 6))]
    dots = []
    for i in range(count):
        cx, cy = rng.choice(centres)
        x = min(max(rng.gauss(cx, spread), x0), x1)
        y = min(max(rng.gauss(cy, spread), y0), y1)
        dots.append({"x": x, "y": y, "colour": colours[i * len(colours) // count]})
    return dots


def count_cells(person, stop, args):
    """On their turn, sometimes: stop, count dots in view, save the count."""
    rng, state = person.rng, person.state
    now = time.monotonic()
    if "next" not in state:
        state["next"] = now + rng.uniform(1, args.count_every)
        state["counted"] = 0
    if now < state["next"]:
        return

    extent = person.view()["extent"]
    with_roi = rng.random() < args.roi
    area = roi_box(extent, rng) if with_roi else _shrunk(extent, 0.1)
    roi = box_geojson(area) if with_roi else None
    # Mostly one colour, sometimes a switch part way.
    colours = rng.sample(COLOURS, 2) if rng.random() < 0.3 else [rng.choice(COLOURS)]
    fewest, most = sorted(max(1, n) for n in args.dots)
    dots = cell_dots(area, rng.randint(fewest, most), colours, rng)

    placed = []
    for dot in dots:
        if stop.is_set():
            person.hub.send("ClearSketch", "cellCount")
            return
        placed.append(dot)
        person.hub.send("UpdateSketch", {"tool": "cellCount",
                                         "data": {"dots": placed, "dotSize": DOT_SIZE, "count": len(placed), "roiGeoJson": roi}})
        stop.wait(rng.uniform(0.5, 1.5) / args.clicks_per_second)

    state["counted"] += 1
    x0, y0, x1, y1 = area
    cell_count = {
        "id": str(uuid.uuid4()), "label": f"Count {state['counted']} by {person.info['firstName']}", "notes": SIM_TAG,
        "dots": json.dumps(placed), "withAnnotation": True, "withRoi": with_roi, "count": len(placed),
        "dotSize": DOT_SIZE, "locationX": (x0 + x1) / 2, "locationY": (y0 + y1) / 2,
        "regionOfInterest": {"id": str(uuid.uuid4()), "geoJson": roi, "created": now_iso()} if roi else None,
        "created": now_iso(),
    }
    # The viewer tells everyone first, then saves - so does this.
    send_op(person.hub, "create", "cellCount", cell_count["id"],
            {**cell_count, "createdById": person.user_id, "createdByName": person.name})
    call(f"{person.store}/cellcounts", person.token, "POST", {**cell_count, "collectionId": person.session_id})
    person.hub.send("ClearSketch", "cellCount")
    state["next"] = time.monotonic() + args.count_every * rng.uniform(0.6, 1.4)


def _shrunk(extent, margin):
    x0, y0, x1, y1 = extent
    dx, dy = (x1 - x0) * margin, (y1 - y0) * margin
    return x0 + dx, y0 + dy, x1 - dx, y1 - dy


def clean(args, people, tokens, preview):
    """Removes every cell count with the sim-session tag from the session,
    and tells anyone watching."""
    editor = editor_token(args, people, tokens, preview["collectionId"])
    ids = tagged_ids(args.store, editor, preview["collectionId"], "cellcounts")
    for count_id in ids:
        call(f"{args.store}/cellcounts/{count_id}", editor, "DELETE")
    tell_deleted(args, editor, preview["collectionId"], "cellCount", ids)
    print(f"Removed {len(ids)} simulated cell count{'s' if len(ids) != 1 else ''}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    add_session_args(parser, people=6)
    parser.add_argument("--count-every", type=float, default=20, help="seconds between counts, per editor - give or take (default: %(default)s)")
    parser.add_argument("--dots", type=int, nargs=2, default=[15, 60], metavar=("FEWEST", "MOST"),
                        help="how many dots in a count, picked between these (default: 15 60)")
    parser.add_argument("--clicks-per-second", type=float, default=3, help="how fast they click (default: %(default)s)")
    parser.add_argument("--roi", type=float, default=0.5, help="share of counts made inside a region of interest box, 0 to 1 (default: %(default)s)")
    parser.add_argument("--clean", action="store_true", help="remove every cell count the sim people made in the session, and stop")
    run(parser, act=count_cells, clean=clean)


if __name__ == "__main__":
    main()
