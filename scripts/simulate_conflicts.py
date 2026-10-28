"""Simulated people recolouring the same few annotations at once - for
measuring what a session's edit policy does when two people change the same
thing (see annotation-store's Conflicts/EditConflicts.cs).

Same as simulate_session.py - give it a session's invite link and the sim
people join and look round the slide - but every so often each one who can
edit recolours one of a few shared annotations, from their own copy of its
colour. Someone else's change only reaches their copy --notice seconds after
it's saved: the gap between something changing and a person noticing, and
what decides how often two changes collide. Start the session with "Last
change wins" or "First change wins" and run this against each.

Under first change wins a save from an old copy is turned down; they then
put theirs over it (--use-mine of the time) or keep the other one. Under
last change wins it goes through, and annotation-store says it overwrote
someone. Each save goes out to everyone live the way the viewer sends it -
straight away under last change wins, once it's saved under first.

At the end it prints how many saves there were, how many collided and what
happened to them, and how long saves took. The same counts are on the
dashboard's Edits row.

The shared annotations are tagged like everything sim people make; --clean
removes them.

    python scripts/simulate_conflicts.py "https://localhost:5173/?invite=juyhsUFHC4gB" --seconds 120
    python scripts/simulate_conflicts.py juyhsUFHC4gB --targets 1 --change-every 2 --notice 3
    python scripts/simulate_conflicts.py juyhsUFHC4gB --clean    # remove the shared annotations
"""
import argparse
import json
import statistics
import threading
import time
import urllib.error
import urllib.request
import uuid

from simulate_annotations import COLOURS, clean, feature
from simulate_session import SIM_TAG, add_session_args, call, now_iso, run, send_op


class Board:
    """Every save of each shared annotation, when it landed - and what each
    person has seen of them. A person's copy is the latest save at least
    `notice` seconds old, unless they've heard something newer for
    themselves: their own save, or a 409 telling them what's there."""

    def __init__(self, notice):
        self.notice = notice
        self.targets = []
        self.policy = None
        self._saves = {}
        self._own = {}
        self._lock = threading.Lock()

    def add(self, target, colour, at=0.0):
        with self._lock:
            self.targets.append(target)
            self._saves[target] = [(at, colour)]

    def saved(self, target, colour, at):
        with self._lock:
            self._saves[target].append((at, colour))

    def heard(self, person, target, colour, at):
        with self._lock:
            self._own[(person, target)] = (at, colour)

    def copy(self, person, target, now):
        with self._lock:
            seen = [(at, colour) for at, colour in self._saves[target] if at <= now - self.notice] or self._saves[target][:1]
            latest = max(seen, key=lambda s: s[0])
            own = self._own.get((person, target))
            return own[1] if own and own[0] >= latest[0] else latest[1]


def pick_colour(rng, copy):
    """A palette colour that isn't the one they think it is now."""
    return rng.choice([c for c in COLOURS if c != copy])


class Tally:
    """What happened to every save, across everyone."""

    def __init__(self):
        self.saves = self.collided = self.refused = self.overwrote = self.used_mine = self.kept_theirs = 0
        self.ms = []
        self._lock = threading.Lock()

    def add(self, **counts):
        with self._lock:
            for name, n in counts.items():
                if name == "ms":
                    self.ms.append(n)
                else:
                    setattr(self, name, getattr(self, name) + n)

    def summary(self, policy):
        def share(n):
            return f"{n} ({100 * n / self.saves:.1f}%)" if self.saves else str(n)

        lines = [f"Policy: {policy}", f"Saves sent: {self.saves}", f"Collided with someone else's change: {share(self.collided)}"]
        if policy == "firstComeWins":
            lines += [f"  turned down: {self.refused}", f"    then used mine: {self.used_mine}", f"    then kept theirs: {self.kept_theirs}"]
        else:
            lines += [f"  overwrote it without anyone knowing: {self.overwrote}"]
        if self.ms:
            ordered = sorted(self.ms)
            p95 = ordered[min(len(ordered) - 1, int(0.95 * len(ordered)))]
            lines.append(f"Save time: median {statistics.median(ordered):.0f} ms, 95% under {p95:.0f} ms")
        return "\n".join(lines)


def save(person, target, label, colour, was):
    """PUT the new colour with the one it started from. (status, json,
    whether the store says it overwrote someone, milliseconds)."""
    body = json.dumps({"label": label, "notes": SIM_TAG, "colour": colour, "wasColour": was}).encode()
    request = urllib.request.Request(f"{person.store}/annotations/{target}", body, {
        "Content-Type": "application/json", "Authorization": f"Bearer {person.token}"}, method="PUT")
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request) as response:
            ms = 1000 * (time.perf_counter() - started)
            return response.status, json.loads(response.read()), response.headers.get("Overwrote") == "1", ms
    except urllib.error.HTTPError as error:
        ms = 1000 * (time.perf_counter() - started)
        if error.code != 409:
            raise RuntimeError(f"PUT {target} -> {error.code}: {error.read().decode(errors='replace')[:300]}") from None
        return 409, json.loads(error.read()), False, ms


