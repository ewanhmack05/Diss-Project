"""Fills a session with simulated people, for trying out large sessions,
the editor cap and viewport boxes without a room full of laptops.

Give it a session's invite link (Realtime > Session > Make a link in the
viewer), or just the code. Each simulated person opens it like a real one
would - so annotation-store's editor cap decides who can edit, the same as
for real people. Then they connect to realtime-hub and wander round the
slide, so they show up live in the viewer with moving viewport boxes.
Ctrl+C stops them.

The simulated people are Keycloak users sim1, sim2, ... (password
"password"), made through Keycloak's admin API the first time they're
needed. Needs Keycloak (auth/), annotation-store, realtime-hub and tiler
running. Standard library only - no pip install.

    python scripts/simulate_session.py "https://localhost:5173/?invite=juyhsUFHC4gB"
    python scripts/simulate_session.py juyhsUFHC4gB --people 12 --seconds 60
    python scripts/simulate_session.py juyhsUFHC4gB --leave    # take them out again
"""
import argparse
import base64
import itertools
import json
import random
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from keycloak_admin import add_admin_args, admin_token, create_user
from keycloak_login import access_token

PASSWORD = "password"
# Made up, so nobody's real name ends up in a test session.
NAMES = [
    ("Edward", "Elric"), ("Alphonse", "Elric"), ("Winry", "Rockbell"), ("Alex", "Armstrong"), ("Roy", "Mustang"),
    ("Riza", "Hawkeye"), ("Oliver", "Armstrong"), ("Izumi", "Curtis"), ("King", "Bradley"), ("Van", "Hohenheim"),
    ("Trisha", "Hohenheim"), ("Jean", "Havoc"), ("Maes", "Hughes"), ("Maria", "Ross"), ("Ling", "Yao"), ("Lan", "Fan"),
    ("Shou", "Tucker"), ("Sig", "Curtis")
]
MAX_PEOPLE = 120
# The screen each one pretends to have, for the size of their viewport box.
SCREEN = (1600, 900)
# Slide pixels per screen pixel - from close in to most of the slide.
RESOLUTIONS = (1.0, 24.0)
RECORD_SEPARATOR = "\x1e"


# --- Who the simulated people are ------------------------------------------

def sim_people(count):
    """sim1, sim2, ... with a made up name each - past the list, names repeat with a number."""
    people = []
    for i in range(1, count + 1):
        first, last = NAMES[(i - 1) % len(NAMES)]
        if i > len(NAMES):
            last = f"{last} {(i - 1) // len(NAMES) + 1}"
        people.append({"username": f"sim{i}", "firstName": first, "lastName": last})
    return people


def keycloak_user(person):
    """The body for Keycloak's create-user call. Email and names filled in so
    Keycloak doesn't stop them at a "complete your profile" page."""
    return {
        "username": person["username"],
        "enabled": True,
        "emailVerified": True,
        "firstName": person["firstName"],
        "lastName": person["lastName"],
        "email": f"{person['username']}@sim.test",
        "credentials": [{"type": "password", "value": PASSWORD, "temporary": False}],
    }


def invite_code(link):
    """The code from an invite link, or the code itself if that's what was given."""
    text = link.strip()
    query = urllib.parse.parse_qs(urllib.parse.urlparse(text).query)
    if "invite" in query:
        return query["invite"][0]
    if "?" in text or "/" in text:
        raise ValueError(f"No ?invite= in {text!r} - give the link from Make a link, or just its code")
    if not text:
        raise ValueError("No invite link or code given")
    return text


def token_subject(token):
    """The user id in an access token - Keycloak's sub claim. Read without
    checking the signature: it's our own token, only used to find ourselves."""
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))["sub"]


# --- Moving round the slide ------------------------------------------------

def viewport(center, resolution, screen=SCREEN):
    """What the viewer sends the hub: the view box before rotation, in map
    units (slide pixels, y from 0 at the top down to -height)."""
    half_w, half_h = screen[0] * resolution / 2, screen[1] * resolution / 2
    x, y = center
    return {"center": [x, y], "resolution": resolution, "rotation": 0,
            "extent": [x - half_w, y - half_h, x + half_w, y + half_h]}


def wander(center, resolution, bounds, rng):
    """One step of someone looking round: drift a little, sometimes zoom.
    The centre stays inside bounds (x0, x1, y0, y1)."""
    x0, x1, y0, y1 = bounds
    step = resolution * 120
    x = min(max(center[0] + rng.uniform(-step, step), x0), x1)
    y = min(max(center[1] + rng.uniform(-step, step), y0), y1)
    if rng.random() < 0.15:
        resolution = min(max(resolution * rng.choice((0.5, 2.0)), RESOLUTIONS[0]), RESOLUTIONS[1])
    return (x, y), resolution


