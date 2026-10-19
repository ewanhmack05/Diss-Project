"""Simulated people drawing annotations in a session, live - for watching
how the viewer copes with several people drawing at once.

Same as simulate_session.py - give it a session's invite link and the sim
people join and look round the slide - but every so often each one who can
edit stops, draws a shape inside what they're looking at, and saves it. The
shape grows on everyone's map while they draw it (the hub's sketches), then
it's saved to annotation-store and everyone's told, the same as from the
viewer. View-only people just watch.

Everything drawn has its notes set to "sim-session"; --clean removes it.

    python scripts/simulate_annotations.py "https://localhost:5173/?invite=juyhsUFHC4gB"
    python scripts/simulate_annotations.py juyhsUFHC4gB --draw-every 4 --seconds 120
    python scripts/simulate_annotations.py juyhsUFHC4gB --clean    # remove what they drew
"""
import argparse
import json
import math
import time
import uuid

from simulate_session import (
    SIM_TAG,
    add_session_args,
    call,
    editor_token,
    now_iso,
    run,
    send_op,
    tagged_ids,
    tell_deleted,
)

# The viewer's palette and tools (image-viewer/src/components/annotation/Tools.ts).
COLOURS = ["#FB0909", "#0913FB", "#FB09FB", "#000000", "#168304", "#06EAF9", "#F9E006", "#FFFFFF"]
SHAPES = ["polygon", "rectangle", "circle", "line", "arrow", "freehand"]
SHAPE_WEIGHTS = [3, 2, 2, 1, 1, 3]
# Most of what's on screen, so shapes don't land half off it.
MARGIN = 0.15
# Most delete requests take - annotation-store's MaxBulkIds.
MAX_BULK_IDS = 20_000


def inner(extent, margin=MARGIN):
    x0, y0, x1, y1 = extent
    dx, dy = (x1 - x0) * margin, (y1 - y0) * margin
    return x0 + dx, y0 + dy, x1 - dx, y1 - dy


def shape_in_view(kind, extent, rng):
    """A shape of that kind somewhere in the view, as GeoJSON coordinates -
    a ring for the closed shapes, a list of points for the lines."""
    x0, y0, x1, y1 = inner(extent)
    size = rng.uniform(0.08, 0.22) * min(x1 - x0, y1 - y0)
    cx, cy = rng.uniform(x0 + size, x1 - size), rng.uniform(y0 + size, y1 - size)

    if kind == "rectangle":
        w, h = size, size * rng.uniform(0.5, 1.5)
        return [[cx, cy], [cx + w, cy], [cx + w, cy - h], [cx, cy - h], [cx, cy]]
    if kind == "circle":
        # The viewer's circle tool is a 50-sided polygon.
        ring = [[cx + size * math.cos(2 * math.pi * i / 50), cy + size * math.sin(2 * math.pi * i / 50)] for i in range(50)]
        return ring + [ring[0]]
    if kind == "polygon":
        n = rng.randint(6, 14)
        ring = [[cx + size * rng.uniform(0.5, 1) * math.cos(2 * math.pi * i / n),
                 cy + size * rng.uniform(0.5, 1) * math.sin(2 * math.pi * i / n)] for i in range(n)]
        return ring + [ring[0]]
    if kind in ("line", "arrow"):
        angle = rng.uniform(0, 2 * math.pi)
        return [[cx, cy], [cx + size * math.cos(angle), cy + size * math.sin(angle)]]

    # Freehand - a wandering trace, kept inside the view.
    points, x, y, angle = [], cx, cy, rng.uniform(0, 2 * math.pi)
    for _ in range(60):
        angle += rng.uniform(-0.4, 0.4)
        x = min(max(x + math.cos(angle) * size / 15, x0), x1)
        y = min(max(y + math.sin(angle) * size / 15, y0), y1)
        points.append([x, y])
    return points


def is_closed(kind):
    return kind in ("polygon", "rectangle", "circle")


def geometry(kind, coords):
    return {"type": "Polygon", "coordinates": [coords]} if is_closed(kind) else {"type": "LineString", "coordinates": coords}


