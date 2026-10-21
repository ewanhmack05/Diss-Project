"""Fills a session with a few days of made-up history, for working on the
viewer's History tab: alice (or --host) hosts a session called "History
test" on the slide, the other two join as editors, and the three of them make about 20
changes - an import, adds, recolours, groups, a merge, cell counts, deletes,
and a bulk delete that's put back. Some deletes are left deleted, so there's
something to put back.

Every change goes through annotation-store's API like the viewer's would.
annotation-store stamps them all as now, so afterwards the change sets and
the rows they made are moved back to when the story says, straight in
Postgres with psql, using the connection string in annotation-store/.env.
Only the session's own rows are touched.

Needs annotation-store, tiler and Keycloak (auth/) running. Standard
library only - no pip install.

    python scripts/seed_history.py
    python scripts/seed_history.py --clean
"""
import argparse
import glob
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from datetime import UTC, datetime, timedelta

from keycloak_login import access_token
from seed_stress import COLOURS, slide_bounds

SESSION_NAME = "History test"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ENV = os.path.join(HERE, "..", "annotation-store", ".env")

# Who does what, and how long ago - oldest first, the order they're made in.
# The kinds are handled in Story below.
STORY = [
    (110.0, "alice", "import"),
    (106.2, "bob", "add annotation"),
    (105.7, "bob", "add annotation"),
    (101.4, "carol", "add cell count"),
    (86.3, "alice", "recolour"),
    (84.1, "bob", "add group"),
    (83.0, "carol", "change annotation"),
    (80.5, "alice", "delete annotation"),
    (62.2, "bob", "bulk delete"),
    (61.9, "alice", "restore"),
    (58.0, "carol", "delete cell count"),
    (57.4, "carol", "add cell count"),
    (38.6, "alice", "merge groups"),
    (35.2, "bob", "add short-lived group"),
    (34.9, "bob", "delete group"),
    (30.1, "carol", "change cell count"),
    (27.3, "bob", "bulk delete and keep"),
    (5.2, "carol", "add annotation"),
    (4.6, "carol", "add annotation"),
    (3.1, "alice", "delete annotation"),
    (1.2, "bob", "change annotation"),
]
PEOPLE = ("alice", "bob", "carol")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--store", default="http://localhost:5252", help="annotation-store URL (default: %(default)s)")
    parser.add_argument("--tiler", default="http://localhost:5095", help="tiler URL, for the slide's size (default: %(default)s)")
    parser.add_argument("--slide", default="003", help="slide id (default: %(default)s)")
    parser.add_argument("--keycloak", default="http://localhost:8080/auth", help="Keycloak URL (default: %(default)s)")
    parser.add_argument("--realm", default="diss", help="Keycloak realm (default: %(default)s)")
    parser.add_argument("--password", default="password", help="the test users' password (default: the realm's one)")
    parser.add_argument("--env", default=DEFAULT_ENV, help="the .env with annotation-store's connection string (default: annotation-store/.env)")
    parser.add_argument("--psql", default=None, help="psql to run (default: on PATH, else C:/Program Files/PostgreSQL/*/bin)")
    parser.add_argument("--seed", type=int, default=7, help="random seed, so runs are repeatable (default: %(default)s)")
    parser.add_argument("--host", default="alice", choices=PEOPLE,
                        help="who hosts it - one person can only host one session per slide (default: %(default)s)")
    parser.add_argument("--clean", action="store_true", help=f'end and delete the "{SESSION_NAME}" session instead')
    return parser.parse_args()


