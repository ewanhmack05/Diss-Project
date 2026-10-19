"""Tests for simulate_session.py's parts that don't need anything running.

    python -m unittest discover -s scripts
"""
import base64
import json
import random
import unittest

from simulate_session import (
    MAX_PEOPLE,
    NAMES,
    RECORD_SEPARATOR,
    RESOLUTIONS,
    SCREEN,
    hub_message,
    hub_records,
    invite_code,
    keycloak_user,
    role_summary,
    sim_people,
    token_subject,
    viewport,
    wander,
)


class SimPeople(unittest.TestCase):
    def test_numbered_usernames_with_a_name_each(self):
        people = sim_people(3)
        self.assertEqual([p["username"] for p in people], ["sim1", "sim2", "sim3"])
        self.assertEqual((people[0]["firstName"], people[0]["lastName"]), NAMES[0])

    def test_names_stay_different_past_the_list(self):
        people = sim_people(MAX_PEOPLE)
        names = {(p["firstName"], p["lastName"]) for p in people}
        self.assertEqual(len(names), MAX_PEOPLE)
        self.assertEqual(len({p["username"] for p in people}), MAX_PEOPLE)

    def test_keycloak_gets_everything_it_needs_to_let_them_sign_in(self):
        # Missing email or names and Keycloak asks them to finish their
        # profile, which a script can't click through.
        user = keycloak_user(sim_people(1)[0])
        for field in ("username", "email", "firstName", "lastName"):
            self.assertTrue(user[field])
        self.assertTrue(user["enabled"] and user["emailVerified"])
        self.assertEqual(user["credentials"], [{"type": "password", "value": "password", "temporary": False}])
        self.assertTrue(user["email"].endswith(".test"))


class InviteCode(unittest.TestCase):
    def test_takes_the_code_out_of_a_link(self):
        self.assertEqual(invite_code("https://localhost:5173/?invite=juyhsUFHC4gB"), "juyhsUFHC4gB")
        self.assertEqual(invite_code("http://192.168.1.5:5173/?foo=1&invite=abc-_123"), "abc-_123")

    def test_takes_a_bare_code_as_it_is(self):
        self.assertEqual(invite_code("  juyhsUFHC4gB \n"), "juyhsUFHC4gB")

    def test_turns_down_a_link_with_no_invite_in_it(self):
        with self.assertRaises(ValueError):
            invite_code("https://localhost:5173/?slide=003")
        with self.assertRaises(ValueError):
            invite_code("")


class TokenSubject(unittest.TestCase):
    def test_reads_the_user_id_out_of_a_token(self):
        def part(data):
            return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()
        # Padding stripped, as in a real JWT, at a length that needs it put back.
        token = ".".join([part({"alg": "RS256"}), part({"sub": "d459b3ad-1", "x": "y"}), "sig"])
        self.assertEqual(token_subject(token), "d459b3ad-1")


class Viewport(unittest.TestCase):
    def test_the_box_is_the_screen_at_that_resolution_round_the_centre(self):
        view = viewport((1000, -2000), 4, screen=(100, 50))
        self.assertEqual(view["extent"], [800, -2100, 1200, -1900])
        self.assertEqual(view["center"], [1000, -2000])
        self.assertEqual(view["rotation"], 0)

    def test_wandering_stays_on_the_slide_and_within_the_zoom_range(self):
        bounds = (0.0, 10_000.0, -10_000.0, 0.0)
        rng = random.Random(1)
        center, resolution = (0.0, 0.0), RESOLUTIONS[1]
        for _ in range(2000):
            center, resolution = wander(center, resolution, bounds, rng)
            self.assertTrue(bounds[0] <= center[0] <= bounds[1])
            self.assertTrue(bounds[2] <= center[1] <= bounds[3])
            self.assertTrue(RESOLUTIONS[0] <= resolution <= RESOLUTIONS[1])

    def test_wandering_actually_moves(self):
        rng = random.Random(2)
        start = (5000.0, -5000.0)
        center, _ = wander(start, 4.0, (0.0, 10_000.0, -10_000.0, 0.0), rng)
        self.assertNotEqual(center, start)

    def test_default_screen_is_a_desktop_one(self):
        self.assertEqual(SCREEN, (1600, 900))


class HubFraming(unittest.TestCase):
    def test_each_message_ends_in_the_record_separator(self):
        framed = hub_message({"protocol": "json", "version": 1})
        self.assertTrue(framed.endswith(RECORD_SEPARATOR))
        self.assertEqual(json.loads(framed[:-1]), {"protocol": "json", "version": 1})

    def test_a_poll_with_several_messages_splits_into_each(self):
        text = "{}" + RECORD_SEPARATOR + '{"type":6}' + RECORD_SEPARATOR + '{"type":3,"invocationId":"1"}' + RECORD_SEPARATOR
        self.assertEqual(hub_records(text), [{}, {"type": 6}, {"type": 3, "invocationId": "1"}])

    def test_an_empty_poll_is_no_messages(self):
        self.assertEqual(hub_records(""), [])


class RoleSummary(unittest.TestCase):
    def test_says_how_the_cap_played_out(self):
        joined = [("Alice", "owner")] + [(f"E{i}", "editor") for i in range(5)] + [("V1", "viewer"), ("V2", "viewer")]
        self.assertEqual(role_summary(joined, 6), "8 people in it, 6 of 6 editing, 2 view only - a large session")

    def test_small_while_everyone_could_edit(self):
        self.assertIn("a small session", role_summary([("Alice", "owner"), ("Bob", "editor")], 6))


if __name__ == "__main__":
    unittest.main()
