"""Tests for eval_conflicts.py's parts that don't need anything running.

    python -m unittest discover -s scripts
"""
import unittest

from eval_conflicts import (
    POLICIES,
    conflict_command,
    grid,
    parse_args,
    per_minute,
    percent,
    spread,
    summarise,
    table,
)


def run(policy="lastWriteWins", people=2, notice=2, seed=0, saves=10, collided=2, overwrote=2, refused=0, used_mine=0, kept_theirs=0, ms=(10, 30)):
    return {"policy": policy, "people": people, "notice": notice, "seed": seed, "saves": saves, "collided": collided,
            "overwrote": overwrote, "refused": refused, "used_mine": used_mine, "kept_theirs": kept_theirs, "ms": list(ms)}


class Grid(unittest.TestCase):
    def test_every_combination_with_a_seed_for_each_repeat(self):
        runs = grid(POLICIES, [2, 6], [1], 3)
        self.assertEqual(2 * 2 * 1 * 3, len(runs))
        self.assertEqual({0, 1, 2}, {r["seed"] for r in runs})
        self.assertEqual(len(runs), len({tuple(sorted(r.items())) for r in runs}))


class Sums(unittest.TestCase):
    def test_spread_of_one_run_is_nothing(self):
        self.assertEqual((5.0, 0.0), spread([5]))

    def test_spread_of_several(self):
        mean, sd = spread([2, 4])
        self.assertEqual(3.0, mean)
        self.assertAlmostEqual(1.4142, sd, 3)

    def test_percent_of_nothing_is_nothing(self):
        self.assertEqual(0.0, percent(1, 0))
        self.assertEqual(25.0, percent(1, 4))

    def test_per_minute_is_per_person(self):
        self.assertEqual(3.0, per_minute(6, 60, 2))
        self.assertEqual(6.0, per_minute(6, 30, 2))


class Summarise(unittest.TestCase):
    def test_keeps_policies_and_settings_apart_and_adds_up_repeats(self):
        rows = summarise([run(seed=0), run(seed=1, saves=20, collided=10, overwrote=10), run(policy="firstComeWins", overwrote=0, refused=4)], 60)
        self.assertEqual(2, len(rows))
        last = next(r for r in rows if r["policy"] == "lastWriteWins")
        self.assertEqual((2, 30, 12, 12), (last["runs"], last["saves"], last["collided"], last["silently_lost"]))
        self.assertEqual(35.0, last["collision_percent"])

    def test_silently_lost_and_asked_belong_to_their_own_policy(self):
        rows = {r["policy"]: r for r in summarise([run(), run(policy="firstComeWins", overwrote=0, refused=6)], 60)}
        self.assertEqual(0, rows["firstComeWins"]["silently_lost"])
        self.assertEqual(3.0, rows["firstComeWins"]["asked_per_person_minute"])
        self.assertEqual(0.0, rows["lastWriteWins"]["asked_per_person_minute"])

    def test_median_save_is_over_every_save_not_a_median_of_medians(self):
        rows = summarise([run(ms=(1, 2, 3)), run(seed=1, ms=(100,))], 60)
        self.assertEqual(2.5, rows[0]["save_ms_median"])

    def test_no_saves_has_no_median(self):
        rows = summarise([run(saves=0, collided=0, overwrote=0, ms=())], 60)
        self.assertIsNone(rows[0]["save_ms_median"])
        self.assertEqual(0.0, rows[0]["collision_percent"])


class Table(unittest.TestCase):
    def test_reads_as_a_markdown_table(self):
        text = table(summarise([run(), run(policy="firstComeWins", overwrote=0, refused=6)], 60))
        self.assertIn("| First change wins | 2 | 2s | 10 | 2 (20.0% ± 0.0) | 0 | 6 | 3.00 | 20ms |", text)
        self.assertIn("| Last change wins | 2 | 2s | 10 | 2 (20.0% ± 0.0) | 2 | 0 | 0.00 | 20ms |", text)
        self.assertEqual({10}, {line.count("|") for line in text.splitlines()})


class Command(unittest.TestCase):
    def test_passes_the_settings_on(self):
        args = parse_args(["--store", "http://s", "--hub", "http://h", "--seconds", "5"])
        command = conflict_command(args, "CODE", {"people": 6, "notice": 0.5, "seed": 2}, "out.json")
        self.assertEqual("CODE", command[2])
        for flag, value in (("--people", "6"), ("--notice", "0.5"), ("--seed", "2"), ("--store", "http://s"), ("--hub", "http://h"), ("--seconds", "5.0"), ("--json", "out.json")):
            self.assertEqual(value, command[command.index(flag) + 1])


if __name__ == "__main__":
    unittest.main()