def call(store, token, method, path, body=None):
    """Returns (body, change set id). Raises with annotation-store's own
    message if it says no."""
    data = None if body is None else json.dumps(body).encode()
    headers = {"Authorization": f"Bearer {token}"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(store + path, data, headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            text = response.read().decode()
            return (json.loads(text) if text else None), response.headers.get("Change-Set-Id")
    except urllib.error.HTTPError as error:
        raise SystemExit(f"{method} {path} -> {error.code}: {error.read().decode()[:300]}") from None


def connection(env_path):
    """The psql arguments and password from annotation-store's
    ConnectionStrings__AnnotationStore."""
    value = None
    with open(env_path, encoding="utf-8") as env:
        for line in env:
            if line.strip().startswith("ConnectionStrings__AnnotationStore="):
                value = line.strip().split("=", 1)[1]
    if not value:
        raise SystemExit(f"No ConnectionStrings__AnnotationStore in {env_path}")
    parts = {}
    for piece in value.split(";"):
        if "=" in piece:
            key, val = piece.split("=", 1)
            parts[key.strip().lower()] = val.strip()
    args = ["-h", parts.get("host", "localhost"), "-p", parts.get("port", "5432"),
            "-d", parts["database"], "-U", parts.get("username", "postgres")]
    return args, parts.get("password", "")


def find_psql(given):
    if given:
        return given
    found = shutil.which("psql") or sorted(glob.glob("C:/Program Files/PostgreSQL/*/bin/psql.exe"))[-1:]
    if not found:
        raise SystemExit("Can't find psql - pass --psql")
    return found if isinstance(found, str) else found[0]


def sql_time(now, hours_ago):
    return f"'{(now - timedelta(hours=hours_ago)).isoformat()}'::timestamptz"


def backdate_sql(now, collection_id, changes, rows, people_added):
    """One transaction moving everything back to when the story says.
    changes: [(change set id, hours ago)]. rows: {table: [(id column, id,
    hours ago)]}. Deleted rows take their deleting change's time."""
    lines = ["BEGIN;"]
    oldest = max(hours for _, hours in changes) + 1
    lines.append(f'UPDATE "Collections" SET "Created" = {sql_time(now, oldest)} WHERE "CollectionId" = \'{collection_id}\';')
    lines.append(f'UPDATE "CollectionMembers" SET "Added" = {sql_time(now, oldest)} '
                 f'WHERE "CollectionId" = \'{collection_id}\' AND "UserId" = \'{people_added[0]}\';')
    for user_id in people_added[1:]:
        lines.append(f'UPDATE "CollectionMembers" SET "Added" = {sql_time(now, oldest - 0.5)} '
                     f'WHERE "CollectionId" = \'{collection_id}\' AND "UserId" = \'{user_id}\';')
    for change_set, hours in changes:
        lines.append(f'UPDATE "ChangeSets" SET "Created" = {sql_time(now, hours)} WHERE "Id" = \'{change_set}\';')
    for table, items in rows.items():
        for column, row_id, hours in items:
            lines.append(f'UPDATE "{table}" SET "Created" = {sql_time(now, hours)} WHERE "{column}" = \'{row_id}\';')
    for table in ("Annotations", "AnnotationGroups", "CellCounts"):
        lines.append(f'UPDATE "{table}" t SET "Deleted" = c."Created" FROM "ChangeSets" c '
                     f'WHERE t."DeletedIn" = c."Id" AND t."CollectionId" = \'{collection_id}\';')
    lines.append("COMMIT;")
    return "\n".join(lines) + "\n"


def check_story(story):
    """Oldest first, and only people who are in the session."""
    hours = [h for h, _, _ in story]
    if hours != sorted(hours, reverse=True) or len(set(hours)) != len(hours):
        return "the story has to go oldest first, one change at a time"
    strangers = {who for _, who, _ in story} - set(PEOPLE)
    return f"{', '.join(sorted(strangers))} aren't in the session" if strangers else None


def shape(bounds, rng):
    x0, x1, y0, y1 = bounds
    cx, cy, w, h = rng.uniform(x0, x1), rng.uniform(y0, y1), rng.uniform(800, 3000), rng.uniform(800, 3000)
    ring = [[cx, cy], [cx + w, cy], [cx + w, cy - h], [cx, cy - h], [cx, cy]]
    return json.dumps({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": None})


class Story:
    """Plays STORY through the API, keeping what's there now so each step
    picks real things, and what to move back afterwards."""

    def __init__(self, store, tokens, session_id, bounds, rng):
        self.store, self.tokens, self.session_id, self.bounds, self.rng = store, tokens, session_id, bounds, rng
        self.annotations, self.groups, self.cell_counts = [], {}, []
        self.last_bulk_delete = None
        self.changes = []
        self.rows = {"Annotations": [], "AnnotationGroups": [], "CellCounts": []}
        self.label = 0

    def annotation(self, label=None):
        self.label += 1
        return {"id": str(uuid.uuid4()), "collectionId": self.session_id, "label": label or f"Region {self.label}",
                "notes": "", "colour": self.rng.choice(COLOURS[:7]), "shape": "rectangle", "lineStyle": "solid",
                "lineThickness": 2, "geoJson": shape(self.bounds, self.rng)}

    def pick(self, count, ungrouped=False):
        pool = [a for a in self.annotations if not ungrouped or not a.get("groupId")]
        return self.rng.sample(pool, min(count, len(pool)))

    def step(self, hours, who, kind):
        token, store, sid = self.tokens[who], self.store, self.session_id

        def made(table, column, row_id):
            self.rows[table].append((column, row_id, hours))

        if kind == "import":
            items = [self.annotation() for _ in range(40)]
            body, cs = call(store, token, "POST", f"/collections/{sid}/import", {
                "annotations": items, "cellCounts": [],
                "groups": [{"name": "Tumour margin", "annotationIds": [a["id"] for a in items[:10]], "notes": ""}]})
            # Comes back with each one's groupId set.
            for a in body["annotations"]:
                self.annotations.append(a)
                made("Annotations", "Id", a["id"])
            for g in body["groups"]:
                self.groups[g["name"]] = g["id"]
                made("AnnotationGroups", "Id", g["id"])
        elif kind == "add annotation":
            body, cs = call(store, token, "POST", "/annotations", self.annotation())
            self.annotations.append(body)
            made("Annotations", "Id", body["id"])
        elif kind == "change annotation":
            target = self.pick(1)[0]
            body, cs = call(store, token, "PUT", f"/annotations/{target['id']}",
                            {"label": f"{target['label']} (checked)", "notes": "Looked at again", "colour": target["colour"], "slideId": ""})
        elif kind == "delete annotation":
            target = self.pick(1)[0]
            body, cs = call(store, token, "DELETE", f"/annotations/{target['id']}")
            self.annotations.remove(target)
        elif kind == "recolour":
            ids = [a["id"] for a in self.pick(12)]
            body, cs = call(store, token, "PUT", "/annotations/bulk", {"collectionId": sid, "ids": ids, "colour": "#0913FB"})
        elif kind in ("bulk delete", "bulk delete and keep"):
            gone = self.pick(15 if kind == "bulk delete" else 25)
            body, cs = call(store, token, "POST", "/annotations/bulk-delete", {"collectionId": sid, "ids": [a["id"] for a in gone]})
            for a in gone:
                self.annotations.remove(a)
            self.last_bulk_delete = (cs, gone)
        elif kind == "restore":
            change_set, gone = self.last_bulk_delete
            body, cs = call(store, token, "POST", f"/changesets/{change_set}/restore")
            self.annotations.extend(gone)
        elif kind in ("add group", "add short-lived group"):
            name = "Stroma" if kind == "add group" else "Inflammation"
            members = self.pick(8 if kind == "add group" else 5, ungrouped=True)
            body, cs = call(store, token, "POST", "/annotationgroups",
                            {"collectionId": sid, "name": name, "annotationIds": [a["id"] for a in members]})
            self.groups[name] = body["id"]
            for a in members:
                a["groupId"] = body["id"]
            made("AnnotationGroups", "Id", body["id"])
        elif kind == "merge groups":
            body, cs = call(store, token, "POST", f"/annotationgroups/{self.groups['Stroma']}/merge",
                            {"intoId": self.groups["Tumour margin"]})
        elif kind == "delete group":
            body, cs = call(store, token, "DELETE", f"/annotationgroups/{self.groups['Inflammation']}")
        elif kind == "add cell count":
            dots = 120 if not self.cell_counts else 300
            x0, x1, y0, y1 = self.bounds
            cx, cy = self.rng.uniform(x0, x1), self.rng.uniform(y0, y1)
            points = [{"x": round(cx + self.rng.gauss(0, 900), 1), "y": round(cy + self.rng.gauss(0, 900), 1),
                       "colour": self.rng.choice(COLOURS[:3])} for _ in range(dots)]
            body, cs = call(store, token, "POST", "/cellcounts", {
                "collectionId": sid, "label": f"Count {len(self.rows['CellCounts']) + 1}", "notes": "",
                "dots": json.dumps(points), "withAnnotation": True, "withRoi": False, "count": dots, "dotSize": 6,
                "locationX": cx, "locationY": cy})
            self.cell_counts.append(body)
            made("CellCounts", "Id", body["id"])
        elif kind == "change cell count":
            target = self.cell_counts[-1]
            body, cs = call(store, token, "PUT", f"/cellcounts/{target['id']}", {
                "label": f"{target['label']} - rechecked", "notes": "", "withAnnotation": True, "withRoi": False,
                "count": target["count"], "dotSize": 8, "slideId": ""})
        elif kind == "delete cell count":
            target = self.cell_counts.pop(0)
            body, cs = call(store, token, "DELETE", f"/cellcounts/{target['id']}")
        else:
            raise SystemExit(f"Don't know how to {kind}")

        if not cs:
            raise SystemExit(f"{kind} came back without a Change-Set-Id - is annotation-store up to date?")
        self.changes.append((cs, hours))


def find_session(store, token, slide):
    collections, _ = call(store, token, "GET", f"/collections?slideId={slide}")
    return [c for c in collections if c["kind"] == "session" and c["myRole"] == "owner" and not c["ended"]], collections


def clean(args, token):
    collections, _ = call(args.store, token, "GET", f"/collections?slideId={args.slide}")
    ours = [c for c in collections if c["kind"] == "session" and c["myRole"] == "owner" and c["collectionName"] == SESSION_NAME]
    if not ours:
        print(f'No "{SESSION_NAME}" session to clean up.')
        return
    for session in ours:
        if not session["ended"]:
            call(args.store, token, "POST", f"/collections/{session['collectionId']}/end")
        call(args.store, token, "DELETE", f"/collections/{session['collectionId']}")
        print(f"Deleted {session['collectionId']} (hidden - annotation-store only soft deletes).")


def main():
    args = parse_args()
    problem = check_story(STORY)
    if problem:
        raise SystemExit(problem)

    tokens = {who: access_token(args.keycloak, args.realm, who, args.password) for who in PEOPLE}
    host = tokens[args.host]
    if args.clean:
        clean(args, host)
        return

    psql = find_psql(args.psql)
    psql_args, password = connection(args.env)
    live, _ = find_session(args.store, host, args.slide)
    if live:
        name = live[0]["collectionName"]
        if name == SESSION_NAME:
            raise SystemExit(f'There\'s already a "{SESSION_NAME}" session - run with --clean first.')
        raise SystemExit(f'{args.host} is already hosting "{name}" on slide {args.slide}, and only one at a time is allowed. '
                         "End it in the viewer, or pick another --host - this won't touch a real session.")

    session, _ = call(args.store, host, "POST", "/sessions", {"slideId": args.slide, "collectionName": SESSION_NAME})
    session_id = session["collectionId"]
    invite, _ = call(args.store, host, "POST", f"/collections/{session_id}/invites", {"role": "editor", "hours": 1})
    for who in PEOPLE:
        if who != args.host:
            call(args.store, tokens[who], "POST", f"/invites/{invite['code']}/accept")
    call(args.store, host, "DELETE", f"/collections/{session_id}/invites/{invite['code']}")
    print(f'Started "{SESSION_NAME}" ({session_id}) - {args.host} hosting, the others editing.')

    story = Story(args.store, tokens, session_id, slide_bounds(args.tiler, args.slide), random.Random(args.seed))
    for hours, who, kind in STORY:
        story.step(hours, who, kind)
        print(f"  {hours:6.1f}h ago  {who:<6} {kind}")

    _, collections = find_session(args.store, host, args.slide)
    members = next(c for c in collections if c["collectionId"] == session_id)["members"]
    user_ids = [session["ownerId"]] + [m["userId"] for m in members if m["userId"] != session["ownerId"]]
    now = datetime.now(UTC)
    sql = backdate_sql(now, session_id, story.changes, story.rows, user_ids)
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as script:
        script.write(sql)
    try:
        result = subprocess.run([psql, *psql_args, "-v", "ON_ERROR_STOP=1", "-q", "-f", script.name],
                                env={**os.environ, "PGPASSWORD": password}, capture_output=True, text=True, check=False)
    finally:
        os.unlink(script.name)
    if result.returncode != 0:
        raise SystemExit(f"psql couldn't move the times back:\n{result.stderr}")

    # The oldest change should now read as days ago through the API - if not,
    # psql wrote to a different database from the one the store reads.
    listed, _ = call(args.store, host, "GET", f"/changesets?collectionId={session_id}&skip={len(STORY) - 1}&take=1")
    oldest = datetime.fromisoformat(listed[0]["created"])
    if now - oldest < timedelta(hours=STORY[0][0] - 1):
        raise SystemExit("The changes are made but still read as now - is --env the database annotation-store uses?")
    print(f"Moved {len(story.changes)} changes back over {STORY[0][0] / 24:.1f} days. "
          f'Open the slide as alice, bob or carol, then Collections > Shared > "{SESSION_NAME}" > History.')


if __name__ == "__main__":
    sys.exit(main())
