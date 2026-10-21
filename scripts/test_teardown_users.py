"""Tests for teardown_users.py's choices - who's removed, who never is, and
which sessions they're taken out of.

    python -m unittest discover -s scripts
"""
import unittest

from teardown_users import PROTECTED, is_protected, their_collections, to_remove


def user(username, **extra):
    return {"id": f"id-{username}", "username": username, **extra}


REALM = [
    user("alice"), user("bob"), user("carol"),
    user("service-account-realtime-hub", serviceAccountClientId="realtime-hub"),
    user("sim10"), user("sim2"), user("sim1"), user("dave"),
]


class Protected(unittest.TestCase):
    def test_the_three_test_accounts_are_never_removed(self):
        self.assertEqual(PROTECTED, ("alice", "bob", "carol"))
        removed = {u["username"] for u in to_remove(REALM)}
        self.assertFalse(removed & set(PROTECTED))

    def test_whatever_the_case_of_the_username(self):
        self.assertTrue(is_protected(user("Alice")))
        self.assertTrue(is_protected(user("BOB")))

    def test_service_accounts_are_never_removed(self):
        # realtime-hub signs in with one - removing it breaks the Users tab.
        self.assertTrue(is_protected(user("service-account-realtime-hub")))
        self.assertTrue(is_protected(user("anything", serviceAccountClientId="some-client")))

    def test_keep_protects_more_on_top(self):
        self.assertTrue(is_protected(user("dave"), keep=["Dave"]))
        self.assertNotIn("dave", [u["username"] for u in to_remove(REALM, keep=["dave"])])

    def test_keep_cant_unprotect_the_three(self):
        self.assertTrue(is_protected(user("alice"), keep=[]))


class ToRemove(unittest.TestCase):
    def test_everyone_else_goes_sim_users_first_in_number_order(self):
        self.assertEqual([u["username"] for u in to_remove(REALM)], ["sim1", "sim2", "sim10", "dave"])

    def test_sim_only_leaves_other_users_alone(self):
        self.assertEqual([u["username"] for u in to_remove(REALM, sim_only=True)], ["sim1", "sim2", "sim10"])

    def test_sim_only_means_exactly_sim_and_a_number(self):
        names = [u["username"] for u in to_remove([user("simon"), user("sim"), user("sim3x"), user("sim4")], sim_only=True)]
        self.assertEqual(names, ["sim4"])

    def test_nothing_to_remove_from_just_the_protected_ones(self):
        self.assertEqual(to_remove(REALM[:4]), [])


class TheirCollections(unittest.TestCase):
    def test_splits_sessions_they_joined_from_ones_they_own(self):
        me = "u-sim1"
        collections = [
            {"collectionId": "own", "members": [{"userId": me, "role": "owner"}]},
            {"collectionId": "joined", "members": [{"userId": "u-alice", "role": "owner"}, {"userId": me, "role": "viewer"}]},
            {"collectionId": "editing", "members": [{"userId": "u-bob", "role": "owner"}, {"userId": me, "role": "editor"}]},
            # Someone else's shared collection - listed, but they aren't in it.
            {"collectionId": "shared", "members": [{"userId": "u-carol", "role": "owner"}]},
        ]
        joined, owned = their_collections(collections, me)
        self.assertEqual([c["collectionId"] for c in joined], ["joined", "editing"])
        self.assertEqual([c["collectionId"] for c in owned], ["own"])


if __name__ == "__main__":
    unittest.main()
