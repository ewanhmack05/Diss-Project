"""How long a change takes to reach everyone else in a session, at several room
sizes, quiet and with everyone's viewport moving. See docs/evaluation.md.

Starts a session as alice, has the simulated people join it through a link,
then runs eval_latency.mjs, which holds real WebSocket connections to the hub and
does the timing. Uses image-viewer's node_modules. Sessions stay there, so point it
at a throwaway database rather than the one you work in.

    python scripts/eval_latency.py --store http://localhost:5253 --hub http://localhost:5181/hubs/slides --out latency.json
"""
import argparse
import json
import subprocess
import tempfile
import urllib.request
from pathlib import Path

from keycloak_login import access_token
from simulate_session import PASSWORD, ensure_people, sim_people

HERE = Path(__file__).resolve().parent


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--store", default="http://localhost:5252", help="annotation-store URL (default: %(default)s)")
    parser.add_argument("--hub", default="http://localhost:5180/hubs/slides", help="realtime-hub's session hub (default: %(default)s)")
    parser.add_argument("--slide", default="003", help="slide id (default: %(default)s)")
    parser.add_argument("--people", type=int, nargs="+", default=[2, 6, 12, 25, 50], help="people in the room (default: %(default)s)")
    parser.add_argument("--ops", type=int, default=300, help="ops to send at each size (default: %(default)s)")
    parser.add_argument("--ops-per-second", type=float, default=5, help="how fast they're sent (default: %(default)s)")
    parser.add_argument("--viewports", type=float, nargs="+", default=[0, 2], help="viewport updates per person per second, one run for each (default: %(default)s)")
    parser.add_argument("--out", help="write the results to this file, as it goes")
    parser.add_argument("--keycloak", default="http://localhost:8080/auth", help="Keycloak URL (default: %(default)s)")
    parser.add_argument("--realm", default="diss", help="Keycloak realm (default: %(default)s)")
    parser.add_argument("--username", default="alice", help="who starts the sessions (default: %(default)s)")
    parser.add_argument("--password", default="password", help="their password (default: %(default)s)")
    parser.add_argument("--admin-user", default="admin", help="Keycloak admin, to make the simulated people if needed (default: %(default)s)")
    parser.add_argument("--admin-password", default="admin", help="their password (default: %(default)s)")
    return parser.parse_args(argv)


def config_for(args, session_id, tokens, viewports, out):
    return {"hub": args.hub, "sessionId": session_id, "tokens": tokens, "ops": args.ops, "opsPerSecond": args.ops_per_second,
            "viewportsPerSecond": viewports, "out": str(out)}


def table(results):
    lines = ["| People | Viewports moving | Median to each person | 95% | 99% | Median to whole room | 95% whole room | Ops missing |",
             "|---|---|---|---|---|---|---|---|"]
    for r in results:
        each, room = r["toEveryone"], r["wholeRoom"]
        moving = f"{r['viewportsPerSecond']:g}/s each" if r["viewportsPerSecond"] else "None"
        lines.append(f"| {r['people']} | {moving} | {each['median']:.1f}ms | {each['p95']:.1f}ms | {each['p99']:.1f}ms "
                     f"| {room['median']:.1f}ms | {room['p95']:.1f}ms | {r['opsNotReachingEveryone']} |")
    return "\n".join(lines)


def call(store, token, method, path, body=None):
    request = urllib.request.Request(store.rstrip("/") + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(request) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def one_run(args, people, viewports):
    host = access_token(args.keycloak, args.realm, args.username, args.password)
    session = call(args.store, host, "POST", "/sessions", {"slideId": args.slide, "collectionName": f"Latency {people} {viewports}", "maxEditors": 50})
    session_id = session["collectionId"]
    try:
        code = call(args.store, host, "POST", f"/collections/{session_id}/invites", {"role": "editor", "hours": 2})["code"]
        sims = sim_people(people - 1)
        ensure_people(args.keycloak, args.realm, args.admin_user, args.admin_password, sims)
        tokens = [host]
        for person in sims:
            token = access_token(args.keycloak, args.realm, person["username"], PASSWORD)
            call(args.store, token, "POST", f"/invites/{code}/accept")
            tokens.append(token)
        with tempfile.TemporaryDirectory() as folder:
            config, out = Path(folder) / "config.json", Path(folder) / "out.json"
            config.write_text(json.dumps(config_for(args, session_id, tokens, viewports, out)), encoding="utf-8")
            subprocess.run(["node", str(HERE / "eval_latency.mjs"), str(config)], check=True, timeout=args.ops / args.ops_per_second + 300)
            return json.loads(out.read_text(encoding="utf-8"))
    finally:
        call(args.store, host, "POST", f"/collections/{session_id}/end")


def main(argv=None):
    args = parse_args(argv)
    results = []
    for viewports in args.viewports:
        for people in args.people:
            print(f"{people} people, {viewports:g} viewport updates a second each", flush=True)
            results.append(one_run(args, people, viewports))
            last = results[-1]
            print(f"  median {last['toEveryone']['median']:.1f}ms, 95% {last['toEveryone']['p95']:.1f}ms, {last['opsNotReachingEveryone']} ops missing", flush=True)
            if args.out:
                Path(args.out).write_text(json.dumps({"settings": {k: v for k, v in vars(args).items() if "password" not in k}, "results": results}, indent=2), encoding="utf-8")
    print()
    print(table(results))


if __name__ == "__main__":
    main()
