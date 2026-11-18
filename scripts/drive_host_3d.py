"""Plays the host of a session in 3D, for trying Follow and Present on a
volume and timing how long a follower's camera takes to land.

Signs in as the session's host (alice by default - a local test user), joins
its room, sets the navigation mode, says it's in 3D on a slice, then moves its
camera round the block every --every seconds. Prints a line of JSON for each
move with when it was sent, in ms since 1970, so a follower's browser on the
same machine can be timed against it. Sets Free and leaves when it's done.

A browser signed in as the same person would be a second host, so follow as
someone else (bob, say). Needs Keycloak, annotation-store, realtime-hub and
tiler running. Standard library only.

    python scripts/drive_host_3d.py juyhsUFHC4gB --mode follow --moves 20 --every 1.5
    python scripts/drive_host_3d.py juyhsUFHC4gB --mode present --moves 5
    python scripts/drive_host_3d.py juyhsUFHC4gB --cut x --cut-position 0.3
    python scripts/drive_host_3d.py juyhsUFHC4gB --mode free --moves 1 --look 0.1 -0.2 0.3
    python scripts/drive_host_3d.py juyhsUFHC4gB --mode present --end-in-2d
"""
import argparse
import json
import time

from keycloak_login import access_token
from simulate_session import Hub, call, invite_code, orbit_camera, slide_bounds, three_d_screen, viewport


def camera_path(moves, start=0.0, step=0.9):
    """Where the camera goes, move by move: round the block a step at a time,
    up and down so it isn't the same height twice running."""
    return [orbit_camera(start + i * step, 0.9 if i % 2 else -0.3) for i in range(moves)]


def host_screen(cut="none", cut_position=0.5):
    """What the host's viewer says is on screen: 3D, with their cut."""
    screen = three_d_screen()
    screen["depth"]["settings"].update(cut=cut, cutPosition=cut_position)
    return screen


def look_request(view, point):
    """A "look here" from 3D: the host's viewport, camera and all, and the
    spot in the block they picked (block units) - what Shift+click sends."""
    return {**view, "point": list(point)}


def two_d_view(bounds, slice_):
    """The host after clicking through to 2D: a quarter of the way into the
    slide, close in, on their slice, no camera."""
    x0, x1, y0, y1 = bounds
    seen = viewport((x0 + (x1 - x0) / 4, y0 + (y1 - y0) / 4), 4.0)
    seen["z"] = slice_
    seen["camera"] = None
    return seen


def host_view(bounds, slice_, camera):
    """The host's viewport: the middle of the slide, on its slice, with the
    camera - what the viewer would send from the 3D view."""
    x0, x1, y0, y1 = bounds
    seen = viewport(((x0 + x1) / 2, (y0 + y1) / 2), 16.0)
    seen["z"] = slice_
    seen["camera"] = camera
    return seen


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("link", help="the session's invite link, or just its code")
    parser.add_argument("--mode", choices=("free", "follow", "present"), default="follow", help="navigation mode (default: %(default)s)")
    parser.add_argument("--look", type=float, nargs=3, metavar=("X", "Y", "Z"),
                        help="after the moves, ask everyone to look at this spot in the block (block units)")
    parser.add_argument("--end-in-2d", action="store_true",
                        help="after the moves, go to 2D on --slice, as clicking the tissue does")
    parser.add_argument("--moves", type=int, default=20, help="how many times to move the camera (default: %(default)s)")
    parser.add_argument("--every", type=float, default=1.5, help="seconds between moves (default: %(default)s)")
    parser.add_argument("--cut", choices=("none", "x", "y", "z", "diagonal"), default="none", help="the host's cut (default: %(default)s)")
    parser.add_argument("--cut-position", type=float, default=0.5, help="how far through the block it is, 0-1 (default: %(default)s)")
    parser.add_argument("--slice", type=int, default=7, help="the slice the host is on (default: %(default)s)")
    parser.add_argument("--user", default="alice", help="the session's host (default: %(default)s)")
    parser.add_argument("--password", default="password", help="their password (default: the realm's test one)")
    parser.add_argument("--store", default="http://localhost:5252", help="annotation-store URL (default: %(default)s)")
    parser.add_argument("--hub", default="http://localhost:5180/hubs/slides", help="realtime-hub's session hub (default: %(default)s)")
    parser.add_argument("--tiler", default="http://localhost:5095", help="tiler URL, for the slide's size (default: %(default)s)")
    parser.add_argument("--keycloak", default="http://localhost:8080/auth", help="Keycloak URL (default: %(default)s)")
    parser.add_argument("--realm", default="diss", help="Keycloak realm (default: %(default)s)")
    args = parser.parse_args()
    if args.moves < 1 or args.every <= 0:
        parser.error("--moves has to be at least 1 and --every more than 0")

    token = access_token(args.keycloak, args.realm, args.user, args.password)
    status, preview = call(f"{args.store}/invites/{invite_code(args.link)}", token)
    if status == 404:
        raise SystemExit("No invite with that code")
    bounds = slide_bounds(args.tiler, preview["slideId"])

    hub = Hub(args.hub, token)
    hub.start()
    try:
        hub.invoke("JoinSession", preview["collectionId"])
        hub.invoke("SetNavigation", args.mode)
        hub.send("UpdateScreen", host_screen(args.cut, args.cut_position))
        for move, camera in enumerate(camera_path(args.moves)):
            sent = time.time() * 1000
            hub.send("UpdateViewport", host_view(bounds, args.slice, camera))
            print(json.dumps({"move": move, "sentAt": round(sent, 1), "camera": camera}), flush=True)
            time.sleep(args.every)
        if args.look:
            view = host_view(bounds, args.slice, camera)
            hub.invoke("SendRequest", None, "look", look_request(view, args.look))
            print(json.dumps({"look": args.look, "sentAt": round(time.time() * 1000, 1)}), flush=True)
            time.sleep(args.every)
        if args.end_in_2d:
            screen = host_screen(args.cut, args.cut_position)
            screen["depth"]["view"] = "2d"
            hub.send("UpdateScreen", screen)
            hub.send("UpdateViewport", two_d_view(bounds, args.slice))
            print(json.dumps({"in2d": args.slice, "sentAt": round(time.time() * 1000, 1)}), flush=True)
            time.sleep(args.every * 2)
    finally:
        try:
            hub.invoke("SetNavigation", "free")
        finally:
            hub.stop()


if __name__ == "__main__":
    main()
