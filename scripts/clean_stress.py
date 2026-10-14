"""Removes everything seed_stress.py added - annotations and cell counts
whose notes are "stress-test" - from the user's own collection for a slide.
Anything else in the collection is left alone.

Needs annotation-store and Keycloak (auth/) running. Signs in as the same
test user seed_stress.py does (alice by default). Standard library only -
no pip install.

    python scripts/clean_stress.py
    python scripts/clean_stress.py --slide 002
"""
import argparse
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from keycloak_login import access_token, add_login_args

TAG = "stress-test"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--store", default="http://localhost:5252", help="annotation-store URL (default: %(default)s)")
    parser.add_argument("--slide", default="003", help="slide id (default: %(default)s)")
    add_login_args(parser)
    return parser.parse_args()


def call(store, token, path, method="GET", body=None):
    req = urllib.request.Request(store + path, None if body is None else json.dumps(body).encode(),
                                 {"Content-Type": "application/json", "Authorization": f"Bearer {token}"}, method=method)
    with urllib.request.urlopen(req) as response:
        data = response.read()
        return json.loads(data) if data else None


def main():
    args = parse_args()
    token = access_token(args.keycloak, args.realm, args.username, args.password)
    collection_id = call(args.store, token, "/collections/ensure", "POST", {"slideId": args.slide})["collectionId"]

    removed, kept = {}, 0
    for kind in ("annotations", "cellcounts"):
        items = call(args.store, token, f"/{kind}?collectionId={collection_id}")
        stress = [item["id"] for item in items if item["notes"] == TAG]
        with ThreadPoolExecutor(8) as pool:
            list(pool.map(lambda item_id, kind=kind: call(args.store, token, f"/{kind}/{item_id}", "DELETE"), stress))
        removed[kind] = len(stress)
        if kind == "annotations":
            kept = len(items) - len(stress)

    print(f"Removed {removed['annotations']} annotations and {removed['cellcounts']} cell counts "
          f"from {args.username}'s collection on slide {args.slide}. {kept} other annotations left untouched.")


if __name__ == "__main__":
    main()
