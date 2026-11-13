"""Tests for convert_sections.py's parts that don't need Bio-Formats or libvips.

    python -m unittest discover -s volume-prep
"""
import json
import tempfile
import unittest
from pathlib import Path

from convert_sections import (
    Series,
    bfconvert_args,
    check_output,
    find_sections,
    load_manifest,
    parse_args,
    parse_header,
    parse_ome,
    pick_series,
    progress,
    pyramid_of,
    save_manifest,
    scanned_extent,
    section_order,
    still_to_do,
    vips_args,
)

# Cut down from showinf's real output for the EPFL liver set's Image_00.vsi:
# its own lines first, then the XML, with the micron sign as the console mangled it.
SHOWINF = """Checking file format [CellSens VSI]
Initializing reader
<?xml version="1.0" encoding="UTF-8"?><OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">
<Image ID="Image:0" Name="label"><Pixels ID="Pixels:0" PhysicalSizeX="2.7198" PhysicalSizeXUnit="\ufffdm"
 PhysicalSizeY="2.7199" SizeC="3" SizeT="1" SizeX="8075" SizeY="9429" SizeZ="1" Type="uint8" DimensionOrder="XYCZT"/></Image>
<Image ID="Image:1" Name="Image_00.vsi #2"><Pixels ID="Pixels:1" SizeC="3" SizeT="1" SizeX="4038" SizeY="4715" SizeZ="1"
 Type="uint8" DimensionOrder="XYCZT"/></Image>
<Image ID="Image:2" Name="20x_BF_01"><Pixels ID="Pixels:2" PhysicalSizeX="0.273656133241878" PhysicalSizeXUnit="\ufffdm"
 PhysicalSizeY="0.27366002912718707" SizeC="3" SizeT="1" SizeX="29833" SizeY="37633" SizeZ="1" Type="uint8" DimensionOrder="XYCZT"/></Image>
</OME>
"""

# vipsheader -a on the real section 0 output, first lines.
VIPSHEADER = """C:/data/Image_00.tif: 29833x37633 uchar, 3 bands, srgb, tiffload
width: 29833
height: 37633
bands: 3
xres: 3654.22
yres: 3654.17
filename: C:/data/Image_00.tif
image-description: <?xml version="1.0"?><!-- note: has colons -->
"""

SCAN = Series(index=2, name="20x_BF_01", width=29833, height=37633, mpp_x=0.273656133241878, mpp_y=0.27366002912718707, planes=1)


class ParseOme(unittest.TestCase):
    def test_reads_every_image_past_showinfs_own_lines(self):
        series = parse_ome(SHOWINF)
        self.assertEqual(["label", "Image_00.vsi #2", "20x_BF_01"], [s.name for s in series])
        self.assertEqual([0, 1, 2], [s.index for s in series])

    def test_reads_size_and_pixel_size(self):
        self.assertEqual(SCAN, parse_ome(SHOWINF)[2])

    def test_pyramid_levels_have_no_pixel_size(self):
        self.assertIsNone(parse_ome(SHOWINF)[1].mpp_x)

    def test_no_xml_is_an_error(self):
        with self.assertRaises(ValueError):
            parse_ome("Exception: file not found")


class PickSeries(unittest.TestCase):
    def test_by_name_not_number(self):
        self.assertEqual(2, pick_series(parse_ome(SHOWINF), "20x_BF_01").index)

    def test_missing_name_lists_what_there_is(self):
        with self.assertRaisesRegex(ValueError, "label"):
            pick_series(parse_ome(SHOWINF), "40x_BF_01")

    def test_no_pixel_size_is_refused(self):
        with self.assertRaisesRegex(ValueError, "pixel size"):
            pick_series(parse_ome(SHOWINF), "Image_00.vsi #2")

    def test_more_than_one_focal_plane_is_refused(self):
        stack = Series(0, "20x_BF_01", 10, 10, 0.27, 0.27, planes=5)
        with self.assertRaisesRegex(ValueError, "5 focal planes"):
            pick_series([stack], "20x_BF_01")


