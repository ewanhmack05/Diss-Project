"""Tests for run_all.py's parts that don't start anything.

    python -m unittest discover -s scripts
"""
import os
import subprocess
import sys
import unittest
from pathlib import Path

from run_all import (
    SERVICES,
    choose,
    is_ready,
    lookup,
    network_address,
    parse_args,
    plan,
    share_line,
    summary,
    warnings,
    with_ports,
)

ROOT = Path("/repo")


def names(services):
    return [s.name for s in services]


class Choosing(unittest.TestCase):
    def test_everything_but_the_dashboard_by_default(self):
        self.assertEqual(["auth", "tiler", "store", "hub", "viewer"], names(choose()))

    def test_dashboard_when_asked(self):
        self.assertIn("dashboard", names(choose(dashboard=True)))

    def test_only_keeps_start_order_whatever_order_theyre_given_in(self):
        self.assertEqual(["store", "viewer"], names(choose(only=["viewer", "store"])))

    def test_only_can_pick_the_dashboard(self):
        self.assertEqual(["dashboard"], names(choose(only=["dashboard"])))

    def test_skip(self):
        self.assertEqual(["auth", "tiler", "store", "viewer"], names(choose(skip=["hub"])))

    def test_folder_names_and_aliases_work(self):
        self.assertEqual("store", lookup("annotation-store").name)
        self.assertEqual("hub", lookup("realtime-hub").name)
        self.assertEqual("viewer", lookup("image-viewer").name)
        self.assertEqual("auth", lookup("Keycloak").name)

    def test_unknown_name_says_what_there_is(self):
        with self.assertRaisesRegex(ValueError, "no service called 'tilr'.*tiler"):
            lookup("tilr")

    def test_bad_name_is_an_argument_error(self):
        with self.assertRaises(SystemExit):
            parse_args(["--only", "nope"])


class Planning(unittest.TestCase):
    def test_each_service_runs_from_its_own_folder(self):
        # annotation-store reads .env from where it's run, so the folder matters.
        steps = {s.name: s for s in plan(choose(), root=ROOT)}
        self.assertEqual(ROOT / "annotation-store", steps["store"].cwd)
        self.assertEqual(["dotnet", "run", "--urls", "http://localhost:5252"], steps["store"].command)
        self.assertEqual(["dotnet", "run", "--urls", "http://localhost:5095"], steps["tiler"].command)
        self.assertEqual(["dotnet", "run", "--urls", "http://localhost:5180"], steps["hub"].command)
        self.assertEqual(["npm", "run", "dev"], steps["viewer"].command)
        self.assertEqual(ROOT / "image-viewer", steps["viewer"].cwd)

    def test_keycloak_is_its_own_compose_stack_and_doesnt_count_as_falling_over(self):
        auth = plan([lookup("auth")], root=ROOT)[0]
        self.assertEqual(["docker", "compose", "up", "-d"], auth.command)
        self.assertEqual(ROOT / "auth", auth.cwd)
        self.assertTrue(auth.detached)

    def test_keycloak_made_by_the_root_stack_is_started_from_there(self):
        # auth/ would try to make a second container with the same name.
        auth = plan([lookup("auth")], root=ROOT, keycloak_from="diss")[0]
        self.assertEqual(["docker", "compose", "up", "-d", "--no-deps", "keycloak-db", "keycloak"], auth.command)
        self.assertEqual(ROOT, auth.cwd)
        self.assertTrue(auth.detached)

    def test_keycloak_from_auth_or_nowhere_uses_auth(self):
        for owner in ("auth", None):
            self.assertEqual(ROOT / "auth", plan([lookup("auth")], root=ROOT, keycloak_from=owner)[0].cwd)

    def test_the_long_running_ones_arent_detached(self):
        steps = plan(choose(skip=["auth"]), root=ROOT)
        self.assertFalse(any(s.detached for s in steps))

    def test_http_viewer(self):
        services = with_ports(choose(only=["viewer"]), http=True)
        self.assertEqual(5174, services[0].port)
        self.assertEqual("http://localhost:5174", services[0].url)
        self.assertEqual(["npm", "run", "dev:http"], plan(services, http=True, root=ROOT)[0].command)

    def test_with_ports_leaves_the_rest_alone(self):
        self.assertEqual([s.port for s in SERVICES], [s.port for s in with_ports(SERVICES, http=False)])


class DockerPlanning(unittest.TestCase):
    def test_backend_goes_in_one_compose_up_with_its_databases(self):
        steps = plan(choose(), docker=True, root=ROOT)
        self.assertEqual(["stack", "viewer"], [s.name for s in steps])
        stack = steps[0]
        self.assertEqual(ROOT, stack.cwd)
        self.assertEqual(["docker", "compose", "up", "-d", "--build", "--no-deps",
                          "keycloak-db", "keycloak", "tiler", "annotation-db", "annotation-store", "realtime-hub"],
                         stack.command)
        self.assertEqual(["auth", "tiler", "store", "hub"], names(stack.services))
        self.assertTrue(stack.detached)

    def test_keycloak_already_running_isnt_started_twice(self):
        # Its container has the same name in both stacks, so a second one fails.
        services = [s for s in choose() if s.name != "auth"]
        stack = plan(services, docker=True, root=ROOT)[0]
        self.assertNotIn("keycloak", stack.command)
        self.assertNotIn("keycloak-db", stack.command)
        self.assertIn("annotation-db", stack.command)

    def test_dashboard_stays_its_own_stack(self):
        steps = plan(choose(only=["dashboard", "tiler"]), docker=True, root=ROOT)
        self.assertEqual(["stack", "dashboard"], [s.name for s in steps])
        self.assertEqual(ROOT / "dashboard", steps[1].cwd)

    def test_first_build_gets_longer(self):
        self.assertEqual(900, parse_args(["--docker"]).timeout)
        self.assertEqual(300, parse_args([]).timeout)
        self.assertEqual(60, parse_args(["--docker", "--timeout", "60"]).timeout)