def slide_bounds(tiler, slide):
    with urllib.request.urlopen(f"{tiler}/slides/{slide}") as response:
        info = json.load(response)
    return 0.0, float(info["width"]), -float(info["height"]), 0.0


def role_summary(joined, max_editors):
    """One line on how the cap played out."""
    editors = sum(1 for _, role in joined if role in ("editor", "owner"))
    viewers = sum(1 for _, role in joined if role == "viewer")
    size = "large" if len(joined) > max_editors else "small"
    return f"{len(joined)} people in it, {editors} of {max_editors} editing, {viewers} view only - a {size} session"


# --- annotation-store and Keycloak -----------------------------------------

def call(url, token=None, method="GET", body=None, ok=(200, 201, 204)):
    """JSON in, JSON out. Returns (status, json or None). 409 and 404 come
    back as statuses, not exceptions, because callers want to act on them."""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data, headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read()
        if error.code in ok or error.code in (404, 409):
            try:
                return error.code, json.loads(raw) if raw else None
            except json.JSONDecodeError:
                return error.code, None
        raise RuntimeError(f"{method} {url} -> {error.code}: {raw.decode(errors='replace')[:300]}") from None


def ensure_people(keycloak, realm, admin_user, admin_password, people):
    """Makes any of them Keycloak doesn't have yet. Returns how many were new."""
    admin = admin_token(keycloak, admin_user, admin_password)
    return sum(create_user(keycloak, realm, admin, keycloak_user(person)) for person in people)


# --- realtime-hub, over SignalR long polling --------------------------------

def hub_message(message):
    return json.dumps(message) + RECORD_SEPARATOR


def hub_records(text):
    """A long poll can bring several messages, each ending in the record separator."""
    return [json.loads(part) for part in text.split(RECORD_SEPARATOR) if part.strip()]


class Hub:
    """Just enough SignalR to join a session and send viewports. Long polling
    rather than WebSockets, because the standard library has no WebSocket
    client - the hub takes either."""

    def __init__(self, url, token):
        self.url, self.token = url, token
        self.ids = itertools.count(1)
        self.pending = {}
        self.closed = threading.Event()
        self.poller = None
        self.connection = None

    def _request(self, url, method="GET", body=None, timeout=30):
        req = urllib.request.Request(url, body.encode() if body is not None else None,
                                     {"Authorization": f"Bearer {self.token}", "Content-Type": "text/plain"},
                                     method=method)
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.read().decode()

    def start(self):
        _, negotiated = self._request(f"{self.url}/negotiate?negotiateVersion=1", "POST", "")
        token = json.loads(negotiated)["connectionToken"]
        self.connection = f"{self.url}?id={urllib.parse.quote(token)}"
        self.poller = threading.Thread(target=self._poll, daemon=True)
        self.poller.start()
        self._request(self.connection, "POST", hub_message({"protocol": "json", "version": 1}))

    def _poll(self):
        while not self.closed.is_set():
            try:
                status, text = self._request(self.connection, timeout=120)
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                if not self.closed.is_set():
                    time.sleep(1)
                continue
            if status == 204:
                break
            for message in hub_records(text):
                waiting = self.pending.pop(message.get("invocationId"), None)
                if message.get("type") == 3 and waiting:
                    waiting["result"] = message
                    waiting["done"].set()
                elif message.get("type") == 7:
                    self.closed.set()
        self.closed.set()

    def invoke(self, target, *arguments):
        """Calls a hub method and waits for its answer."""
        invocation = str(next(self.ids))
        waiting = {"done": threading.Event()}
        self.pending[invocation] = waiting
        self._request(self.connection, "POST",
                      hub_message({"type": 1, "invocationId": invocation, "target": target, "arguments": list(arguments)}))
        if not waiting["done"].wait(15):
            raise RuntimeError(f"No answer from the hub to {target}")
        if "error" in waiting["result"]:
            raise RuntimeError(f"{target}: {waiting['result']['error']}")
        return waiting["result"].get("result")

    def send(self, target, *arguments):
        """Calls a hub method without waiting - how the viewer sends viewports."""
        self._request(self.connection, "POST", hub_message({"type": 1, "target": target, "arguments": list(arguments)}))

    def stop(self):
        self.closed.set()
        if self.connection:
            try:
                self._request(self.connection, "DELETE")
            except (urllib.error.URLError, ConnectionError):
                pass


def look_round(hub, bounds, stop, every, seed):
    rng = random.Random(seed)
    x0, x1, y0, y1 = bounds
    center = (rng.uniform(x0, x1), rng.uniform(y0, y1))
    resolution = rng.uniform(*RESOLUTIONS)
    while not stop.is_set() and not hub.closed.is_set():
        try:
            hub.send("UpdateViewport", viewport(center, resolution))
        except (urllib.error.URLError, ConnectionError):
            break
        center, resolution = wander(center, resolution, bounds, rng)
        stop.wait(every)


