"""Runs simulate_conflicts.py across both edit policies, at several group sizes
and notice delays, and adds it up - the numbers for comparing what each policy
does when two people change the same thing. See docs/evaluation.md.

Each run gets a session of its own, started by alice under that policy, with a
link for the simulated people, ended afterwards. Sessions stay there, so point
it at a throwaway database rather than the one you work in. Takes a while: every
combination, for --seconds, --repeats times. Standard library only.

    python scripts/eval_conflicts.py --store http://localhost:5253 --hub http://localhost:5181/hubs/slides --out conflicts.json
    python scripts/eval_conflicts.py --people 6 --notice 2 --seconds 20 --repeats 1   # a quick look
"""
import argparse
import itertools
import json
import statistics
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

from keycloak_login import access_token

HERE = Path(__file__).resolve().parent
POLICIES = ("lastWriteWins", "firstComeWins")
COUNTS = ("saves", "collided", "overwrote", "refused", "used_mine", "kept_theirs")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--store", default="http://localhost:5252", help="annotation-store URL (default: %(default)s)")
    parser.add_argument("--hub", default="http://localhost:5180/hubs/slides", help="realtime-hub's session hub (default: %(default)s)")
    parser.add_argument("--slide", default="003", help="slide id (default: %(default)s)")
    parser.add_argument("--people", type=int, nargs="+", default=[2, 6, 12], help="how many people edit (default: %(default)s)")
    parser.add_argument("--notice", type=float, nargs="+", default=[0.5, 2, 5], help="seconds before someone sees a change (default: %(default)s)")
    parser.add_argument("--seconds", type=float, default=60, help="how long each run lasts (default: %(default)s)")
    parser.add_argument("--repeats", type=int, default=3, help="runs of each combination, each with its own seed (default: %(default)s)")
    parser.add_argument("--targets", type=int, default=3, help="annotations they fight over (default: %(default)s)")
    parser.add_argument("--change-every", type=float, default=4, help="seconds between recolours, per person (default: %(default)s)")
    parser.add_argument("--use-mine", type=float, default=0.5, help="how often someone turned down puts theirs over it (default: %(default)s)")
    parser.add_argument("--out", help="write every run and the summary to this file, as it goes")
    parser.add_argument("--keycloak", default="http://localhost:8080/auth", help="Keycloak URL (default: %(default)s)")
    parser.add_argument("--realm", default="diss", help="Keycloak realm (default: %(default)s)")
    parser.add_argument("--username", default="alice", help="who starts the sessions (default: %(default)s)")
    parser.add_argument("--password", default="password", help="their password (default: %(default)s)")
    return parser.parse_args(argv)


def grid(policies, people, notice, repeats):
    """Every run to do, shuffled by nothing - in order, so a stopped run is easy to read."""
    return [{"policy": policy, "people": count, "notice": delay, "seed": seed}
            for policy, count, delay, seed in itertools.product(policies, people, notice, range(repeats))]


def spread(values):
    """Mean and standard deviation, which is 0 for a single run."""
    return statistics.fmean(values), statistics.stdev(values) if len(values) > 1 else 0.0


def percent(part, whole):
    return 100 * part / whole if whole else 0.0


def per_minute(count, seconds, people):
    return 60 * count / (seconds * people)


def summarise(runs, seconds):
    """One row per policy, group size and notice, across its repeats. Silently lost
    is a change that was replaced without anyone being told: only last change wins
    can do that. Asked is someone being stopped to choose: only first change wins."""
    rows = []
    keys = sorted({(r["policy"], r["people"], r["notice"]) for r in runs})
    for policy, people, notice in keys:
        group = [r for r in runs if (r["policy"], r["people"], r["notice"]) == (policy, people, notice)]
        collision_rates = [percent(r["collided"], r["saves"]) for r in group]
        silent_rates = [percent(r["overwrote"], r["saves"]) for r in group]
        asked_rates = [per_minute(r["refused"], seconds, people) for r in group]
        mean_rate, sd_rate = spread(collision_rates)
        rows.append({
            "policy": policy, "people": people, "notice": notice, "runs": len(group),
            "saves": sum(r["saves"] for r in group),
            "collided": sum(r["collided"] for r in group),
            "collision_percent": mean_rate,
            "collision_percent_sd": sd_rate,
            "silently_lost": sum(r["overwrote"] for r in group),
            "silently_lost_percent": spread(silent_rates)[0],
            "turned_down": sum(r["refused"] for r in group),
            "used_mine": sum(r["used_mine"] for r in group),
            "kept_theirs": sum(r["kept_theirs"] for r in group),
            "asked_per_person_minute": spread(asked_rates)[0],
            "save_ms_median": statistics.median(ms for r in group for ms in r["ms"]) if any(r["ms"] for r in group) else None,
        })
    return rows


