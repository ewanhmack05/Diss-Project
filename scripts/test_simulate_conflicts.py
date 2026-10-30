"""Tests for simulate_conflicts.py's parts that don't need anything running.

    python -m unittest discover -s scripts
"""
import random
import unittest

from simulate_annotations import COLOURS
from simulate_conflicts import Board, Tally, pick_colour


class Copies(unittest.TestCase):
    def setUp(self):
        self.board = Board(notice=2)
        self.board.add("a", "#red", at=0)

    def test_someone_elses_save_reaches_your_copy_only_once_its_old_enough(self):
        self.board.saved("a", "#blue", at=10)
        self.assertEqual(self.board.copy("me", "a", now=11), "#red")
        self.assertEqual(self.board.copy("me", "a", now=12), "#blue")

    def test_what_you_heard_for_yourself_beats_what_you_havent_noticed_yet(self):
        self.board.saved("a", "#blue", at=10)
        self.board.heard("me", "a", "#blue", at=10.5)
        self.assertEqual(self.board.copy("me", "a", now=10.6), "#blue")
        # Not someone else's.
        self.assertEqual(self.board.copy("you", "a", now=10.6), "#red")

    def test_a_later_save_you_have_noticed_beats_an_older_one_you_heard(self):
        self.board.heard("me", "a", "#blue", at=5)
        self.board.saved("a", "#green", at=6)
        self.assertEqual(self.board.copy("me", "a", now=7), "#blue")
        self.assertEqual(self.board.copy("me", "a", now=8), "#green")

    def test_with_no_delay_everyone_sees_every_save_at_once(self):
        board = Board(notice=0)
        board.add("a", "#red", at=0)
        board.saved("a", "#blue", at=3)
        self.assertEqual(board.copy("anyone", "a", now=3), "#blue")

    def test_the_first_colour_is_everyones_copy_before_anything_else(self):
        self.assertEqual(self.board.copy("me", "a", now=0), "#red")


class PickColour(unittest.TestCase):
    def test_never_the_colour_they_think_it_already_is(self):
        rng = random.Random(1)
        for copy in COLOURS:
            for _ in range(50):
                picked = pick_colour(rng, copy)
                self.assertNotEqual(picked, copy)
                self.assertIn(picked, COLOURS)


class Summary(unittest.TestCase):
    def test_first_change_wins_says_what_happened_to_the_ones_turned_down(self):
        tally = Tally()
        tally.add(saves=20, collided=4, refused=4, used_mine=3, kept_theirs=1)
        for ms in [10, 20, 30, 40]:
            tally.add(ms=ms)
        text = tally.summary("firstComeWins")
        self.assertIn("Saves sent: 20", text)
        self.assertIn("Collided with someone else's change: 4 (20.0%)", text)
        self.assertIn("turned down: 4", text)
        self.assertIn("then used mine: 3", text)
        self.assertIn("then kept theirs: 1", text)
        self.assertIn("median 25 ms", text)
        self.assertNotIn("overwrote", text)

    def test_last_change_wins_says_how_many_changes_were_lost(self):
        tally = Tally()
        tally.add(saves=10, collided=2, overwrote=2)
        text = tally.summary("lastWriteWins")
        self.assertIn("overwrote it without anyone knowing: 2", text)
        self.assertNotIn("turned down", text)

    def test_nothing_sent_doesnt_divide_by_zero(self):
        self.assertIn("Saves sent: 0", Tally().summary("lastWriteWins"))


if __name__ == "__main__":
    unittest.main()