def drawing_frames(kind, coords, steps):
    """What the shape looks like part way through being drawn, frame by
    frame - the last is the finished shape. Rectangles and circles grow from
    where they were started, the others gain points as they're placed."""
    frames = []
    for i in range(1, steps + 1):
        t = i / steps
        if kind in ("rectangle", "circle"):
            ax, ay = coords[0] if kind == "rectangle" else _centre(coords)
            ring = [[ax + (x - ax) * t, ay + (y - ay) * t] for x, y in coords]
            frames.append(geometry(kind, ring))
        elif kind in ("line", "arrow"):
            (x0, y0), (x1, y1) = coords
            frames.append(geometry(kind, [[x0, y0], [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]]))
        else:
            points = coords[:-1] if kind == "polygon" else coords
            shown = points[:max(2, round(len(points) * t))]
            if kind == "polygon" and len(shown) >= 3:
                frames.append(geometry(kind, shown + [shown[0]]))
            else:
                frames.append({"type": "LineString", "coordinates": shown})
    return frames


def _centre(ring):
    points = ring[:-1]
    return sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)


def feature(geom):
    return json.dumps({"type": "Feature", "geometry": geom, "properties": None})


def draw(person, stop, args):
    """On their turn, sometimes: stop, draw a shape in view, save it."""
    rng, state = person.rng, person.state
    now = time.monotonic()
    if "next" not in state:
        state["next"] = now + rng.uniform(1, args.draw_every)
        state["drawn"] = 0
    if now < state["next"]:
        return

    kind = rng.choices(SHAPES, SHAPE_WEIGHTS)[0]
    look = {"shape": kind, "colour": rng.choice(COLOURS), "lineThickness": rng.choice([2, 3, 4]),
            "lineStyle": rng.choice(["solid", "solid", "dashed"])}
    coords = shape_in_view(kind, person.view()["extent"], rng)
    frames = drawing_frames(kind, coords, args.frames)
    for frame in frames:
        if stop.is_set():
            person.hub.send("ClearSketch", "annotation")
            return
        person.hub.send("UpdateSketch", {"tool": "annotation", "data": {**look, "geoJson": feature(frame)}})
        stop.wait(args.draw_seconds / len(frames))

    state["drawn"] += 1
    annotation = {
        "id": str(uuid.uuid4()), "label": f"{kind.capitalize()} {state['drawn']} by {person.info['firstName']}",
        "notes": SIM_TAG, **look, "geoJson": feature(frames[-1]), "created": now_iso(),
    }
    # The viewer tells everyone first, then saves - so does this.
    send_op(person.hub, "create", "annotation", annotation["id"],
            {**annotation, "createdById": person.user_id, "createdByName": person.name})
    call(f"{person.store}/annotations", person.token, "POST", {**annotation, "collectionId": person.session_id})
    person.hub.send("ClearSketch", "annotation")
    state["next"] = time.monotonic() + args.draw_every * rng.uniform(0.6, 1.4)


def clean(args, people, tokens, preview):
    """Removes every annotation with the sim-session tag from the session,
    and tells anyone watching."""
    editor = editor_token(args, people, tokens, preview["collectionId"])
    ids = tagged_ids(args.store, editor, preview["collectionId"], "annotations")
    for start in range(0, len(ids), MAX_BULK_IDS):
        call(f"{args.store}/annotations/bulk-delete", editor, "POST",
             {"collectionId": preview["collectionId"], "ids": ids[start:start + MAX_BULK_IDS]})
    tell_deleted(args, editor, preview["collectionId"], "annotation", ids)
    print(f"Removed {len(ids)} simulated annotation{'s' if len(ids) != 1 else ''}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    add_session_args(parser, people=6)
    parser.add_argument("--draw-every", type=float, default=8, help="seconds between shapes, per editor - give or take (default: %(default)s)")
    parser.add_argument("--draw-seconds", type=float, default=1.5, help="how long drawing one takes (default: %(default)s)")
    parser.add_argument("--frames", type=int, default=12, help="sketch updates sent while drawing one (default: %(default)s)")
    parser.add_argument("--clean", action="store_true", help="remove every annotation the sim people drew in the session, and stop")
    run(parser, act=draw, clean=clean)


if __name__ == "__main__":
    main()
