"""Tests for seed_stress.py's checks that run before anything is sent.

    python -m unittest discover -s scripts
"""
import json
import random
import unittest

import seed_stress
from seed_stress import MAX_DOTS, STORE_LIMIT_BYTES, dots_problem


class DotsProblem(unittest.TestCase):
    def test_counts_within_the_limit_are_fine(self):
        self.assertIsNone(dots_problem([1_000, 10_000, MAX_DOTS]))
        self.assertIsNone(dots_problem([]))

    def test_a_count_over_the_limit_is_refused_with_the_reason(self):
        problem = dots_problem([1_000, MAX_DOTS + 1])
        self.assertIn(f"{MAX_DOTS + 1:,}", problem)
        self.assertIn("80 MiB", problem)

    def test_the_largest_allowed_count_fits_in_annotation_stores_limit(self):
        # Builds real request bodies at two sizes and scales up from the cost
        # of a dot, so the limit stays honest if the dot format changes -
        # without building a 60 MB body in a gate test.
        def body_bytes(dots):
            sent = {}
            original = seed_stress.post
            seed_stress.post = lambda store, token, path, body: sent.setdefault("bytes", len(json.dumps(body).encode()))
            try:
                random.seed(42)
                seed_stress.add_cell_count(None, None, "collection", (7_000, 63_000, -140_000, -10_000), dots, True)
            finally:
                seed_stress.post = original
            return sent["bytes"]

        small, large = body_bytes(1_000), body_bytes(21_000)
        per_dot = (large - small) / 20_000
        estimate = small + per_dot * (MAX_DOTS - 1_000)
        # 10% spare for longer coordinates on a bigger slide.
        self.assertLess(estimate * 1.1, STORE_LIMIT_BYTES)

if __name__ == "__main__":
    unittest.main()
