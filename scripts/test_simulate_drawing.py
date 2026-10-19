"""Tests for simulate_annotations.py and simulate_cell_counts.py - the
shapes and dots they make, without anything running.

    python -m unittest discover -s scripts
"""
import json
import random
import unittest

from simulate_annotations import SHAPES, drawing_frames, feature, geometry, inner, shape_in_view
from simulate_cell_counts import box_geojson, cell_dots, roi_box

# A view in map units - slide pixels, y going down from 0.
VIEW = (40_000.0, -60_000.0, 52_000.0, -53_000.0)


def inside(point, box):
    x0, y0, x1, y1 = box
    return x0 <= point[0] <= x1 and y0 <= point[1] <= y1


def points_of(geom):
    return geom["coordinates"][0] if geom["type"] == "Polygon" else geom["coordinates"]


class Shapes(unittest.TestCase):
    def test_every_kind_lands_inside_what_they_can_see(self):
        rng = random.Random(1)
        for kind in SHAPES:
            for _ in range(200):
                coords = shape_in_view(kind, VIEW, rng)
                self.assertTrue(all(inside(p, VIEW) for p in coords), f"{kind} went outside the view")

    def test_closed_shapes_are_closed_rings_and_lines_are_not(self):
        rng = random.Random(2)
        for kind in SHAPES:
            coords = shape_in_view(kind, VIEW, rng)
            geom = geometry(kind, coords)
            if kind in ("polygon", "rectangle", "circle"):
                self.assertEqual(geom["type"], "Polygon")
                self.assertEqual(coords[0], coords[-1])
            else:
                self.assertEqual(geom["type"], "LineString")
        self.assertEqual(len(shape_in_view("circle", VIEW, rng)), 51)
        self.assertEqual(len(shape_in_view("line", VIEW, rng)), 2)

    def test_margin_keeps_them_off_the_edge(self):
        x0, y0, x1, y1 = inner(VIEW)
        self.assertAlmostEqual(x0 - VIEW[0], 0.15 * (VIEW[2] - VIEW[0]))
        self.assertAlmostEqual(VIEW[3] - y1, 0.15 * (VIEW[3] - VIEW[1]))


class Drawing(unittest.TestCase):
    def test_the_last_frame_is_the_finished_shape(self):
        rng = random.Random(3)
        for kind in SHAPES:
            coords = shape_in_view(kind, VIEW, rng)
            frames = drawing_frames(kind, coords, 12)
            self.assertEqual(len(frames), 12)
            self.assertEqual(points_of(frames[-1]), coords)

    def test_lines_and_traces_grow_point_by_point(self):
        rng = random.Random(4)
        coords = shape_in_view("freehand", VIEW, rng)
        lengths = [len(points_of(f)) for f in drawing_frames("freehand", coords, 10)]
        self.assertEqual(lengths, sorted(lengths))
        self.assertGreaterEqual(lengths[0], 2)

    def test_rectangles_grow_from_where_they_were_started(self):
        coords = [[0, 0], [10, 0], [10, -6], [0, -6], [0, 0]]
        first = points_of(drawing_frames("rectangle", coords, 2)[0])
        self.assertEqual(first, [[0, 0], [5, 0], [5, -3], [0, -3], [0, 0]])

    def test_a_polygon_part_drawn_is_still_valid_to_draw(self):
        # Two points can't make a polygon - the viewer would choke on it.
        coords = shape_in_view("polygon", VIEW, random.Random(5))
        for frame in drawing_frames("polygon", coords, 12):
            if frame["type"] == "Polygon":
                ring = frame["coordinates"][0]
                self.assertGreaterEqual(len(ring), 4)
                self.assertEqual(ring[0], ring[-1])

    def test_sent_as_a_geojson_feature_like_the_viewer(self):
        parsed = json.loads(feature({"type": "LineString", "coordinates": [[0, 0], [1, 1]]}))
        self.assertEqual(parsed["type"], "Feature")
        self.assertIsNone(parsed["properties"])


class Counting(unittest.TestCase):
    def test_dots_stay_inside_the_area(self):
        rng = random.Random(6)
        area = roi_box(VIEW, rng)
        self.assertTrue(inside(area[:2], VIEW) and inside(area[2:], VIEW))
        dots = cell_dots(area, 500, ["#FB0909"], rng)
        self.assertEqual(len(dots), 500)
        self.assertTrue(all(inside((d["x"], d["y"]), area) for d in dots))

    def test_colours_are_used_in_turn_like_switching_part_way(self):
        dots = cell_dots(VIEW, 10, ["#FB0909", "#0913FB"], random.Random(7))
        self.assertEqual([d["colour"] for d in dots], ["#FB0909"] * 5 + ["#0913FB"] * 5)

    def test_the_roi_is_a_closed_box_feature(self):
        geom = json.loads(box_geojson((0, -10, 20, 0)))["geometry"]
        ring = geom["coordinates"][0]
        self.assertEqual(geom["type"], "Polygon")
        self.assertEqual(ring[0], ring[-1])
        self.assertEqual(len(ring), 5)


if __name__ == "__main__":
    unittest.main()
