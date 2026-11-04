"""Starts the whole project from one terminal - Keycloak, tiler,
annotation-store, realtime-hub and the viewer, plus the Grafana dashboard
with --dashboard - and shows every service's output in one place, each line
marked with where it came from. Ctrl+C stops what it started.

Anything already listening on a service's port is left alone and counted as
running, so it's safe to run with some of it already up. Keycloak and the
dashboard are Docker stacks and keep running after Ctrl+C, the same as
starting them by hand (--stop-docker to stop them too). Standard library only.

    python scripts/run_all.py
    python scripts/run_all.py --only store viewer
    python scripts/run_all.py --skip hub --dashboard
    python scripts/run_all.py --docker          # backend in containers, viewer with npm
"""
import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Service:
    name: str
    folder: str
    port: int
    url: str
    kind: str  # docker, dotnet or npm
    aliases: tuple = ()
    # Name in the root docker-compose.yml, for --docker. None if it isn't in it.
    compose: str | None = None
    # Checked over HTTP, not just the port - Keycloak opens its port well
    # before the realm can be used.
    ready_url: str | None = None
    by_default: bool = True


SERVICES = [
    Service("auth", "auth", 8080, "http://localhost:8080/auth/admin", "docker", ("keycloak",),
            compose="keycloak", ready_url="http://localhost:8080/auth/realms/diss"),
    Service("dashboard", "dashboard", 3000, "http://localhost:3000", "docker", ("grafana",), by_default=False),
    Service("tiler", "tiler", 5095, "http://localhost:5095", "dotnet", compose="tiler"),
    Service("store", "annotation-store", 5252, "http://localhost:5252", "dotnet", ("annotation-store",),
            compose="annotation-store"),
    Service("hub", "realtime-hub", 5180, "http://localhost:5180", "dotnet", ("realtime-hub",),
            compose="realtime-hub"),
    Service("viewer", "image-viewer", 5173, "https://localhost:5173", "npm", ("image-viewer",)),
]

# What --no-deps leaves out of the root compose file, so it's added by hand.
COMPOSE_NEEDS = {"keycloak": ["keycloak-db"], "annotation-store": ["annotation-db"]}


def lookup(name):
    wanted = name.lower()
    for service in SERVICES:
        if wanted == service.name or wanted in service.aliases:
            return service
    known = ", ".join(s.name for s in SERVICES)
    raise ValueError(f"no service called {name!r} - there's {known}")


def choose(only=None, skip=None, dashboard=False):
    """Which services to run, in start order."""
    if only:
        picked = {lookup(n).name for n in only}
    else:
        picked = {s.name for s in SERVICES if s.by_default or (dashboard and s.name == "dashboard")}
    picked -= {lookup(n).name for n in skip or []}
    return [s for s in SERVICES if s.name in picked]


def viewer_port(http):
    return 5174 if http else 5173


@dataclass
class Step:
    """One command to run, and the services it brings up."""
    name: str
    command: list
    cwd: Path
    services: list
    # Docker commands finish once the containers are up. The rest keep running
    # until stopped, so them finishing early means they fell over.
    detached: bool = False
    env: dict = field(default_factory=dict)


def keycloak_owner():
    """Which compose project made the diss-keycloak container - "auth" for
    auth/, "diss" for the root stack - or None if there isn't one. Both name
    it the same, so starting it from the other one fails."""
    try:
        result = subprocess.run(
            resolve(["docker", "inspect", "diss-keycloak", "--format",
                     '{{index .Config.Labels "com.docker.compose.project"}}']),
            capture_output=True, text=True, check=False, timeout=15)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    return (result.stdout.strip() or None) if result.returncode == 0 else None


