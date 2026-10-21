"""Times every read the viewer makes of annotation-store - loading a slide,
the map, both Saved lists and their totals and facets, groups, a cell
count's dots, export, and the History tab - and prints them slowest first,
with the median, slowest 5% and largest of each, and how big the answer was.

Read only: it only GETs, apart from POST /collections/ensure, which the
viewer calls on every load and only makes a collection if there isn't one.
Signs in as a test user (alice by default) and times their own collection on
the slide and the first session they're in, so what it times is what that
person's viewer would load. Standard library only.

    python scripts/time_api.py
    python scripts/time_api.py --runs 20 --json timings.json
    python scripts/time_api.py --via https://localhost:5173/store   # through the viewer's dev proxy
"""
import argparse
import http.client
import json
import ssl
import sys
import time
import urllib.parse

from keycloak_login import access_token, add_login_args


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--store", default="http://localhost:5252", help="annotation-store URL (default: %(default)s)")
    parser.add_argument("--via", help="time through this instead - e.g. the viewer's proxy, https://localhost:5173/store. "
                                      "Its self-signed certificate is accepted")
    parser.add_argument("--slide", default="003", help="slide id (default: %(default)s)")
    parser.add_argument("--runs", type=int, default=10, help="timed calls per endpoint, after the warm-up ones (default: %(default)s)")
    parser.add_argument("--warmup", type=int, default=2, help="untimed calls first, so it isn't timing a cold start (default: %(default)s)")
    parser.add_argument("--json", help="also write every timing to this file, for comparing runs")
    add_login_args(parser)
    return parser.parse_args(argv)


def percentile(values, fraction):
    """Nearest-rank - the value at or above that share of them."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, -(-len(ordered) * fraction // 1))
    return ordered[int(rank) - 1]


def summary(name, times_ms, sizes):
    return {
        "name": name,
        "median": percentile(times_ms, 0.5),
        "p95": percentile(times_ms, 0.95),
        "max": max(times_ms),
        "bytes": max(sizes),
        "runs": len(times_ms),
    }


def size_text(n):
    for unit, step in (("MB", 1024 * 1024), ("KB", 1024)):
        if n >= step:
            return f"{n / step:.1f} {unit}"
    return f"{n} B"


def table(rows):
    """Slowest median first."""
    rows = sorted(rows, key=lambda r: r["median"], reverse=True)
    width = max(len(r["name"]) for r in rows)
    lines = [f"{'endpoint'.ljust(width)}  {'median':>8}  {'p95':>8}  {'max':>8}  {'size':>9}"]
    for r in rows:
        lines.append(f"{r['name'].ljust(width)}  {r['median']:>6.1f}ms  {r['p95']:>6.1f}ms  {r['max']:>6.1f}ms  {size_text(r['bytes']):>9}")
    return "\n".join(lines)


class Store:
    """One kept-alive connection, so it's timing the store, not TCP setup."""

    def __init__(self, url, token):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme == "https":
            # The viewer's dev server has a self-signed certificate.
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            self.connection = http.client.HTTPSConnection(parts.hostname, parts.port or 443, timeout=120, context=context)
        else:
            self.connection = http.client.HTTPConnection(parts.hostname, parts.port or 80, timeout=120)
        self.prefix = parts.path.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def call(self, method, path, body=None):
        start = time.perf_counter()
        self.connection.request(method, self.prefix + path, json.dumps(body) if body is not None else None, self.headers)
        response = self.connection.getresponse()
        data = response.read()
        took = (time.perf_counter() - start) * 1000
        if response.status >= 400:
            raise SystemExit(f"{method} {path} -> {response.status}: {data[:200]!r}")
        return took, len(data), (json.loads(data) if data else None)