class Ready(unittest.TestCase):
    def test_port_is_enough_for_most(self):
        self.assertTrue(is_ready(lookup("tiler"), port_check=lambda p: True, url_check=lambda u: False))
        self.assertFalse(is_ready(lookup("tiler"), port_check=lambda p: False, url_check=lambda u: True))

    def test_keycloak_needs_its_realm_to_answer_not_just_the_port(self):
        auth = lookup("auth")
        self.assertFalse(is_ready(auth, port_check=lambda p: True, url_check=lambda u: False))
        asked = []
        self.assertTrue(is_ready(auth, port_check=lambda p: True, url_check=lambda u: asked.append(u) or True))
        self.assertEqual(["http://localhost:8080/auth/realms/diss"], asked)


class Warnings(unittest.TestCase):
    def test_store_without_postgres(self):
        found = warnings(choose(), docker=False, port_check=lambda p: p != 5432)
        self.assertEqual(1, len(found))
        self.assertIn("5432", found[0])

    def test_no_postgres_warning_in_docker_mode_it_has_its_own(self):
        self.assertEqual([], warnings(choose(), docker=True, port_check=lambda p: False))

    def test_docker_backend_with_the_auth_stacks_keycloak(self):
        found = warnings(choose(), docker=True, keycloak_from="auth", port_check=lambda p: True)
        self.assertEqual(1, len(found))
        self.assertIn("auth/docker-compose.yml down", found[0])

    def test_docker_backend_with_its_own_keycloak_is_fine(self):
        self.assertEqual([], warnings(choose(), docker=True, keycloak_from="diss", port_check=lambda p: True))

    def test_auth_stack_keycloak_is_fine_without_docker(self):
        self.assertEqual([], warnings(choose(), docker=False, keycloak_from="auth", port_check=lambda p: True))

    def test_nothing_to_say(self):
        self.assertEqual([], warnings(choose(), docker=False, port_check=lambda p: True))


class Summary(unittest.TestCase):
    def test_one_line_each_with_where_to_find_it(self):
        text = summary(choose(only=["tiler", "viewer"]), {"tiler": "ready"})
        lines = text.splitlines()
        self.assertEqual(2, len(lines))
        self.assertIn("ready", lines[0])
        self.assertIn("http://localhost:5095", lines[0])
        self.assertIn("waiting", lines[1])
        self.assertIn("https://localhost:5173", lines[1])



class Sharing(unittest.TestCase):
    def test_other_machines_get_the_network_address(self):
        line = share_line(choose(), {"viewer": "ready"}, False, "192.168.1.174")
        self.assertEqual("Other machines: https://192.168.1.174:5173", line)

    def test_someone_elses_viewer_might_not_be_on_the_network(self):
        line = share_line(choose(), {"viewer": "already running"}, False, "10.0.0.5")
        self.assertIn("https://10.0.0.5:5173", line)
        self.assertIn("--host", line)

    def test_http_is_localhost_only(self):
        services = with_ports(choose(), http=True)
        self.assertIn("localhost only", share_line(services, {"viewer": "ready"}, True, "10.0.0.5"))

    def test_no_address(self):
        self.assertIn("can't reach", share_line(choose(), {"viewer": "ready"}, False, None))

    def test_nothing_to_say_without_a_viewer_up(self):
        self.assertIsNone(share_line(choose(skip=["viewer"]), {}, False, "10.0.0.5"))
        self.assertIsNone(share_line(choose(), {"viewer": "failed"}, False, "10.0.0.5"))
        self.assertIsNone(share_line(choose(), {}, False, "10.0.0.5"))

    def test_network_address_is_never_loopback(self):
        address = network_address()
        if address is not None:
            self.assertFalse(address.startswith("127."))
            self.assertEqual(4, len(address.split(".")))



class Printing(unittest.TestCase):
    def test_characters_the_console_cant_show_dont_stop_the_output(self):
        # Vite prints arrows, which cp1252 (a redirected stdout on Windows) has no code for.
        code = ("import sys; sys.path.insert(0, 'scripts'); import run_all; "
                "o = run_all.Output(False, 7); o.line('viewer', '\u279c  Local'); o.line('viewer', 'next')")
        result = subprocess.run([sys.executable, "-c", code], capture_output=True, check=False,
                                cwd=Path(__file__).resolve().parent.parent,
                                env={**os.environ, "PYTHONIOENCODING": "cp1252"})
        self.assertEqual(b"", result.stderr)
        self.assertEqual(["viewer  | ?  Local", "viewer  | next"], result.stdout.decode("cp1252").splitlines())


if __name__ == "__main__":
    unittest.main()
