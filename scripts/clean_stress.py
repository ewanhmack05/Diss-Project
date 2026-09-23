"""Removes everything seed_stress.py added - annotations and cell counts
whose notes are "stress-test" - from a slide's collection. Anything else in
the collection is left alone.

Needs annotation-store running. Standard library only - no pip install.

    python scripts/clean_stress.py
    python scripts/clean_stress.py --slide 002
"""
import argparse
import json
import urllib.parse
import urllib.request

TAG = "stress-test"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--store", default="http://localhost:5252", help="annotation-store URL (default: %(default)s)")
    parser.add_argument("--slide", default="003", help="slide id (default: %(default)s)")
    parser.add_argument("--user", default="001", help="user id - the viewer's placeholder user (default: %(default)s)")
    return parser.parse_args()


def main():
    args = parse_args()
    query = urllib.parse.urlencode({"slideId": args.slide, "userId": args.user})
    with urllib.request.urlopen(f"{args.store}/collections?{query}") as response:
        collections = json.load(response)
    if not collections:
        print(f"No collection for slide {args.slide}, user {args.user} - nothing to remove.")
        return

    collection = collections[0]
    removed = {"annotations": 0, "cellcounts": 0}
    for kind, items in (("annotations", collection["annotations"]), ("cellcounts", collection["cellCounts"])):
        for item in items:
            if item["notes"] == TAG:
                urllib.request.urlopen(urllib.request.Request(f"{args.store}/{kind}/{item['id']}", method="DELETE"))
                removed[kind] += 1

    kept = len(collection["annotations"]) - removed["annotations"]
    print(f"Removed {removed['annotations']} annotations and {removed['cellcounts']} cell counts "
          f"from slide {args.slide}. {kept} other annotations left untouched.")


if __name__ == "__main__":
    main()