def plan(services, *, docker=False, http=False, root=ROOT, keycloak_from=None):
    """The commands to start these services. Services already running should
    be left out before this. keycloak_from is what keycloak_owner() says."""
    steps = []
    stack = []
    for service in services:
        if docker and service.compose:
            stack.append(service)
        elif service.name == "auth" and keycloak_from == "diss":
            # Made by the root stack before, so start that one again.
            steps.append(Step(service.name, ["docker", "compose", "up", "-d", "--no-deps", "keycloak-db", "keycloak"],
                              root, [service], detached=True))
        elif service.kind == "docker":
            steps.append(Step(service.name, ["docker", "compose", "up", "-d"], root / service.folder, [service], detached=True))
        elif service.kind == "dotnet":
            steps.append(Step(service.name, ["dotnet", "run", "--urls", f"http://localhost:{service.port}"],
                              root / service.folder, [service]))
        elif service.kind == "npm":
            steps.append(Step(service.name, ["npm", "run", "dev:http" if http else "dev"], root / service.folder, [service]))
    if stack:
        names = []
        for service in stack:
            names += COMPOSE_NEEDS.get(service.compose, []) + [service.compose]
        # --no-deps so it only starts what's asked for - Keycloak already
        # running stays as it is.
        steps.insert(0, Step("stack", ["docker", "compose", "up", "-d", "--build", "--no-deps", *names], root, stack,
                             detached=True))
    return steps


def with_ports(services, http):
    """The viewer's port depends on --http."""
    out = []
    for s in services:
        if s.name == "viewer" and http:
            s = Service(**{**s.__dict__, "port": viewer_port(True), "url": f"http://localhost:{viewer_port(True)}"})
        out.append(s)
    return out


def port_open(port, host="127.0.0.1", timeout=0.3):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def url_ok(url, timeout=2):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return 200 <= response.status < 400
    except (urllib.error.URLError, OSError, ValueError):
        return False


def is_ready(service, port_check=port_open, url_check=url_ok):
    if not port_check(service.port):
        return False
    return url_check(service.ready_url) if service.ready_url else True


def warnings(services, *, docker, keycloak_from=None, port_check=port_open):
    """Things worth saying before starting, that don't stop anything."""
    out = []
    names = {s.name for s in services}
    if "store" in names and not docker and not port_check(5432):
        out.append("Nothing on port 5432 - annotation-store needs Postgres running (see SETUP.md)")
    if docker and names & {"auth", "store", "hub"} and keycloak_from == "auth":
        # The containerised store and hub find Keycloak by name inside the
        # stack, so they can't reach the auth/ one, and the stack can't start
        # its own while that container exists.
        out.append("Keycloak is from the auth/ stack - sign-in won't work in the containers. "
                   "Take it down first: docker compose -f auth/docker-compose.yml down")
    return out


class Output:
    """Prints each service's lines with its name in front, one at a time."""

    COLOURS = ("36", "33", "35", "32", "34", "91", "96")

    def __init__(self, colour, width):
        self.colour = colour
        self.width = width
        self.lock = threading.Lock()

    def tag(self, name):
        text = name.ljust(self.width)
        if not self.colour:
            return text
        names = [s.name for s in SERVICES]
        code = self.COLOURS[names.index(name) % len(self.COLOURS)] if name in names else "1"
        return f"\033[{code}m{text}\033[0m"

    def line(self, name, text):
        text = f"{self.tag(name)} | {text}"
        # Redirected to a file on Windows, stdout is cp1252, and Vite's arrows
        # would throw and stop that service's output for good.
        encoding = sys.stdout.encoding or "utf-8"
        text = text.encode(encoding, errors="replace").decode(encoding)
        with self.lock:
            print(text, flush=True)

    def note(self, text):
        self.line("run_all", text)


def use_colour(flag):
    if flag is False or os.environ.get("NO_COLOR") or not sys.stdout.isatty():
        return False
    if os.name == "nt":
        os.system("")  # turns on ANSI colours in the Windows console
    return True


def resolve(command):
    """npm is npm.cmd on Windows, which Popen won't find by its short name."""
    found = shutil.which(command[0])
    if not found:
        raise FileNotFoundError(f"{command[0]} isn't on the PATH")
    return [found, *command[1:]]


