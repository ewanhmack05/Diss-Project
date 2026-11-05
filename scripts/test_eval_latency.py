"""Tests for eval_latency.py, and runs the Node evaluation scripts' tests when
image-viewer's node_modules is there.

    python -m unittest discover -s scripts
"""
import shutil
import subprocess
import unittest
from pathlib import Path

from eval_latency import config_for, parse_args, table

HERE = Path(__file__).resolve().parent
NODE_READY = shutil.which("node") and (HERE.parent / "image-viewer" / "node_modules" / "yjs").exists()


def result(people=6, viewports=0, median=1.5, missing=0):
    stats = {"median": median, "p95": 3.25, "p99": 4.0}
    return {"people": people, "viewportsPerSecond": viewports, "toEveryone": stats, "wholeRoom": {"median": 2.0, "p95": 5.0}, "opsNotReachingEveryone": missing}


class Table(unittest.TestCase):
    def test_a_row_for_each_run_quiet_or_moving(self):
        text = table([result(), result(people=50, viewports=2, median=12.25, missing=1)])
        self.assertIn("| 6 | None | 1.5ms | 3.2ms | 4.0ms | 2.0ms | 5.0ms | 0 |", text)
        self.assertIn("| 50 | 2/s each | 12.2ms |", text)
        self.assertEqual({9}, {line.count("|") for line in text.splitlines()})


class Config(unittest.TestCase):
    def test_passes_the_settings_on(self):
        args = parse_args(["--hub", "http://h", "--ops", "10", "--ops-per-second", "2"])
        config = config_for(args, "s1", ["t1", "t2"], 2, "out.json")
        self.assertEqual({"hub": "http://h", "sessionId": "s1", "tokens": ["t1", "t2"], "ops": 10, "opsPerSecond": 2.0, "viewportsPerSecond": 2, "out": "out.json"}, config)


@unittest.skipUnless(NODE_READY, "needs node and image-viewer's node_modules")
class NodeScripts(unittest.TestCase):
    def test_their_own_tests_pass(self):
        files = sorted(str(path) for path in HERE.glob("eval_*.test.mjs"))
        self.assertTrue(files)
        finished = subprocess.run(["node", "--test", *files], capture_output=True, text=True, timeout=300, check=False)
        self.assertEqual(0, finished.returncode, finished.stdout[-2000:])


if __name__ == "__main__":
    unittest.main()
