"""Tests for time_slide_list.py's parts that don't need the tiler running.

    python -m unittest discover -s scripts
"""
import unittest

from time_slide_list import parse_args, report, tiler_env, verdict


class Verdict(unittest.TestCase):
    def test_a_quick_restart_passes_and_says_how_much_faster(self):
        passed, line = verdict(50.0, 0.1, 2.0)
        self.assertTrue(passed)
        self.assertIn("PASS", line)
        self.assertIn("500x faster", line)

    def test_a_slow_restart_fails(self):
        passed, line = verdict(50.0, 49.0, 2.0)
        self.assertFalse(passed)
        self.assertIn("FAIL", line)

    def test_restart_only_has_no_speedup(self):
        passed, line = verdict(None, 0.05, 2.0)
        self.assertTrue(passed)
        self.assertNotIn("faster", line)

    def test_no_timing_fails(self):
        self.assertFalse(verdict(1.0, None, 2.0)[0])


class Env(unittest.TestCase):
    def test_points_the_tiler_at_the_data_with_no_warm_up(self):
        env = tiler_env("F:/slides", base={"PATH": "x"})
        self.assertEqual("F:/slides", env["Slides__DataPath"])
        self.assertEqual("false", env["Slides__WarmOnStart"])
        self.assertEqual("x", env["PATH"])

    def test_production_so_user_secrets_dont_change_the_data_folder(self):
        self.assertEqual("Production", tiler_env("d", base={})["ASPNETCORE_ENVIRONMENT"])


class Report(unittest.TestCase):
    def test_one_row_a_start(self):
        lines = report([("first, nothing kept", 50.37, 202), ("restart", 0.09, 202)]).splitlines()
        self.assertEqual(3, len(lines))
        self.assertIn("50.37s", lines[1])
        self.assertIn("0.09s", lines[2])


class Args(unittest.TestCase):
    def test_data_is_required_and_the_threshold_defaults(self):
        args = parse_args(["--data", "d"])
        self.assertEqual(2.0, args.max_restart)
        self.assertFalse(args.keep)
        with self.assertRaises(SystemExit):
            parse_args([])


if __name__ == "__main__":
    unittest.main()