# --- Putting it together -----------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("link", help="the session's invite link, or just its code")
    parser.add_argument("--people", type=int, default=8, help=f"how many simulated people, up to {MAX_PEOPLE} (default: %(default)s)")
    parser.add_argument("--store", default="http://localhost:5252", help="annotation-store URL (default: %(default)s)")
    parser.add_argument("--hub", default="http://localhost:5180/hubs/slides", help="realtime-hub's session hub (default: %(default)s)")
    parser.add_argument("--tiler", default="http://localhost:5095", help="tiler URL, for the slide's size (default: %(default)s)")
    parser.add_argument("--seconds", type=float, default=0, help="stop after this long - 0 runs until Ctrl+C (default: %(default)s)")
    parser.add_argument("--every", type=float, default=0.5, help="seconds between viewport moves (default: %(default)s)")
    parser.add_argument("--no-hub", action="store_true", help="just join the session - don't show up live")
    parser.add_argument("--leave", action="store_true", help="take the simulated people out of the session and stop")
    parser.add_argument("--keycloak", default="http://localhost:8080/auth", help="Keycloak URL (default: %(default)s)")
    parser.add_argument("--realm", default="diss", help="Keycloak realm (default: %(default)s)")
    add_admin_args(parser)
    args = parser.parse_args()
    if not 1 <= args.people <= MAX_PEOPLE:
        parser.error(f"--people has to be between 1 and {MAX_PEOPLE}")
    try:
        args.code = invite_code(args.link)
    except ValueError as problem:
        parser.error(str(problem))
    return args


def main():
    args = parse_args()
    keycloak = args.keycloak.rstrip("/")
    people = sim_people(args.people)

    made = ensure_people(keycloak, args.realm, args.admin_user, args.admin_password, people)
    if made:
        print(f"Made {made} new Keycloak user{'s' if made != 1 else ''}")
    tokens = {p["username"]: access_token(keycloak, args.realm, p["username"], PASSWORD) for p in people}

    # What the link is for - asked as the first sim person, since anyone
    # signed in can look.
    status, preview = call(f"{args.store}/invites/{args.code}", tokens[people[0]["username"]])
    if status == 404:
        raise SystemExit(f"No invite with code {args.code}")
    session_id = preview["collectionId"]
    print(f"Session: {preview['collectionName']}, hosted by {preview['hostName']}, slide {preview['slideId']}")

    if args.leave:
        gone = 0
        for person in people:
            token = tokens[person["username"]]
            status, _ = call(f"{args.store}/collections/{session_id}/members/{token_subject(token)}", token, "DELETE")
            gone += status == 204
        print(f"Took {gone} simulated {'person' if gone == 1 else 'people'} out of the session")
        return

    if preview["status"] != "open":
        raise SystemExit(f"That link has {preview['status']} - make a new one in the viewer")
    print(f"Joining through the link ({preview['role']})")
    view = None
    for person in people:
        status, view = call(f"{args.store}/invites/{args.code}/accept", tokens[person["username"]], "POST")
        if status != 200:
            raise RuntimeError(f"{person['username']} couldn't join: {status}")
        name = f"{person['firstName']} {person['lastName']}"
        print(f"  {name:<20} {view['myRole']}")
    print(role_summary([(m["displayName"], m["role"]) for m in view["members"]], view["maxEditors"]))

    if args.no_hub:
        return

    bounds = slide_bounds(args.tiler, preview["slideId"])
    stop = threading.Event()
    hubs = []
    for i, person in enumerate(people):
        hub = Hub(args.hub, tokens[person["username"]])
        hub.start()
        hub.invoke("JoinSession", session_id)
        hubs.append(hub)
        threading.Thread(target=look_round, args=(hub, bounds, stop, args.every, i), daemon=True).start()
    print(f"{len(hubs)} people live on slide {preview['slideId']} - " + ("Ctrl+C to stop" if not args.seconds else f"for {args.seconds:g}s"))

    # Short waits in a loop - on Windows a wait with no timeout can't be
    # broken by Ctrl+C.
    until = time.monotonic() + args.seconds if args.seconds else None
    try:
        while until is None or time.monotonic() < until:
            stop.wait(0.5)
            if all(hub.closed.is_set() for hub in hubs):
                print("The hub closed every connection")
                break
    except KeyboardInterrupt:
        pass
    stop.set()
    for hub in hubs:
        hub.stop()
    print("Stopped - they're still in the session. --leave takes them out.")


if __name__ == "__main__":
    main()
