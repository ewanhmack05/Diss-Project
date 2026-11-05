"""Times putting a whole collection back, for the evaluation: how long working
it out takes from a snapshot against from what's there now, on the same data,
and how long the rollback itself takes for different numbers of rows.

Makes a collection of its own on a made-up slide, so nothing of yours is
touched. It stays there afterwards - point it at a throwaway database rather
than the one you work in. Waits for the store's background check to take a
snapshot part way through, so it takes a minute or two. Standard library only.

    python scripts/time_rollback.py --store http://localhost:5253
    python scripts/time_rollback.py --rows 20000 --rounds 6 --json rollback.json
"""
import argparse
import itertools
import json
import statistics
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from keycloak_login import access_token, add_login_args

COLOURS = ["#FB0909", "#0913FB", "#FB09FB", "#000000", "#168304", "#06EAF9", "#F9E006", "#FFFFFF"]
# The store's most in one bulk request.
BATCH = 20_000


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--store", default="http://localhost:5252", help="annotation-store URL (default: %(default)s)")
    parser.add_argument("--rows", type=int, default=5000, help="annotations in the collection (default: %(default)s)")
    parser.add_argument("--rounds", type=int, default=6, help="recolours of every row after the snapshot (default: %(default)s)")
    parser.add_argument("--runs", type=int, default=5, help="timed previews each way (default: %(default)s)")
    parser.add_argument("--sizes", type=int, nargs="*", default=[1, 1000, 5000], help="rows to change or delete, then put back (default: %(default)s)")
    parser.add_argument("--repeats", type=int, default=1, help="rollbacks of each size and kind, reporting the median and range (default: %(default)s)")
    parser.add_argument("--wait", type=int, default=90, help="seconds to wait for a snapshot (default: %(default)s)")
    parser.add_argument("--json", help="also write the results to this file")
    add_login_args(parser)
    return parser.parse_args(argv)


def shape(index):
    """A freehand line of 120 points, as a real trace is - the row size matters."""
    points = [[index + i * 3.25, -index - i * 2.75] for i in range(120)]
    return json.dumps({"type": "Feature", "geometry": {"type": "LineString", "coordinates": points}, "properties": None})


def batches(items, size=BATCH):
    return [items[i:i + size] for i in range(0, len(items), size)]


def unique_colour(step):
    """A colour no row has yet, so the change that sets it always records something."""
    return f"#{step + 1:06X}"


def recolour_body(collection_id, ids, colour):
    return {"collectionId": collection_id, "ids": ids, "colour": colour}


def ms_since(started):
    return (time.perf_counter() - started) * 1000


def compare(from_now, from_snapshot):
    """The two ways of working one rollback out, side by side."""
    now_ms = statistics.median(from_now["ms"])
    snapshot_ms = statistics.median(from_snapshot["ms"])
    return {
        "from_now_entries": from_now["entries"],
        "from_snapshot_entries": from_snapshot["entries"],
        "from_now_ms": now_ms,
        "from_snapshot_ms": snapshot_ms,
        "times_faster": now_ms / snapshot_ms if snapshot_ms else None,
    }


def rollback_rows(times):
    """Median and range for each size and kind, from every timed rollback."""
    rows = []
    for (size, what), ms in times.items():
        rows.append({"rows": size, "what": what, "ms": statistics.median(ms), "fastest": min(ms), "slowest": max(ms), "runs": len(ms)})
    return rows


def report(comparison, rollbacks):
    lines = [
        f"Working it out, from what's there now: {comparison['from_now_ms']:.0f} ms, undoing {comparison['from_now_entries']:,} entries",
        f"Working it out, from a snapshot:       {comparison['from_snapshot_ms']:.0f} ms, undoing {comparison['from_snapshot_entries']:,} entries",
        "",
        f"{'rows':>8}  {'what':<8}  {'median':>10}  {'fastest':>10}  {'slowest':>10}  runs",
    ]
    lines += [f"{r['rows']:>8,}  {r['what']:<8}  {r['ms']:>7.0f} ms  {r['fastest']:>7.0f} ms  {r['slowest']:>7.0f} ms  {r['runs']}" for r in rollbacks]
    return "\n".join(lines)