def table(rows):
    lines = ["| Policy | People | Notice | Saves | Collided | Silently lost | Turned down | Asked per person per minute | Median save |",
             "|---|---|---|---|---|---|---|---|---|"]
    for row in rows:
        name = "First change wins" if row["policy"] == "firstComeWins" else "Last change wins"
        save = f"{row['save_ms_median']:.0f}ms" if row["save_ms_median"] is not None else "-"
        lines.append(f"| {name} | {row['people']} | {row['notice']:g}s | {row['saves']} "
                     f"| {row['collided']} ({row['collision_percent']:.1f}% ± {row['collision_percent_sd']:.1f}) "
                     f"| {row['silently_lost']} | {row['turned_down']} | {row['asked_per_person_minute']:.2f} | {save} |")
    return "\n".join(lines)


def conflict_command(args, code, run, out):
    return [sys.executable, str(HERE / "simulate_conflicts.py"), code,
            "--people", str(run["people"]), "--notice", str(run["notice"]), "--seconds", str(args.seconds),
            "--seed", str(run["seed"]), "--targets", str(args.targets), "--change-every", str(args.change_every),
            "--use-mine", str(args.use_mine), "--store", args.store, "--hub", args.hub,
            "--keycloak", args.keycloak, "--realm", args.realm, "--json", str(out)]


class Store:
    def __init__(self, url, token):
        self.url, self.token = url.rstrip("/"), token

    def call(self, method, path, body=None):
        request = urllib.request.Request(self.url + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                         headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        with urllib.request.urlopen(request) as response:
            raw = response.read()
            return json.loads(raw) if raw else None


def one_run(args, store, run):
    session = store.call("POST", "/sessions", {"slideId": args.slide, "collectionName": f"Conflicts {run['policy']} {run['people']} {run['notice']} {run['seed']}",
                                               "maxEditors": 50, "editPolicy": run["policy"]})
    session_id = session["collectionId"]
    try:
        code = store.call("POST", f"/collections/{session_id}/invites", {"role": "editor", "hours": 2})["code"]
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "run.json"
            subprocess.run(conflict_command(args, code, run, out), check=True, capture_output=True, text=True)
            result = json.loads(out.read_text(encoding="utf-8"))
        result["changes_in_history"] = store.call("GET", f"/changesets/total?collectionId={session_id}")
        return {**run, **result}
    finally:
        store.call("POST", f"/collections/{session_id}/end")


def main(argv=None):
    args = parse_args(argv)
    store = Store(args.store, access_token(args.keycloak, args.realm, args.username, args.password))
    runs = []
    todo = grid(POLICIES, args.people, args.notice, args.repeats)
    for number, run in enumerate(todo, 1):
        print(f"{number}/{len(todo)}: {run['policy']}, {run['people']} people, notice {run['notice']:g}s, seed {run['seed']}", flush=True)
        # Tokens last minutes, and a long grid outlasts one.
        store.token = access_token(args.keycloak, args.realm, args.username, args.password)
        runs.append(one_run(args, store, run))
        last = runs[-1]
        print(f"  {last['saves']} saves, {last['collided']} collided, {last['overwrote']} overwrote, {last['refused']} turned down", flush=True)
        if args.out:
            Path(args.out).write_text(json.dumps({"settings": {k: v for k, v in vars(args).items() if k != "password"}, "runs": runs, "summary": summarise(runs, args.seconds)}, indent=2), encoding="utf-8")
    print()
    print(table(summarise(runs, args.seconds)))


if __name__ == "__main__":
    main()
