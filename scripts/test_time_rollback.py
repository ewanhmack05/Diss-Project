"""Tests for time_rollback.py's parts that don't need anything running.

    python -m unittest discover -s scripts
"""
import json
import unittest

from time_rollback import (
    batches,
    compare,
    parse_args,
    recolour_body,
    report,
    rollback_rows,
    shape,
    unique_colour,
)


class Shape(unittest.TestCase):
    def test_is_a_real_sized_freehand_line(self):
        feature = json.loads(shape(3))
        self.assertEqual("LineString", feature["geometry"]["type"])
        self.assertEqual(120, len(feature["geometry"]["coordinates"]))

    def test_differs_by_row(self):
        self.assertNotEqual(shape(1), shape(2))


class Batches(unittest.TestCase):
    def test_keeps_to_the_stores_limit(self):
        self.assertEqual([[1, 2], [3, 4], [5]], batches([1, 2, 3, 4, 5], 2))
        self.assertEqual([20_000, 1], [len(b) for b in batches(list(range(20_001)))])

    def test_nothing_is_nothing(self):
        self.assertEqual([], batches([]))


class Bodies(unittest.TestCase):
    def test_recolour_says_which_rows_and_what_colour(self):
        self.assertEqual({"collectionId": "c", "ids": ["a"], "colour": "#000000"}, recolour_body("c", ["a"], "#000000"))


class UniqueColour(unittest.TestCase):
    def test_never_repeats_and_is_a_real_colour(self):
        colours = [unique_colour(step) for step in range(50)]
        self.assertEqual(50, len(set(colours)))
        self.assertRegex(colours[49], "^#[0-9A-F]{6}$")


class Compare(unittest.TestCase):
    def test_takes_the_median_each_way(self):
        result = compare({"entries": 30_000, "ms": [100, 300, 200]}, {"entries": 5000, "ms": [50, 10, 40]})
        self.assertEqual((200, 40), (result["from_now_ms"], result["from_snapshot_ms"]))
        self.assertEqual((30_000, 5000), (result["from_now_entries"], result["from_snapshot_entries"]))
        self.assertEqual(5, result["times_faster"])

    def test_a_snapshot_time_of_nothing_doesnt_divide_by_it(self):
        self.assertIsNone(compare({"entries": 1, "ms": [5]}, {"entries": 0, "ms": [0]})["times_faster"])


class RollbackRows(unittest.TestCase):
    def test_median_and_range_for_each_size_and_kind(self):
        rows = rollback_rows({(1000, "delete"): [30, 10, 20], (1, "recolour"): [5]})
        self.assertEqual({"rows": 1000, "what": "delete", "ms": 20, "fastest": 10, "slowest": 30, "runs": 3}, rows[0])
        self.assertEqual((5, 5, 5, 1), (rows[1]["ms"], rows[1]["fastest"], rows[1]["slowest"], rows[1]["runs"]))


class Report(unittest.TestCase):
    def test_reads_both_ways_and_each_rollback(self):
        text = report({"from_now_ms": 812.4, "from_now_entries": 30_000, "from_snapshot_ms": 95.1, "from_snapshot_entries": 5000},
                      [{"rows": 1000, "what": "delete", "ms": 420.0, "fastest": 400.0, "slowest": 500.0, "runs": 3}])
        self.assertIn("812 ms, undoing 30,000 entries", text)
        self.assertIn("95 ms, undoing 5,000 entries", text)
        self.assertIn("1,000  delete", text)
        self.assertIn("420 ms", text)


class Args(unittest.TestCase):
    def test_defaults_to_a_small_run_on_the_store(self):
        args = parse_args([])
        self.assertEqual(("http://localhost:5252", 5000, [1, 1000, 5000]), (args.store, args.rows, args.sizes))


if __name__ == "__main__":
    unittest.main()