def levels(scan, sizes):
    return [Series(scan.index + 1 + k, f"Image.vsi #{k}", w, h, None, None, 1) for k, (w, h) in enumerate(sizes)]


# Section 8 of the EPFL liver set, from showinf: the scan says 37531 rows,
# every level of its own pyramid says 35840.
SECTION_8 = Series(index=13, name="20x_BF_01", width=32430, height=37531, mpp_x=0.27366, mpp_y=0.27366, planes=1)
SECTION_8_LEVELS = [(16215, 17920), (8108, 8960), (4054, 4480), (2027, 2240), (1014, 1120), (507, 560), (254, 280)]


class ScannedExtent(unittest.TestCase):
    def test_section_8_is_cropped_to_what_was_scanned(self):
        self.assertEqual((32430, 35840), scanned_extent(SECTION_8, levels(SECTION_8, SECTION_8_LEVELS)))

    def test_rounding_up_levels_leaves_the_full_size(self):
        # Section 0: each level rounds up, so it's never short.
        sizes = [(14917, 18817), (7459, 9409), (3730, 4705), (1865, 2353), (933, 1177), (467, 589), (234, 295)]
        self.assertEqual((29833, 37633), scanned_extent(SCAN, levels(SCAN, sizes)))

    def test_no_pyramid_is_the_full_size(self):
        self.assertEqual((29833, 37633), scanned_extent(SCAN, []))

    def test_pyramid_stops_at_the_next_named_image(self):
        series = [SCAN, *levels(SCAN, [(14917, 18817), (7459, 9409)]), Series(5, "macro image", 991, 375, 1.0, 1.0, 1)]
        series = [Series(i, s.name, s.width, s.height, s.mpp_x, s.mpp_y, s.planes) for i, s in enumerate(series)]
        scan = series[0]
        self.assertEqual(["Image.vsi #0", "Image.vsi #1"], [s.name for s in pyramid_of(series, scan)])

    def test_crop_goes_to_bfconvert_only_when_needed(self):
        cropped = bfconvert_args(Path("bf"), Path("Image_08.vsi"), 13, Path("flat.tif"), (32430, 35840))
        self.assertEqual("0,0,32430,35840", cropped[cropped.index("-crop") + 1])
        self.assertNotIn("-crop", bfconvert_args(Path("bf"), Path("Image_00.vsi"), 13, Path("flat.tif")))

    def test_check_expects_the_cropped_size(self):
        header = {"width": 32430, "height": 35840, "mpp_x": 0.27366, "mpp_y": 0.27366}
        self.assertEqual([], check_output(SECTION_8, header, (32430, 35840)))
        self.assertEqual(1, len(check_output(SECTION_8, header)))


class Sections(unittest.TestCase):
    def test_order_comes_from_the_number(self):
        self.assertEqual(7, section_order("raw/Image_07.vsi"))
        self.assertEqual(14, section_order(Path("Image_14.vsi")))

    def test_no_number_is_an_error(self):
        with self.assertRaises(ValueError):
            section_order("overview.vsi")

    def test_found_in_cutting_order_and_filtered(self):
        with tempfile.TemporaryDirectory() as raw:
            for n in (10, 2, 0, 1):
                Path(raw, f"Image_{n:02d}.vsi").touch()
            Path(raw, "notes.txt").touch()
            self.assertEqual(["Image_00", "Image_01", "Image_02", "Image_10"], [f.stem for f in find_sections(raw)])
            self.assertEqual(["Image_02", "Image_10"], [f.stem for f in find_sections(raw, only=[10, 2])])