class Store:
    def __init__(self, url, token):
        self.url, self.token = url.rstrip("/"), token

    def call(self, method, path, body=None):
        request = urllib.request.Request(self.url + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                         headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        with urllib.request.urlopen(request) as response:
            raw = response.read()
            return json.loads(raw) if raw else None, response.headers.get("Change-Set-Id")

    def recolour(self, collection_id, ids, colour):
        change_set = None
        for batch in batches(ids):
            _, change_set = self.call("PUT", "/annotations/bulk", recolour_body(collection_id, batch, colour))
        return change_set

    def preview(self, change_set, snapshots):
        started = time.perf_counter()
        view, _ = self.call("GET", f"/changesets/{change_set}/rollback{'' if snapshots else '?snapshots=false'}")
        return view, ms_since(started)

    def rollback(self, change_set):
        started = time.perf_counter()
        self.call("POST", f"/changesets/{change_set}/rollback")
        return ms_since(started)

    def timed_previews(self, change_set, snapshots, runs):
        views = [self.preview(change_set, snapshots) for _ in range(runs + 1)]
        return {"entries": views[0][0]["entriesWalked"], "from_snapshot": views[0][0]["fromSnapshot"], "ms": [ms for _, ms in views[1:]]}


def main(argv=None):
    args = parse_args(argv)
    store = Store(args.store, access_token(args.keycloak, args.realm, args.username, args.password))
    collection, _ = store.call("POST", "/collections/ensure", {"slideId": f"rollback-bench-{int(time.time())}"})
    collection_id = collection["collectionId"]

    print(f"Adding {args.rows:,} annotations...")

    def add(index):
        row, _ = store.call("POST", "/annotations", {
            "collectionId": collection_id, "label": f"Row {index}", "notes": "", "colour": COLOURS[0], "shape": "freehand",
            "lineStyle": "solid", "lineThickness": 2, "geoJson": shape(index)})
        return row["id"]

    with ThreadPoolExecutor(16) as pool:
        ids = list(pool.map(add, range(args.rows)))

    point = store.recolour(collection_id, ids, COLOURS[1])
    # Enough entries that the background check takes a snapshot of how it is here.
    store.recolour(collection_id, ids, COLOURS[2])
    print(f"Waiting for a snapshot, up to {args.wait}s...")
    deadline = time.time() + args.wait
    while not store.preview(point, True)[0]["fromSnapshot"]:
        if time.time() > deadline:
            raise SystemExit("No snapshot turned up - is this store running its background check, with enough rows (5,000 entries)?")
        time.sleep(2)

    print(f"Recolouring every row {args.rounds} more times...")
    for round_number in range(args.rounds):
        store.recolour(collection_id, ids, COLOURS[(round_number + 3) % len(COLOURS)])

    comparison = compare(store.timed_previews(point, False, args.runs), store.timed_previews(point, True, args.runs))

    times = {}
    steps = itertools.count()
    # Round the sizes in turn rather than all of one size together, so anything that
    # changes over a run, like the history getting longer, doesn't favour one size.
    for _, size in itertools.product(range(args.repeats), args.sizes):
        some = ids[:size]
        before = store.recolour(collection_id, ids[:1], unique_colour(next(steps)))
        store.recolour(collection_id, some, unique_colour(next(steps)))
        times.setdefault((size, "recolour"), []).append(store.rollback(before))
        before = store.recolour(collection_id, ids[:1], unique_colour(next(steps)))
        for batch in batches(some):
            store.call("POST", "/annotations/bulk-delete", {"collectionId": collection_id, "ids": batch})
        times.setdefault((size, "delete"), []).append(store.rollback(before))
    rollbacks = rollback_rows(times)

    print()
    print(report(comparison, rollbacks))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as file:
            json.dump({"rows": args.rows, "comparison": comparison, "rollbacks": rollbacks}, file, indent=2)


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"annotation-store said {error.code}: {error.read().decode(errors='replace')[:300]}") from None
