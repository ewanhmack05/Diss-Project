"""Tests for time_api.py's parts that don't need anything running.

    python -m unittest discover -s scripts
"""
import unittest

from time_api import endpoints, parse_args, percentile, size_text, summary, table


class Percentile(unittest.TestCase):
    def test_nearest_rank(self):
        values = [5, 1, 3, 2, 4]
        self.assertEqual(3, percentile(values, 0.5))
        self.assertEqual(5, percentile(values, 0.95))
        self.assertEqual(1, percentile(values, 0.01))

    def test_one_value_is_every_percentile(self):
        self.assertEqual(7, percentile([7], 0.5))
        self.assertEqual(7, percentile([7], 0.95))

    def test_nothing_is_nothing(self):
        self.assertIsNone(percentile([], 0.5))


class Summary(unittest.TestCase):
    def test_median_p95_max_and_the_largest_answer(self):
        row = summary("x", [10, 20, 30, 40], [100, 300, 200, 100])
        self.assertEqual({"name": "x", "median": 20, "p95": 40, "max": 40, "bytes": 300, "runs": 4}, row)


class Table(unittest.TestCase):
    def test_slowest_first_with_sizes_readable(self):
        rows = [summary("fast", [1.0], [10]), summary("slow", [200.0], [9_800_000]), summary("middle", [20.0], [2048])]
        lines = table(rows).splitlines()
        self.assertTrue(lines[0].startswith("endpoint"))
        self.assertEqual(["slow", "middle", "fast"], [line.split()[0] for line in lines[1:]])
        self.assertIn("9.3 MB", lines[1])
        self.assertIn("2.0 KB", lines[2])

    def test_sizes(self):
        self.assertEqual("512 B", size_text(512))
        self.assertEqual("1.5 KB", size_text(1536))
        self.assertEqual("2.0 MB", size_text(2 * 1024 * 1024))


class Endpoints(unittest.TestCase):
    def test_covers_what_the_viewer_reads_for_both_collections(self):
        found = endpoints("003", "own-id", "session-id", "count-id", [{"id": "cs-1", "what": "delete group"}])
        names = [name for name, *_ in found]
        self.assertIn("collections/ensure", names)
        self.assertIn("own: annotations (all, the map)", names)
        self.assertIn("session: history facets", names)
        self.assertIn("biggest cell count (with dots)", names)
        self.assertIn("history changes: delete group #1", names)
        # Nothing but reads, and ensure, which the viewer calls on every load.
        self.assertEqual({"GET", "POST"}, {method for _, method, *_ in found})
        self.assertEqual(["collections/ensure"], [name for name, method, *_ in found if method == "POST"])

    def test_without_a_session_or_counts_it_times_only_whats_there(self):
        names = [name for name, *_ in endpoints("003", "own-id", None, None, [])]
        self.assertFalse(any(name.startswith("session:") for name in names))
        self.assertNotIn("biggest cell count (with dots)", names)

    def test_ids_go_in_the_path_escaped(self):
        found = {name: path for name, _, path, _ in endpoints("a b", "own id", None, None, [])}
        self.assertEqual("/collections?slideId=a%20b", found["collections list"])
        self.assertEqual("/annotations?collectionId=own%20id", found["own: annotations (all, the map)"])


class Args(unittest.TestCase):
    def test_defaults_to_the_store_itself(self):
        args = parse_args([])
        self.assertEqual("http://localhost:5252", args.store)
        self.assertIsNone(args.via)
        self.assertEqual((10, 2), (args.runs, args.warmup))


if __name__ == "__main__":
    unittest.main()