class Runner:
    def __init__(self, output, log_dir=None, quiet=False):
        self.output = output
        self.log_dir = log_dir
        self.quiet = quiet
        self.running = {}  # step name -> (step, process)
        self.tails = {}  # step name -> last few lines, for saying why it stopped

    def start(self, step):
        try:
            command = resolve(step.command)
        except FileNotFoundError as e:
            self.output.note(f"{step.name}: {e}")
            return False
        self.output.note(f"{step.name}: {' '.join(step.command)}  (in {step.cwd.relative_to(ROOT).as_posix()})")
        extra = {}
        if os.name != "nt":
            # Its own process group, so stopping it stops whatever it started.
            extra["start_new_session"] = True
        process = subprocess.Popen(command, cwd=step.cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, env={**os.environ, **step.env}, **extra)
        self.running[step.name] = (step, process)
        self.tails[step.name] = []
        threading.Thread(target=self._pump, args=(step.name, process), daemon=True).start()
        return True

    def _pump(self, name, process):
        if not self.log_dir:
            self._read(name, process, None)
            return
        with open(self.log_dir / f"{name}.log", "a", encoding="utf-8") as log:
            self._read(name, process, log)

    def _read(self, name, process, log):
        for raw in process.stdout:
            text = raw.decode("utf-8", errors="replace").rstrip()
            tail = self.tails[name]
            tail.append(text)
            del tail[:-15]
            if log:
                log.write(text + "\n")
                log.flush()
            if not self.quiet:
                self.output.line(name, text)

    def exited(self, name):
        _, process = self.running[name]
        return process.poll()

    # realtime-hub alone takes about 7s to shut down cleanly.
    def stop(self, grace=20):
        alive = [(step, p) for step, p in self.running.values() if p.poll() is None]
        if not alive:
            return
        self.output.note(f"stopping {', '.join(step.name for step, _ in alive)}")
        if os.name != "nt":
            for _, p in alive:
                try:
                    os.killpg(p.pid, signal.SIGINT)
                except ProcessLookupError:
                    pass
        # On Windows Ctrl+C already reached them - they share this console.
        deadline = time.monotonic() + grace
        for step, p in alive:
            try:
                p.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                self.output.note(f"{step.name} didn't stop in {grace}s - killing it")
                kill_tree(p)


def kill_tree(process):
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], capture_output=True, check=False)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait()


def summary(services, state):
    """state: service name -> ready, already running, failed or waiting."""
    width = max(len(s.name) for s in services)
    lines = []
    for s in services:
        lines.append(f"  {s.name.ljust(width)}  {state.get(s.name, 'waiting'):<15}  {s.url}")
    return "\n".join(lines)


