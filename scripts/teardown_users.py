"""Removes test users from Keycloak - the sim users simulate_session.py
makes, or anyone else added while testing - and takes them out of the
sessions they joined first, so they don't stay behind in People lists.

alice, bob and carol (the realm's own test users) are never removed, and
nor are Keycloak's service accounts - realtime-hub signs in with one.

Without --yes it only lists who would go. Needs Keycloak (auth/), and
annotation-store and tiler for leaving sessions. Standard library only.

    python scripts/teardown_users.py                 # who would go
    python scripts/teardown_users.py --yes           # remove them
    python scripts/teardown_users.py --sim-only --yes
"""
import argparse
import re
import urllib.error

from keycloak_admin import add_admin_args, admin_token, delete_user, list_users
from keycloak_login import access_token
from simulate_session import PASSWORD, call, token_subject

# The realm's own test users (auth/realm/diss-realm.json).
PROTECTED = ("alice", "bob", "carol")
SIM_USER = re.compile(r"^sim\d+$")


def is_protected(user, keep=()):
    username = user["username"].lower()
    return (username in PROTECTED or username in {k.lower() for k in keep}
            or username.startswith("service-account-") or bool(user.get("serviceAccountClientId")))


def to_remove(users, keep=(), sim_only=False):
    """The users teardown would remove, by username."""
    chosen = [u for u in users if not is_protected(u, keep) and (not sim_only or SIM_USER.match(u["username"]))]
    return sorted(chosen, key=lambda u: (not SIM_USER.match(u["username"]), _number(u["username"]), u["username"]))


def _number(username):
    match = SIM_USER.match(username)
    return int(username[3:]) if match else 0


def their_collections(collections, user_id):
    """Of a slide's collections, the sessions they're in but don't host, and
    the collections they own. Someone else's shared collection is listed
    too but they aren't in it, so it's left out."""
    joined, owned = [], []
    for collection in collections:
        mine = next((m for m in collection["members"] if m["userId"] == user_id), None)
        if mine is None:
            continue
        (owned if mine["role"] == "owner" else joined).append(collection)
    return joined, owned


def leave_everything(store, tiler, token, delete_owned):
    """Takes them out of every session they've joined, on every slide.
    Returns (left, owned) - owned is what they host, removed only with
    delete_owned, since it holds other people's work too."""
    user_id = token_subject(token)
    _, slides = call(f"{tiler}/slides")
    left, owned = 0, []
    for slide in slides:
        _, collections = call(f"{store}/collections?slideId={slide['id']}", token)
        joined, mine = their_collections(collections or [], user_id)
        for collection in joined:
            status, _ = call(f"{store}/collections/{collection['collectionId']}/members/{user_id}", token, "DELETE")
            left += status == 204
        for collection in mine:
            if delete_owned:
                call(f"{store}/collections/{collection['collectionId']}", token, "DELETE")
            owned.append(f"{collection['kind']} {collection['collectionName']!r} on slide {slide['id']}")
    return left, owned


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--yes", action="store_true", help="actually remove them - without it, only lists who would go")
    parser.add_argument("--sim-only", action="store_true", help="only the sim users (sim1, sim2, ...) simulate_session.py makes")
    parser.add_argument("--keep", nargs="*", default=[], help="more usernames to leave alone, on top of alice, bob and carol")
    parser.add_argument("--delete-owned", action="store_true",
                        help="also delete collections and sessions they own - other people's work in them goes too")
    parser.add_argument("--keycloak-only", action="store_true", help="just remove them from Keycloak - don't leave sessions first")
    parser.add_argument("--password", default=PASSWORD, help="their password, to sign in as them and leave sessions (default: the test users' one)")
    parser.add_argument("--store", default="http://localhost:5252", help="annotation-store URL (default: %(default)s)")
    parser.add_argument("--tiler", default="http://localhost:5095", help="tiler URL, for the list of slides (default: %(default)s)")
    parser.add_argument("--keycloak", default="http://localhost:8080/auth", help="Keycloak URL (default: %(default)s)")
    parser.add_argument("--realm", default="diss", help="Keycloak realm (default: %(default)s)")
    add_admin_args(parser)
    return parser.parse_args()


def main():
    args = parse_args()
    keycloak = args.keycloak.rstrip("/")
    admin = admin_token(keycloak, args.admin_user, args.admin_password)
    users = list_users(keycloak, args.realm, admin)
    going = to_remove(users, args.keep, args.sim_only)
    kept = sorted(u["username"] for u in users if u not in going)

    print(f"Keeping {len(kept)}: {', '.join(kept) or 'nobody'}")
    if not going:
        print("Nobody to remove")
        return
    print(f"{'Removing' if args.yes else 'Would remove'} {len(going)}: {', '.join(u['username'] for u in going)}")
    if not args.yes:
        print("Nothing changed - run again with --yes to remove them")
        return

    for user in going:
        note = ""
        if not args.keycloak_only:
            try:
                token = access_token(keycloak, args.realm, user["username"], args.password)
                left, owned = leave_everything(args.store, args.tiler, token, args.delete_owned)
                note = f"left {left} session{'s' if left != 1 else ''}"
                if owned:
                    note += ("; deleted " if args.delete_owned else "; still owns ") + "; ".join(owned)
            except RuntimeError as problem:
                note = f"couldn't leave sessions ({problem}) - still listed in them"
            except urllib.error.URLError as problem:
                raise SystemExit(f"Couldn't reach annotation-store or tiler ({problem.reason}) - "
                                 "start them, or use --keycloak-only") from None
        deleted = delete_user(keycloak, args.realm, admin, user["id"])
        print(f"  {user['username']:<10} {'removed' if deleted else 'already gone'}{' - ' + note if note else ''}")


if __name__ == "__main__":
    main()
