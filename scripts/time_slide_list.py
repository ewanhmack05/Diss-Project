"""Times the tiler's GET /slides on a first start and on a restart, for a
folder of slides - what the gallery waits for before it shows anything.

The tiler keeps each MIRAX slide's info in <data>/.slide-info.json (see
tiler/Slides/SlideInfoCache.cs), so a restart shouldn't open any slides. This
starts it with nothing kept, times the list, stops it, starts it again and
times the list again. It fails if the restart is slower than --max-restart.

Builds the tiler in Release (so it doesn't touch a Debug one that's running)
and runs it on its own port, with the warm-up off so the first list is the
whole cost. Standard library only.

    python scripts/time_slide_list.py --data "F:/TCIA/.../PKG - Hungarian-Colorectal-Screening_v2"
    python scripts/time_slide_list.py --data tiler/data --keep     # restart only, from what's kept
"""
import argparse
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = pathlib.Path(__file__).resolve().parent.parent
CACHE_FILE = ".slide-info.json"


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--data", required=True, help="folder of slides - what Slides:DataPath would be")
    parser.add_argument("--port", type=int, default=5097, help="port to run the tiler on (default: %(default)s)")
    parser.add_argument("--max-restart", type=float, default=2.0, help="seconds the list may take after a restart (default: %(default)s)")
    parser.add_argument("--keep", action="store_true", help="don't remove what's kept first - only the restart is meaningful then")
    parser.add_argument("--no-build", action="store_true", help="use the Release build that's there")
    parser.add_argument("--json", help="also write the timings to this file")
    return parser.parse_args(argv)


def tiler_env(data, base=None):
    """The tiler's settings: the data folder, no warm-up, no telemetry exporter."""
    env = dict(os.environ if base is None else base)
    env["Slides__DataPath"] = str(data)
    env["Slides__WarmOnStart"] = "false"
    env["OTEL_SDK_DISABLED"] = "true"
    env["ASPNETCORE_ENVIRONMENT"] = "Production"
    return env


def verdict(first, restart, max_restart):
    """Passed, and a line saying why."""
    if restart is None:
        return False, "no restart timing"
    speedup = f", {first / restart:.0f}x faster" if first and restart > 0 else ""
    if restart > max_restart:
        return False, f"FAIL - restart took {restart:.2f}s, over {max_restart:.2f}s{speedup}"
    return True, f"PASS - restart took {restart:.2f}s, under {max_restart:.2f}s{speedup}"


def report(rows):
    width = max(len(name) for name, _, _ in rows)
    lines = [f"{'start'.ljust(width)}  {'GET /slides':>12}  {'slides':>6}"]
    for name, seconds, count in rows:
        lines.append(f"{name.ljust(width)}  {seconds:>11.2f}s  {count:>6}")
    return "\n".join(lines)


def wait_until_up(url, seconds=60):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(f"{url}/slides/-not-a-slide-", timeout=2)
            return
        except urllib.error.HTTPError:
            return  # 404 - it's answering
        except OSError:
            time.sleep(0.2)
    raise RuntimeError(f"the tiler didn't start on {url}")


def timed_list(dll, data, port):
    url = f"http://localhost:{port}"
    process = subprocess.Popen(
        ["dotnet", str(dll), "--urls", url, "--contentRoot", str(REPO / "tiler")],
        env=tiler_env(data), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_until_up(url)
        start = time.perf_counter()
        with urllib.request.urlopen(f"{url}/slides", timeout=600) as response:
            slides = json.load(response)
        return time.perf_counter() - start, len(slides)
    finally:
        process.terminate()
        process.wait(timeout=30)


def main(argv=None):
    args = parse_args(argv)
    data = pathlib.Path(args.data).resolve()
    if not data.is_dir():
        sys.exit(f"{data} isn't a folder")
    if not args.no_build:
        subprocess.run(["dotnet", "build", str(REPO / "tiler" / "Tiler.csproj"), "-c", "Release", "-v", "quiet", "-nologo"], check=True)
    dll = REPO / "tiler" / "bin" / "Release" / "net10.0" / "Tiler.dll"

    rows = []
    if not args.keep:
        (data / CACHE_FILE).unlink(missing_ok=True)
        rows.append(("first, nothing kept", *timed_list(dll, data, args.port)))
    rows.append(("restart", *timed_list(dll, data, args.port)))

    print(report(rows))
    first = rows[0][1] if not args.keep else None
    passed, line = verdict(first, rows[-1][1], args.max_restart)
    print(line)
    if args.json:
        pathlib.Path(args.json).write_text(json.dumps([{"start": n, "seconds": s, "slides": c} for n, s, c in rows], indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