def endpoints(slide, own, session, biggest_count, change_sets):
    """(name, method, path, body) for everything the viewer reads. own and
    session are collection ids (session may be None); biggest_count a cell
    count id or None; change_sets the newest few in the session, or own."""
    q = urllib.parse.quote
    found = [("collections/ensure", "POST", "/collections/ensure", {"slideId": slide}),
             ("collections list", "GET", f"/collections?slideId={q(slide)}", None)]
    for label, cid in (("own", own), ("session", session)):
        if cid is None:
            continue
        c = q(cid)
        found += [
            (f"{label}: annotations (all, the map)", "GET", f"/annotations?collectionId={c}", None),
            (f"{label}: annotations page", "GET", f"/annotations?collectionId={c}&skip=0&take=50", None),
            (f"{label}: annotations total", "GET", f"/annotations/total?collectionId={c}", None),
            (f"{label}: annotations facets", "GET", f"/annotations/facets?collectionId={c}", None),
            (f"{label}: cell counts newest", "GET", f"/cellcounts?collectionId={c}&take=1", None),
            (f"{label}: cell counts page", "GET", f"/cellcounts?collectionId={c}&skip=0&take=50", None),
            (f"{label}: cell counts total", "GET", f"/cellcounts/total?collectionId={c}", None),
            (f"{label}: cell counts facets", "GET", f"/cellcounts/facets?collectionId={c}", None),
            (f"{label}: groups", "GET", f"/annotationgroups?collectionId={c}", None),
            (f"{label}: export", "GET", f"/collections/{c}/export", None),
            (f"{label}: membership", "GET", f"/collections/{c}/membership", None),
            (f"{label}: history page", "GET", f"/changesets?collectionId={c}&skip=0&take=50", None),
            (f"{label}: history total", "GET", f"/changesets/total?collectionId={c}", None),
            (f"{label}: history facets", "GET", f"/changesets/facets?collectionId={c}", None),
        ]
    found.append(("own: image adjustments", "GET", f"/imageadjustments?collectionId={q(own)}", None))
    if biggest_count:
        found.append(("biggest cell count (with dots)", "GET", f"/cellcounts/{q(biggest_count)}", None))
    for i, change_set in enumerate(change_sets):
        found.append((f"history changes: {change_set['what']} #{i + 1}", "GET", f"/changesets/{q(change_set['id'])}/changes", None))
    return found


def main(argv=None):
    args = parse_args(argv)
    store = Store(args.via or args.store, access_token(args.keycloak, args.realm, args.username, args.password))

    _, _, own = store.call("POST", "/collections/ensure", {"slideId": args.slide})
    _, _, collections = store.call("GET", f"/collections?slideId={urllib.parse.quote(args.slide)}")
    session = next((c["collectionId"] for c in collections if c["kind"] == "session"), None)
    own_annotations = next((c["annotationCount"] for c in collections if c["collectionId"] == own["collectionId"]), 0)
    counts = []
    for cid in filter(None, (own["collectionId"], session)):
        _, _, page = store.call("GET", f"/cellcounts?collectionId={cid}&skip=0&take=500")
        counts += page
    biggest = max(counts, key=lambda c: c["count"], default=None)
    history_of = session or own["collectionId"]
    _, _, recent = store.call("GET", f"/changesets?collectionId={history_of}&skip=0&take=50")
    # One of each kind of change, so the slow ones aren't hidden by an average.
    picked, seen = [], set()
    for change_set in recent:
        if change_set["what"] not in seen:
            seen.add(change_set["what"])
            picked.append(change_set)

    rows, raw = [], {}
    for name, method, path, body in endpoints(args.slide, own["collectionId"], session, biggest and biggest["id"], picked[:6]):
        for _ in range(args.warmup):
            store.call(method, path, body)
        times, sizes = [], []
        for _ in range(args.runs):
            took, size, _ = store.call(method, path, body)
            times.append(took)
            sizes.append(size)
        rows.append(summary(name, times, sizes))
        raw[name] = times

    print(f"{args.runs} timed calls each, after {args.warmup} warm-up, signed in as {args.username}, "
          f"through {args.via or args.store}. Own collection: {own_annotations:,} annotations"
          + (f", biggest cell count {biggest['count']:,} dots." if biggest else ".") + "\n")
    print(table(rows))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as out:
            json.dump({"runs": args.runs, "summary": rows, "times": raw}, out, indent=2)
        print(f"\nWrote {args.json}")


if __name__ == "__main__":
    sys.exit(main())
