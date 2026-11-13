"""Tests for register_sections.py. Needs requirements.txt installed, nothing else -
the images are made up here, with transforms we know, so we can check they come back.

    python -m unittest discover -s volume-prep
"""
import contextlib
import io
import unittest
from pathlib import Path

import cv2
import numpy as np
from register_sections import (
    Link,
    as_3x3,
    canvas_for,
    chain_to_reference,
    dice,
    feature_transform,
    mean_displacement,
    outline_transform,
    parse_args,
    pyramid_target,
    rigid_fit,
    rootsift,
    rotation_and_scale,
    summary,
    tissue_mask,
    to_full_res,
    vips_affine_args,
)

GLASS = (238, 238, 238)


def rigid(degrees, tx, ty, centre=(0.0, 0.0)):
    """Turn by degrees about centre, then shift."""
    m = cv2.getRotationMatrix2D(centre, -degrees, 1.0)  # OpenCV counts angles the other way
    m[:, 2] += (tx, ty)
    return m


def fake_section(seed=1, size=(600, 500)):
    """A pink blob with purple speckles on grey glass - enough texture for SIFT, a clear outline."""
    rng = np.random.default_rng(seed)
    w, h = size
    img = np.full((h, w, 3), GLASS, np.uint8)
    cv2.ellipse(img, (w // 2, h // 2), (w // 3, h // 4), 20, 0, 360, (225, 150, 222), -1)
    inside = tissue_mask(img).astype(bool)
    for _ in range(900):
        x, y = rng.integers(0, w), rng.integers(0, h)
        if inside[y, x]:
            cv2.circle(img, (int(x), int(y)), int(rng.integers(2, 6)), tuple(int(c) for c in rng.integers(60, 200, 3)), -1)
    return img


def warp(img, m):
    return cv2.warpAffine(img, m, (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR, borderValue=GLASS)


class Geometry(unittest.TestCase):
    def test_full_res_scales_only_the_shift(self):
        full = to_full_res(rigid(10, 3, -2), 16)
        np.testing.assert_allclose(rigid(10, 0, 0)[:, :2], full[:2, :2])
        np.testing.assert_allclose([48, -32], full[:2, 2])

    def test_full_res_agrees_with_scaling_the_points(self):
        m, d = rigid(7, 5, 9), 16
        point_full = np.array([1600.0, 3200.0])
        small_then_up = (m[:, :2] @ (point_full / d) + m[:, 2]) * d
        np.testing.assert_allclose(small_then_up, to_full_res(m, d)[:2, :2] @ point_full + to_full_res(m, d)[:2, 2])

    def test_chain_reaches_the_reference_both_ways(self):
        pairs = [rigid(5, 10, 0), rigid(-3, 0, 4), rigid(2, -6, 1)]
        to_ref = chain_to_reference(pairs, reference=2)
        np.testing.assert_allclose(np.eye(3), to_ref[2])
        np.testing.assert_allclose(as_3x3(pairs[1]) @ as_3x3(pairs[0]), to_ref[0])
        np.testing.assert_allclose(np.linalg.inv(as_3x3(pairs[2])), to_ref[3])

    def test_canvas_holds_every_section_from_zero(self):
        sizes = [(100, 50), (100, 50)]
        width, height, placed = canvas_for(sizes, [np.eye(3), as_3x3(rigid(0, -30, 20))])
        self.assertEqual((130, 70), (width, height))
        corners = np.array([[0, 0, 1], [100, 50, 1]], dtype=float).T
        for t in placed:
            moved = (t @ corners)[:2]
            self.assertGreaterEqual(moved.min(), 0)
            self.assertLessEqual(moved[0].max(), width)
            self.assertLessEqual(moved[1].max(), height)

    def test_rotation_and_scale_read_back(self):
        degrees, scale = rotation_and_scale(rigid(12, 0, 0))
        self.assertAlmostEqual(12, degrees, places=6)
        self.assertAlmostEqual(1, scale, places=9)

    def test_displacement_is_zero_for_the_same_transform(self):
        points = np.array([[0, 0], [10, 5], [300, 200]])
        self.assertEqual(0, mean_displacement(rigid(4, 2, 1), rigid(4, 2, 1), points))
        self.assertAlmostEqual(5, mean_displacement(rigid(0, 3, 4), rigid(0, 0, 0), points))

    def test_rigid_fit_is_exact_and_never_scales_or_mirrors(self):
        rng = np.random.default_rng(0)
        src = rng.uniform(0, 500, (40, 2))
        truth = rigid(17, 30, -12)
        np.testing.assert_allclose(truth, rigid_fit(src, src @ truth[:, :2].T + truth[:, 2]), atol=1e-9)
        stretched = rigid_fit(src, src * 1.5)
        self.assertAlmostEqual(1, rotation_and_scale(stretched)[1], places=9)
        mirrored = src * [-1, 1]
        self.assertGreater(np.linalg.det(rigid_fit(src, mirrored)[:, :2]), 0)

    def test_dice(self):
        a = np.zeros((10, 10), np.uint8)
        a[:5] = 1
        self.assertEqual(1.0, dice(a, a))
        self.assertEqual(0.0, dice(a, 1 - a))
        self.assertEqual(1.0, dice(np.zeros((3, 3)), np.zeros((3, 3))))


class Images(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cv2.setRNGSeed(0)
        cls.a = fake_section()
        cls.truth = rigid(9, 14, -8, centre=(300, 250))
        cls.b = warp(cls.a, cls.truth)

    def test_tissue_mask_finds_the_stain_not_the_glass(self):
        mask = tissue_mask(self.a)
        self.assertEqual(0, mask[0, 0])
        self.assertEqual(1, mask[250, 300])

    def test_features_recover_a_known_turn_and_shift(self):
        fa, fb = rootsift(self.a, tissue_mask(self.a)), rootsift(self.b, tissue_mask(self.b))
        m, _, inliers, residual = feature_transform(fa, fb)
        self.assertGreaterEqual(inliers, 30)
        ys, xs = np.nonzero(tissue_mask(self.a))
        self.assertLess(mean_displacement(m, self.truth, np.stack([xs, ys], 1)), 1.0)  # under a pixel
        self.assertLess(residual, 1.0)

    def test_unrelated_sections_give_too_few_inliers(self):
        other = fake_section(seed=99)
        _, _, inliers, _ = feature_transform(rootsift(self.a, tissue_mask(self.a)), rootsift(other, tissue_mask(other)))
        self.assertLess(inliers, 30)

    def test_no_texture_means_no_features(self):
        blank = np.full((100, 100, 3), GLASS, np.uint8)
        m, _, inliers, _ = feature_transform(rootsift(blank, tissue_mask(blank)), rootsift(self.a, tissue_mask(self.a)))
        self.assertIsNone(m)
        self.assertEqual(0, inliers)

    def test_outline_gets_close_with_no_texture(self):
        # Two plain blobs: nothing for features, only the outline.
        plain = np.full((500, 600, 3), GLASS, np.uint8)
        cv2.ellipse(plain, (300, 250), (200, 110), 20, 0, 360, (225, 150, 222), -1)
        moved = warp(plain, self.truth)
        m = outline_transform(tissue_mask(plain), tissue_mask(moved))
        ys, xs = np.nonzero(tissue_mask(plain))
        self.assertLess(mean_displacement(m, self.truth, np.stack([xs, ys], 1)), 6.0)


class Vips(unittest.TestCase):
    def test_affine_args_are_plain_numbers(self):
        # numpy 2 writes its floats as np.float64(...), which libvips took as a singular matrix.
        args = vips_affine_args(Path("v"), Path("in.tif"), "out.tif", np.array(rigid(0, 12.5, -3)), 400, 300, (238, 237, 236))
        self.assertEqual("affine", args[1])
        self.assertEqual("1.0 0.0 -0.0 1.0", args[4])
        self.assertEqual("12.5", args[args.index("--odx") + 1])
        self.assertEqual("-3.0", args[args.index("--ody") + 1])
        self.assertEqual("0 0 400 300", args[args.index("--oarea") + 1])
        self.assertEqual("238 237 236", args[args.index("--background") + 1])
        self.assertNotIn("np.", " ".join(args))

    def test_affine_matrix_order_is_row_by_row(self):
        args = vips_affine_args(Path("v"), Path("i"), "o", np.array([[1.0, 2.0, 5.0], [3.0, 4.0, 6.0]]), 1, 1, (0, 0, 0))
        self.assertEqual("1.0 2.0 3.0 4.0", args[4])

    def test_pyramid_written_straight_from_affine(self):
        target = pyramid_target(Path("x.part.tif"), 85)
        self.assertTrue(target.startswith("x.part.tif["))
        for option in ("pyramid", "tile-width=256", "compression=jpeg", "Q=85", "bigtiff"):
            self.assertIn(option, target)


class Summary(unittest.TestCase):
    def test_gap_links_are_counted_apart(self):
        links = [Link(0, 1, "features", 200, 120, 7.0, 1.0, 1.0, 0.8, 0.9, 30.0),
                 Link(1, 2, "gap", 30, 4, None, -5.0, 1.0, 0.6, 0.85),
                 Link(2, 3, "features", 180, 90, 9.0, 2.0, 1.0, 0.7, 0.95, 50.0)]
        s = summary(links)
        self.assertEqual((2, 1), (s["feature_links"], s["gap_links"]))
        self.assertEqual(8.0, s["median_residual_um"])
        self.assertEqual(40.0, s["median_skip_one_um"])
        self.assertEqual(0.9, s["mean_dice_after"])


class Args(unittest.TestCase):
    def test_write_needs_vips(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            parse_args(["--sections", "s", "--out", "o", "--write"])

    def test_reading_only_needs_no_vips(self):
        args = parse_args(["--sections", "s", "--out", "o"])
        self.assertFalse(args.write)


if __name__ == "__main__":
    unittest.main()