class Commands(unittest.TestCase):
    def test_bfconvert_takes_the_picked_series(self):
        args = bfconvert_args(Path("bf"), Path("Image_00.vsi"), 13, Path("flat.tif"))
        self.assertEqual("13", args[args.index("-series") + 1])
        self.assertIn("-bigtiff", args)
        self.assertEqual(["Image_00.vsi", "flat.tif"], args[-2:])

    def test_vips_makes_a_256_tiled_jpeg_pyramid(self):
        args = vips_args(Path("v"), Path("flat.tif"), Path("out.tif"), 85)
        self.assertEqual("tiffsave", args[1])
        for flag in ("--tile", "--pyramid", "--bigtiff"):
            self.assertIn(flag, args)
        self.assertEqual("256", args[args.index("--tile-width") + 1])
        self.assertEqual("85", args[args.index("--Q") + 1])


class CheckOutput(unittest.TestCase):
    def test_header_gives_size_and_microns_per_pixel(self):
        header = parse_header(VIPSHEADER)
        self.assertEqual((29833, 37633), (header["width"], header["height"]))
        self.assertAlmostEqual(0.273656, header["mpp_x"], places=6)

    def test_real_section_0_passes(self):
        self.assertEqual([], check_output(SCAN, parse_header(VIPSHEADER)))

    def test_wrong_size_fails(self):
        header = parse_header(VIPSHEADER) | {"width": 14916}
        self.assertEqual(1, len(check_output(SCAN, header)))

    def test_lost_pixel_size_fails(self):
        # vips' default with no resolution is 1 pixel per mm, so 1000 um per pixel.
        header = parse_header(VIPSHEADER) | {"mpp_x": 1000.0, "mpp_y": 1000.0}
        self.assertEqual(2, len(check_output(SCAN, header)))


class Manifest(unittest.TestCase):
    def entry(self, order, size):
        return {"order": order, "source": f"Image_{order:02d}.vsi", "file": f"Image_{order:02d}.tif", "bytes": size}

    def test_round_trips_in_order(self):
        with tempfile.TemporaryDirectory() as out:
            save_manifest(out, {2: self.entry(2, 5), 0: self.entry(0, 5)})
            saved = json.loads(Path(out, "manifest.json").read_text())
            self.assertEqual([0, 2], [s["order"] for s in saved["sections"]])
            self.assertEqual({0, 2}, set(load_manifest(out)))
            self.assertFalse(Path(out, "manifest.json.part").exists())

    def test_no_manifest_is_nothing_done(self):
        with tempfile.TemporaryDirectory() as out:
            self.assertEqual({}, load_manifest(out))

    def test_only_unfinished_sections_are_redone(self):
        with tempfile.TemporaryDirectory() as out:
            files = [Path(f"Image_{n:02d}.vsi") for n in range(4)]
            Path(out, "Image_00.tif").write_bytes(b"12345")
            Path(out, "Image_01.tif").write_bytes(b"123")
            done = {0: self.entry(0, 5), 1: self.entry(1, 5), 3: self.entry(3, 5)}
            todo = still_to_do(files, done, out, force=False)
            # 0 is done; 1 changed size; 2 was never done; 3's file is gone.
            self.assertEqual(["Image_01", "Image_02", "Image_03"], [f.stem for f in todo])
            self.assertEqual(4, len(still_to_do(files, done, out, force=True)))


class Progress(unittest.TestCase):
    def test_eta_is_mean_time_times_whats_left(self):
        self.assertEqual("3/15 20% ETA 4m 0s", progress(3, 15, 60))

    def test_nothing_done_yet(self):
        self.assertEqual("0/15 0% ETA unknown", progress(0, 15, 0))

    def test_finished(self):
        self.assertEqual("15/15 100% ETA 0m 0s", progress(15, 15, 300))


class Args(unittest.TestCase):
    def test_defaults(self):
        args = parse_args(["--raw", "r", "--out", "o", "--bftools", "b", "--vips", "v"])
        self.assertEqual("20x_BF_01", args.series_name)
        self.assertEqual(85, args.quality)
        self.assertIsNone(args.only)
        self.assertFalse(args.force)


if __name__ == "__main__":
    unittest.main()