BOARD = None
TALLY = Tally()
LABELS = {}
SETUP = threading.Lock()


def set_up(person, args):
    """The first editor to get here makes the shared annotations, in the
    middle of the slide, and finds out the session's policy."""
    with SETUP:
        if BOARD.targets:
            return
        _, session = call(f"{person.store}/collections/{person.session_id}", person.token)
        BOARD.policy = session["editPolicy"]
        x0, x1, y0, y1 = person.bounds
        cx, cy, size = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 20
        for i in range(args.targets):
            left = cx + (i - args.targets / 2) * size * 1.5
            ring = [[left, cy], [left + size, cy], [left + size, cy - size], [left, cy - size], [left, cy]]
            annotation = {"id": str(uuid.uuid4()), "label": f"Contested {i + 1}", "notes": SIM_TAG, "colour": COLOURS[0],
                          "shape": "rectangle", "lineStyle": "solid", "lineThickness": 3, "created": now_iso(),
                          "geoJson": feature({"type": "Polygon", "coordinates": [ring]})}
            call(f"{person.store}/annotations", person.token, "POST", {**annotation, "collectionId": person.session_id})
            send_op(person.hub, "create", "annotation", annotation["id"],
                    {**annotation, "createdById": person.user_id, "createdByName": person.name})
            LABELS[annotation["id"]] = annotation["label"]
            BOARD.add(annotation["id"], COLOURS[0], time.monotonic())
        print(f"{args.targets} shared annotation{'s' if args.targets != 1 else ''} to fight over - policy {BOARD.policy}")


def recolour(person, stop, args):
    """On their turn, sometimes: recolour one of the shared annotations from
    their copy, and deal with what comes back."""
    rng, state = person.rng, person.state
    if not BOARD.targets:
        set_up(person, args)
    now = time.monotonic()
    if "next" not in state:
        state["next"] = now + rng.uniform(0.5, args.change_every)
    if now < state["next"] or stop.is_set():
        return
    state["next"] = now + args.change_every * rng.uniform(0.6, 1.4)

    target = rng.choice(BOARD.targets)
    was = BOARD.copy(person.user_id, target, now)
    colour = pick_colour(rng, was)
    first = BOARD.policy == "firstComeWins"
    data = {"label": LABELS[target], "notes": SIM_TAG, "colour": colour}
    if not first:
        send_op(person.hub, "update", "annotation", target, data)

    status, body, overwrote, ms = save(person, target, LABELS[target], colour, was)
    TALLY.add(saves=1, ms=ms)
    if status == 200:
        BOARD.saved(target, body["colour"], time.monotonic())
        BOARD.heard(person.user_id, target, body["colour"], time.monotonic())
        if overwrote:
            TALLY.add(collided=1, overwrote=1)
        if first:
            send_op(person.hub, "update", "annotation", target, data)
        return

    # Turned down - theirs is there now.
    TALLY.add(collided=1, refused=1)
    theirs = body["current"]["colour"]
    BOARD.heard(person.user_id, target, theirs, time.monotonic())
    if rng.random() >= args.use_mine:
        TALLY.add(kept_theirs=1)
        return
    status, body, _, ms = save(person, target, LABELS[target], colour, theirs)
    TALLY.add(saves=1, ms=ms)
    if status == 200:
        TALLY.add(used_mine=1)
        BOARD.saved(target, body["colour"], time.monotonic())
        BOARD.heard(person.user_id, target, body["colour"], time.monotonic())
        send_op(person.hub, "update", "annotation", target, data)
    else:
        # Someone got in again in between.
        TALLY.add(collided=1, refused=1)


def main():
    global BOARD
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    add_session_args(parser, people=6)
    parser.add_argument("--targets", type=int, default=3, help="how many shared annotations they fight over (default: %(default)s)")
    parser.add_argument("--change-every", type=float, default=4, help="seconds between recolours, per editor - give or take (default: %(default)s)")
    parser.add_argument("--notice", type=float, default=2, help="seconds before someone sees another person's change (default: %(default)s)")
    parser.add_argument("--use-mine", type=float, default=0.5, help="how often, 0 to 1, someone turned down puts theirs over it anyway (default: %(default)s)")
    parser.add_argument("--clean", action="store_true", help="remove every annotation sim people made in the session, and stop")
    args, _ = parser.parse_known_args()
    if args.targets < 1 or args.change_every <= 0 or args.notice < 0 or not 0 <= args.use_mine <= 1:
        parser.error("--targets at least 1, --change-every above 0, --notice 0 or more, --use-mine from 0 to 1")
    BOARD = Board(args.notice)
    run(parser, act=recolour, clean=clean)
    if TALLY.saves:
        print()
        print(TALLY.summary(BOARD.policy))


if __name__ == "__main__":
    main()
