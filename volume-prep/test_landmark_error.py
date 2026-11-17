"""Tests for landmark_error.py - made-up landmarks and transforms, so nothing's needed but Python.

    python -m unittest discover -s volume-prep
"""
import unittest

from landmark_error import (
    IDENTITY,
    apply,
    describe,
    evaluate,
    observer_gap,
    pair_errors,
    parse_landmarks,
    through_errors,
)

# Cut down from the liver's real file: header, then Y X pairs per section.
THROUGH = (
    "Filename\tFiducial1 Y\tFiducial1 X\tFiducial2 Y\tFiducial2 X\t\n"
    "001.tif\t100.0\t200.0\t300.0\t400.0\n"
    "002.tif\t110.0\t205.0\t310.0\t405.0\n"
)


def shift(dx, dy):
    return [[1.0, 0.0, dx], [0.0, 1.0, dy]]


class Parse(unittest.TestCase):
    def test_reads_y_then_x_as_points(self):
        rows = parse_landmarks(THROUGH)
        self.assertEqual([(200.0, 100.0), (400.0, 300.0)], rows["001.tif"])
        self.assertEqual(2, len(rows))

    def test_odd_numbers_are_refused(self):
        with self.assertRaises(ValueError):
            parse_landmarks("Filename\ta\n001.tif\t1\t2\t3\n")


class Geometry(unittest.TestCase):
    def test_apply(self):
        self.assertEqual((13.0, 17.0), apply(shift(3, 7), (10, 10)))
        self.assertEqual((10.0, 10.0), apply(IDENTITY, (10, 10)))


class Through(unittest.TestCase):
    def setUp(self):
        self.rows = parse_landmarks(THROUGH)
        self.files = ["001.tif", "002.tif"]

    def test_before_is_how_far_the_holes_moved(self):
        # Each point moved (5, 10) between the sections: 11.18 px.
        errors = through_errors(self.rows, self.files, [IDENTITY, IDENTITY])
        for e in errors:
            self.assertAlmostEqual(125 ** 0.5, e)

    def test_a_transform_that_undoes_the_move_leaves_nothing(self):
        errors = through_errors(self.rows, self.files, [IDENTITY, shift(-5, -10)])
        self.assertEqual([0.0, 0.0], errors)

    def test_sections_without_landmarks_are_skipped(self):
        self.assertEqual([], through_errors(self.rows, ["001.tif", "009.tif"], [IDENTITY, IDENTITY]))


class Pairs(unittest.TestCase):
    def setUp(self):
        # One section: a point at (10, 20) on it, the same point at (13, 24) on the next.
        self.rows = {"001.tif": [(10.0, 20.0), (13.0, 24.0)]}
        self.files = ["001.tif", "002.tif"]

    def test_compares_each_point_with_its_copy_on_the_next_section(self):
        self.assertEqual([5.0], pair_errors(self.rows, self.files, [IDENTITY, IDENTITY]))
        self.assertEqual([0.0], pair_errors(self.rows, self.files, [IDENTITY, shift(-3, -4)]))

    def test_the_last_section_has_no_next(self):
        self.assertEqual([], pair_errors({"002.tif": [(1.0, 1.0), (2.0, 2.0)]}, self.files, [IDENTITY, IDENTITY]))


class Observers(unittest.TestCase):
    def test_gap_is_how_far_apart_they_put_the_same_point(self):
        first = {"001.tif": [(0.0, 0.0)]}
        second = {"001.tif": [(3.0, 4.0)], "002.tif": [(9.0, 9.0)]}
        self.assertEqual([5.0], observer_gap(first, second))


class Report(unittest.TestCase):
    def test_in_microns(self):
        # 5, 10 and 15 um; the 90th percentile of three is the middle one.
        summary = describe([10.0, 20.0, 30.0], 0.5)
        self.assertEqual({"points": 3, "mean_um": 10.0, "median_um": 10.0, "p90_um": 10.0}, summary)
        self.assertIsNone(describe([], 0.5))

    def test_evaluate_gives_before_after_and_observers(self):
        registration = {
            "canvas": {"mpp": 0.46},
            "sections": [{"order": 2, "file": "002.tif", "transform": shift(-5, -10)},
                         {"order": 1, "file": "001.tif", "transform": IDENTITY}],
        }
        result = evaluate(registration, "through", [parse_landmarks(THROUGH), parse_landmarks(THROUGH)])
        observer = result["observers"][0]
        self.assertAlmostEqual(round(125 ** 0.5 * 0.46, 1), observer["before"]["median_um"])
        self.assertEqual(0.0, observer["after"]["median_um"])
        self.assertEqual(0.0, result["between_observers"]["median_um"])

    def test_pairs_give_no_observer_gap(self):
        # Each observer marks their own nuclei on a pair, so there's nothing to line up.
        registration = {"canvas": {"mpp": 0.5},
                        "sections": [{"order": 1, "file": "001.tif", "transform": IDENTITY},
                                     {"order": 2, "file": "002.tif", "transform": IDENTITY}]}
        rows = {"001.tif": [(10.0, 20.0), (13.0, 24.0)]}
        result = evaluate(registration, "pairs", [rows, {"001.tif": [(500.0, 500.0), (503.0, 504.0)]}])
        self.assertNotIn("between_observers", result)
        self.assertEqual([2.5, 2.5], [o["before"]["median_um"] for o in result["observers"]])


if __name__ == "__main__":
    unittest.main()