def network_address():
    """This machine's address on the network with the default route - the one
    other machines on the LAN or VPN would use. Connecting a UDP socket sends
    nothing, it just makes the OS pick the address."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))  # documentation range, never reached
            address = s.getsockname()[0]
    except OSError:
        return None
    return None if address.startswith("127.") or address == "0.0.0.0" else address


def share_line(services, state, http, address):
    """Where other machines open the viewer, or why they can't. None if the
    viewer isn't part of this run or isn't up."""
    viewer = next((s for s in services if s.name == "viewer"), None)
    if not viewer or state.get(viewer.name) not in ("ready", "already running"):
        return None
    if http:
        return "Other machines can't reach the viewer - --http is localhost only"
    if not address:
        return "No network address found - other machines can't reach this one"
    url = f"https://{address}:{viewer.port}"
    # Something else started it, so it may not have --host.
    return f"Other machines: {url}" + (" (if it was started with --host)" if state[viewer.name] == "already running" else "")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    names = ", ".join(s.name for s in SERVICES)
    parser.add_argument("--only", nargs="+", metavar="NAME", help=f"just these ({names})")
    parser.add_argument("--skip", nargs="+", metavar="NAME", default=[], help="everything but these")
    parser.add_argument("--dashboard", action="store_true", help="Grafana too (off unless asked for)")
    parser.add_argument("--docker", action="store_true",
                        help="Keycloak, tiler, annotation-store and realtime-hub from the root docker-compose.yml "
                             "instead of dotnet - the viewer still runs with npm")
    parser.add_argument("--http", action="store_true", help="viewer on plain http://localhost:5174 (npm run dev:http)")
    parser.add_argument("--timeout", type=int, help="seconds to wait for everything to come up "
                                                    "(default 300, or 900 with --docker for the first build)")
    parser.add_argument("--logs", type=Path, metavar="DIR", help="also write each service's output to DIR/<name>.log")
    parser.add_argument("--quiet", action="store_true", help="don't show the services' output, just when they're up")
    parser.add_argument("--no-colour", dest="colour", action="store_false", default=None)
    parser.add_argument("--stop-docker", action="store_true",
                        help="stop the Docker stacks this started on Ctrl+C too (they keep running otherwise)")
    parser.add_argument("--list", action="store_true", help="list the services and exit")
    args = parser.parse_args(argv)
    try:
        args.services = with_ports(choose(args.only, args.skip, args.dashboard), args.http)
    except ValueError as e:
        parser.error(str(e))
    if args.timeout is None:
        args.timeout = 900 if args.docker else 300
    return args


def main(argv=None):
    args = parse_args(argv)
    if args.list:
        for s in with_ports(SERVICES, args.http):
            extra = "" if s.by_default else "  (with --dashboard)"
            print(f"{s.name:<10} {s.folder + '/':<18} {s.kind:<7} {s.url}{extra}")
        return 0
    if not args.services:
        print("Nothing to run.")
        return 1

    output = Output(use_colour(args.colour), max(len("run_all"), *(len(s.name) for s in args.services)))
    if args.logs:
        args.logs.mkdir(parents=True, exist_ok=True)
    runner = Runner(output, args.logs, args.quiet)
    state = {}

    keycloak_from = keycloak_owner() if any(s.name == "auth" for s in args.services) or args.docker else None
    for text in warnings(args.services, docker=args.docker, keycloak_from=keycloak_from):
        output.note(f"warning: {text}")

    to_start = []
    for s in args.services:
        if port_open(s.port):
            state[s.name] = "already running"
            output.note(f"{s.name}: something's already on port {s.port} - leaving it")
        else:
            to_start.append(s)

    steps = plan(to_start, docker=args.docker, http=args.http, keycloak_from=keycloak_from)
    started_docker = []
    try:
        for step in steps:
            if not runner.start(step):
                for s in step.services:
                    state[s.name] = "failed"
            elif step.detached:
                started_docker.append(step)

        deadline = time.monotonic() + args.timeout
        reported_down = set()
        while time.monotonic() < deadline:
            for step, process in runner.running.values():
                code = process.poll()
                if code is None or step.name in reported_down:
                    continue
                if step.detached and code == 0:
                    continue
                reported_down.add(step.name)
                for s in step.services:
                    state[s.name] = "failed"
                why = " - " + runner.tails[step.name][-1] if runner.tails[step.name] else ""
                output.note(f"{step.name} stopped with exit code {code}{why}")
            waiting = [s for s in args.services if s.name not in state]
            for s in waiting:
                if is_ready(s):
                    state[s.name] = "ready"
                    output.note(f"{s.name} is up - {s.url}")
            if all(s.name in state for s in args.services):
                break
            time.sleep(0.5)
        for s in args.services:
            state.setdefault(s.name, "not up yet")

        for row in summary(args.services, state).splitlines():
            output.note(row)
        share = share_line(args.services, state, args.http, network_address())
        if share:
            output.note(share)
        local = [step for step, _ in runner.running.values() if not step.detached]
        if not local:
            output.note("Nothing left running here.")
            return 0 if all(v in ("ready", "already running") for v in state.values()) else 1
        output.note("Ctrl+C to stop")
        while any(p.poll() is None for step, p in runner.running.values() if not step.detached):
            for step, process in runner.running.values():
                code = process.poll()
                if code is not None and not step.detached and step.name not in reported_down:
                    reported_down.add(step.name)
                    output.note(f"{step.name} stopped with exit code {code}")
            time.sleep(0.5)
        output.note("everything here has stopped")
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        runner.stop()
        if args.stop_docker:
            for step in started_docker:
                output.note(f"{step.name}: docker compose stop")
                subprocess.run(resolve(["docker", "compose", "stop"]), cwd=step.cwd, check=False)


if __name__ == "__main__":
    sys.exit(main())
