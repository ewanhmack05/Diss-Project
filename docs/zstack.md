# Z-stacks and 3D tissue

Planning notes for looking at tissue in depth: stepping through slices of
one block, and seeing it as a 3D volume that can be cut into. Nothing here is
built yet.

## Contents

1. [The goal](#1-the-goal)
2. [Two kinds of depth](#2-two-kinds-of-depth)
3. [Why it fits the dissertation](#3-why-it-fits-the-dissertation)
4. [Data](#4-data)
5. [Reading the files](#5-reading-the-files)
6. [Registration](#6-registration)
7. [Changes by service](#7-changes-by-service)
8. [The 3D view](#8-the-3d-view)
9. [Phases](#9-phases)
10. [Open questions](#10-open-questions)
11. [Verification log](#11-verification-log)

## 1. The goal

The target is the 3D view in DPLab: Shen et al., "An integrative web-based
software tool for multi-dimensional pathology whole-slide image analytics",
Physics in Medicine & Biology, 2022
([PubMed 36067783](https://www.pubmed.gov/36067783/),
[bioRxiv preprint](https://www.biorxiv.org/content/10.1101/2022.06.08.495366.full.pdf)).
Its figure 2 shows an H&E tissue block in the browser that you can:

- pan, zoom and turn
- make thicker or thinner (how many slices are stacked)
- show with gridlines and its boundary
- mark with a 3D box round a feature
- clip on a diagonal to see the cut faces inside

DPLab builds that block by registering 2D whole-slide images of serial
sections - consecutive slices cut from the same tissue - and stacking them.
That's the model this plan follows.

What this project adds on top is that it's shared live and versioned: several
people in one volume, following each other's cuts, with marks and annotations
that have a history like everything else in a collection.

## 2. Two kinds of depth

"Z-stack" covers two different things, and the goal needs the second.

| | Focal planes | Serial sections |
| --- | --- | --- |
| What it is | One slice scanned at several focus depths | Many slices cut one after another, each scanned flat |
| Depth covered | A few microns, inside one 3-5 um section | As deep as you cut - 15 sections at 4 um is 60 um, hundreds go to millimetres |
| Lined up already? | Yes, same slide, same stage | No - every slice is cut, floated and mounted separately, so it's shifted, turned and stretched |
| Good for | Focusing through thick cells, cytology | 3D structure - vessels, glands, tumour shape |
| Gives the DPLab view? | No, too shallow | Yes |

Both look the same to the viewer once the data's ready: an ordered list of
2D images of the same place, with a depth for each. So the viewer, store and
hub work below is the same for either. The difference is all in getting the
data ready, and serial sections need [registration](#6-registration) first.

## 3. Why it fits the dissertation

Depth is another dimension of shared state. Today an annotation, a dot or a
viewport is a place on a flat image. In a volume it's a place at a depth, and
every part of the real-time and version control work has to carry that:

- **Live** - Follow and Present keep everyone on the host's slice and, in 3D,
  on the host's cut and camera, or two people looking at "the same" place see
  different tissue.
- **History** - moving an annotation to another slice, or placing a 3D mark,
  is an edit. It shows in the History tab, can be gone back on, and can
  conflict with someone else's edit.
- **Counting** - one cell can show on two neighbouring slices, so a count
  that ignores depth counts it twice.

The games development parallel is a level editor working on a 3D world:
collaborators each with their own camera and cutaway, edits that belong to a
place in 3D, and following someone meaning following their camera. The 3D
view itself - a textured volume with clipping planes - is standard real-time
graphics.

## 4. Data

### Pick: EPFL mouse liver serial sections

[Zenodo record 12072433](https://zenodo.org/records/12072433),
DOI [10.5281/zenodo.12072433](https://doi.org/10.5281/zenodo.12072433).

| What | Value |
| --- | --- |
| Tissue | Mouse liver and small intestine, H&E |
| Sections | 15 serial sections |
| Made by | EPFL histology core facility, scanned at EPFL BIOP on an Evident VS200 |
| Format | Olympus cellSens VSI - one `.vsi` per section plus a `_Image_NN_` folder of `.ets` files |
| Size | 3.0 GB, one `Serial_Sections.zip`. The biggest `.ets` per section is 137-164 MB |
| Licence | CC BY 4.0 |
| Download | Direct from Zenodo, no account, no Aspera |
| Full-res image | Series 13 (`20x_BF_01`) in every `.vsi`, UPLXAPO 20x / 0.8 NA, 0.27366 um/pixel, one focal plane |
| Section size | 28014-32430 x 35801-37822 pixels, about 8 x 10 mm. Different for every section |
| On each slide | A liver lobe and a cross-section of small intestine |
| Not stated | Section thickness - not on Zenodo, not in the VSI metadata |

Why this one:

- It's the DPLab case exactly - H&E serial sections, made to test
  registration.
- 3 GB, so the whole thing fits on a laptop and in a test run. The others are
  hundreds of GB or TB.
- Direct download under CC BY 4.0, so a script can fetch it and anyone can
  reproduce the dissertation's results.
- 15 slices is enough for a block that looks like a block, and small enough to
  get working before going bigger.

What it costs: VSI isn't a format OpenSlide reads (see
[section 5](#5-reading-the-files)), so it goes through a conversion step.

### Others looked at

| Dataset | Depth | Format, size | Licence, access | Why not first |
| --- | --- | --- | --- | --- |
| [PCa_Bx_3Dpathology](https://www.cancerimagingarchive.net/collection/pca_bx_3dpathology/) (TCIA) | True 3D, open-top light-sheet scans of whole prostate biopsies, 50 patients | HDF5, fused at 2x downsample, 2 channels (nuclear + eosin analogue) | CC BY 4.0, DOI 10.7937/44MA-GX21. One 3.8 TB Aspera package, no per-biopsy download listed | Size. Real 3D and the best "next" dataset once the pipeline works. Also fluorescent, so it needs false colouring to look like H&E |
| [HyReCo](https://ieee-dataport.org/open-access/hyreco-hybrid-re-stained-and-consecutive-histological-serial-sections-cc-sa-40) (IEEE DataPort) | 9 cases of 4 consecutive sections (H&E, CD8, CD45, Ki67), plus registration landmarks | BigTIFF + CSV landmarks. Zip sizes of 233 GB and 274 GB seen on a mirror only | CC BY-SA 4.0, DOI 10.21227/pzj5-bs61. Needs a free IEEE login | 4 slices is thin, and it's big. But mixed stains is DPLab's "interdigitated biomarker" idea, and the landmarks would measure registration |
| [HunCRC](https://www.cancerimagingarchive.net/collection/hungarian-colorectal-screening/) (TCIA) | Unknown. Single sections, maybe with focal planes - see below | MIRAX, 392 GB | CC BY 4.0, Aspera | Not serial sections, and nobody can say if it has focal planes without a `Slidedat.ini` |
| [ANHIR](https://anhir.grand-challenge.org/Data/) | Small sets of differently stained sections, 8 tissues | Images at 5-100% scale + landmarks | Grand Challenge account, licence not confirmed | Built for pairwise registration, not volumes |
| [BigBrain](https://bigbrainproject.org/maps-and-models.html) | 7404 sections of a whole human brain, 20 um | Volumes at 100 um and coarser in MINC/NIfTI | Research use only per McGill | Not H&E, and not a whole-slide-image pipeline |

### HunCRC and focal planes

Kept for the record, since it's how this started. The TCIA page doesn't say
whether the slides have more than one focal plane, the paper couldn't be read
from here, and [PathDB](https://pathdb.cancerimagingarchive.net/) only has a
converted preview. For slide 1 (PathDB node 2613), the node's JSON points at
`.../converted/Hungarian-Colorectal-Screening/mrxs_files/001.tiff`, and its
IIPImage server reports `Max-size:2131 2300`, `Resolution-number:5`. At the
scan's 0.1213 um/pixel that would be 0.26 x 0.28 mm, far smaller than a
biopsy, so it's scaled down. Its pixel size is 352.778 um, which is 25400 / 72,
a 72 dpi default.

To check a MIRAX slide for focal planes: its `Slidedat.ini` has a
`HIER_n_NAME = Microscope focus level` layer. Slide 003 has it with
`HIER_2_COUNT = 1`, one plane. More than 1 means a focal stack, each plane with
its own `OFFSET_IN_MICROMETERS`.

## 5. Reading the files

The tiler reads slides through OpenSlide, and OpenSlide doesn't read focal
planes at all: only plane 0 of an NDPI
([OpenSlide formats](https://manpages.org/openslide-formats/3)), and the MIRAX
driver skips everything but the zoom levels
([openslide-users, 2014](https://lists.andrew.cmu.edu/pipermail/openslide-users/2014-December/000984.html)).
VSI isn't on OpenSlide's format list either.

So the plan is to convert once, offline, into something OpenSlide does read,
and keep the tiler's tile path (`ZoomifyTiling.Resolve`, `SlideHandlePool`)
as it is:

1. **VSI to TIFF** with Bio-Formats' `bfconvert`. Bio-Formats reads cellSens
   VSI ([Bio-Formats WSI docs](https://bio-formats.readthedocs.io/en/latest/developers/wsi.html)).
   [vsi2tif](https://github.imc.re/AICAN-Research/vsi2tif) wraps exactly this
   step and the next, so check it before writing our own.
2. **TIFF to a tiled pyramid** with libvips:
   `vips tiffsave in.tif out.tif --tile --tile-width 256 --tile-height 256 --pyramid --compression jpeg --Q 80 --bigtiff`.
   OpenSlide reads that as a
   [generic tiled TIFF](https://openslide.org/formats/generic-tiff).
3. **Register** the sections (next section) and write each one out already
   lined up, so the tiler serves registered tiles with no transform at request
   time.

These live in [volume-prep/](../volume-prep/README.md), one script for
converting and one for registering. `SlideCatalog` only looks for `*.mrxs`
today, so it'll need to pick up `.tif` too.

### Tried on section 0

Steps 1 and 2 work. Tools: Bio-Formats bftools 7.3.1 (the last line that runs
on Java 8), libvips 8.18.7, OpenSlide 4.0.1 through openslide-python 1.4.7.

```bash
bfconvert -series 13 -tilex 512 -tiley 512 -compression JPEG -bigtiff Image_00.vsi Image_00_flat.ome.tif
vips tiffsave Image_00_flat.ome.tif Image_00.tif --tile --tile-width 256 --tile-height 256 --pyramid --compression jpeg --Q 85 --bigtiff
```

| What | Result |
| --- | --- |
| Time | 52 s for `bfconvert`, 2 s for `vips` |
| Size | 65 MB flat, 119 MB pyramid (the VSI's own 20x `.ets` is 154 MB) |
| OpenSlide | Opens it as `generic-tiff`, 29833 x 37633, 9 levels |
| Pixel size | `openslide.mpp-x` 0.273656, `openslide.mpp-y` 0.273660 - carried through from the VSI, so the ruler and ROI sizes will be right |
| Pixels | Thumbnail shows the liver lobe and intestine, no black tiles |

A VSI holds several images, so `-series` matters: 0-5 are the label and its
pyramid, 6-12 the 2x overview, 13 the 20x scan, 14-20 its pyramid, 21 the
macro image. Series 13 is the same in all 15 files, but the script finds it by
name (`20x_BF_01`), not by number.

### All 15 sections

[volume-prep/convert_sections.py](../volume-prep/convert_sections.py) does steps 1
and 2 for a whole folder - see the
[volume-prep README](../volume-prep/README.md#1-converting). On the liver set it
takes about 55 s a section, 13-14 minutes for all 15, and writes 1.7 GB.
Each output is checked against its source's size and pixel size before it
counts, and checked again independently with OpenSlide afterwards: all 15
open as `generic-tiff` with 9 levels and the right pixel size.

**Section 8 claims more than was scanned.** Its VSI says 32430 x 37531, but
every level of its own pyramid stops at 35840 rows, 1691 short. Bio-Formats
fills the missing rows with black, which showed as a black band along the
bottom of the first conversion - and would have been a black slab in the 3D
block. The other 14 match their pyramids to within rounding. The script now
works out the scanned size from the pyramid and crops to it.

**The sections don't line up as they come.** A contact sheet of all 15 shows
the same liver lobe and intestine on each, but shifted and turned a little
from one to the next - section 13 most. That's what
[registration](#6-registration) is for. The sections are also all different
sizes, so registration has to put them on one shared canvas too.

## 6. Registration

Serial sections don't line up. Each one is cut, floated and mounted on its own
slide, so it comes out shifted, rotated, sometimes flipped, stretched and
torn. Stacking them as they are gives a block that jitters from slice to slice.

Registration works out the transform for each section onto its neighbour:
first rigid or affine (shift, turn, scale), then non-rigid (a smooth warp for
the stretching). Every published 3D histology pipeline does this, DPLab
included.

- **Offline.** It's deterministic, so it's a script that runs once, not
  something in the viewer or the tiler. The output is registered pyramids,
  one per section, all on one canvas, so the tiler serves them as they are.
- **Tool.** VALIS is the standard for serial whole-slide images, but it's had
  no change in 17 months (116 open issues) and pulls in torch, numpy<2 and
  Java. Warpy applies transforms made by hand in Fiji, and ABBA registers to a
  brain atlas, so neither fits a script. So
  [volume-prep/register_sections.py](../volume-prep/register_sections.py)
  does what VALIS does - features, RANSAC, chaining to the middle section -
  in a few hundred lines of OpenCV that are tested and can be explained. How
  it works and why each choice was made is in the
  [volume-prep README](../volume-prep/README.md#2-registering).
- **Rigid, for now.** Turn and shift only. Letting scale float made it drift
  1.5% and doubled the error. Non-rigid comes later if the 3D view needs it.

### On the liver set

| What | Result |
| --- | --- |
| Links | 13 by features, 1 gap (09 to 10) |
| Median residual | 7.4 um |
| Skip-one error (i to i+2 direct against chained) | median 38.1 um, worst 56.5 um |
| Neighbour overlap (Dice) | 0.787 before, 0.906 after |
| Canvas | 40288 x 45104 px |
| Time | 12 s to register, about 70 s to write all 15 full size |
| Written | 1.9 GB. Full-size patches match the originals to 2.7-3.6 grey levels |

**The liver set is two runs, not one.** Sections 0-9 and 10-14 are each
consecutive - every section's best match is its neighbour in file order - but
nothing links the two runs: every pair across them sits at the noise floor.
Not blur (evening it out didn't help), just cuts that aren't there. So the
block has a gap of unknown depth between 9 and 10, lined up by tissue outline
only. The 3D view should show it as a gap, not draw the block as continuous.

**What's left** is the 38 um skip-one error, mostly tissue stretched
differently on each slide. A non-rigid step would take that out.

## 7. Changes by service

The viewer, store and hub changes are the same for focal planes and serial
sections: both are "slice N of M at depth d".

### tiler

Done - see the [tiler README](../tiler/README.md#volumes).

- **Catalog.** A volume is one slide id with N slices, configured as
  `Slides:Volumes:{id} = {folder of register_sections.py's output}`. Every
  slide is now an ordered list of files with a `SlideHandlePool` per slice; a
  flat slide is a list of one, so nothing else needs a special case. A
  volume set up wrong stops the tiler starting, saying why.
- **Metadata.** `SlideInfo` gains `slices` (`index`, `gapBefore`) and
  `defaultSlice`. No depth in microns yet - the liver set doesn't say how
  thick its sections are.
- **Tiles.** `/slides/{id}/slice/{slice}/TileGroup{n}/{z}-{x}-{y}.jpg`. The
  old route serves the default slice, byte for byte the same, so the viewer
  as it is can already open the liver volume as a flat slide.
- **Two fixes it needed.** OpenSlide 3.4 (what the tiler runs) gives no
  pixel size for a generic TIFF, so it's now worked out from the TIFF's
  resolution. And OpenSlideSharp's string marshaling isn't thread-safe:
  reading properties while anything else used OpenSlide crashed the process.
  That was already there for flat slides; the volume tests were the first to
  run OpenSlide on two threads in the tests, and found it. The tiler now
  opens slides and reads properties itself.
- **Volume for the 3D view.** A small, downsampled copy of the whole block
  (e.g. 512 x 512 x N, RGB) as one file, for [the 3D view](#8-the-3d-view).
  Made by the conversion script, served as a static file.
- **Thumbnails** stay on the default slice.

### image-viewer

- **Layers.** `showSlide` (`OpenLayers.ts`) swaps one source, which would
  refetch and flash on every slice change. Instead one `WebGLTileLayer` per
  slice, with the current slice and the one each side loaded and only the
  current one shown.
- **Cost.** That's about 3x the tile requests, on top of the third more that
  `preload: Infinity` already adds. Measure it the way
  [rendering.md](rendering.md) did before deciding how many neighbours to
  keep.
- **Controls.** In the Depth tab (see [section 8](#8-the-3d-view)), plus
  Shift+wheel and PageUp/PageDown on the map. The status bar shows the slice
  and its depth in microns.
- **Adjustments** are style variables, so applying them to every slice layer
  is cheap.
- **Annotations on other slices** - probably faded for the slices either side
  and hidden past that, with a toggle.

### annotation-store

- `Annotation` gains a nullable `Z` (slice index). Null means every slice,
  which is what every row from before this is.
- `CellCountDot` gains `z` in its JSON.
- A 3D mark (the box round a feature in DPLab's figure) is a new kind of
  annotation: a box with a min and max on each axis. GeoJSON is 2D, so it
  needs its own shape and column.
- History needs nothing new: it already keeps the columns an edit changed.
- `EditConflicts` checks `WasColour`. A slice change needs `WasZ` the same
  way.
- Migration adds nullable columns, so old rows need no backfill.

### realtime-hub

- `Viewport` in `Slides/Messages.cs` gains `Z`, so Follow and Present keep
  people on the host's slice and viewport boxes can say "slice 3". In 3D it
  also needs the camera and the clip plane. That's a contract change, so the
  hub and the viewer go together.
- Sketches are opaque and need nothing. Live ops carry the annotation, so its
  `Z` comes along.
- Comparison counts: `MatchRadius` is flat today. Matching needs a depth rule
  too.

## 8. The 3D view

### The Depth tab

Everything for volumes lives in one new toolbar tab, and it's only there when
the slide open has more than one slice. A flat slide looks exactly as it does
now. Same pattern as the other panels: an entry in `panelDefs` in `App.tsx`
(`{ id: "depth-panel", title: "Depth", tool: "depth", ... }`), its button in
the toolbar, docks and floats like the rest. The button's shown from the
slide's metadata - `slices` longer than one - so nothing else needs to know.

What's in it:

| Part | 2D | 3D |
| --- | --- | --- |
| **View switch** | 2D / 3D toggle at the top. Swaps what the map area shows; the panel stays open | |
| **Slice** | Slider and number, with depth in microns. Same as Shift+wheel and PageUp/PageDown | Moves the cut plane through the block |
| **Neighbours** | Fade annotations on the slices either side, on/off | |
| **Thickness** | | How many slices are drawn, round the current one |
| **Cut** | | Clip on X, Y, Z or a diagonal, with a slider for where |
| **Opacity** | | How see-through the block is |
| **Guides** | | Gridlines and the block's boundary, on/off |
| **Reset** | | Camera back to the default view |

Basic controls first. Markers, measuring in 3D and following someone's camera
come after.

The switch swaps the whole map area rather than splitting it, so the 2D view
keeps the full screen when you're working in it. The two stay linked:
switching to 3D opens on the slice and place you were at in 2D, and clicking
the block in 3D switches back to 2D at that slice and place.

### Drawing the block

A separate view from the 2D one, not a replacement. The 2D viewer stays
where the detail is - full resolution, one slice at a time. The 3D view shows
the shape of the whole block at low resolution and is where you choose where
to look.

- **What it draws.** The downsampled block as a 3D texture, ray-marched in a
  shader, with clip planes. That's the same technique as DPLab's figure: cut
  on any axis or a diagonal, thickness as how many slices are drawn, opacity,
  gridlines, a 3D marker box.
- **Library.** OpenLayers is 2D only, so this is a new dependency. Candidates
  to compare: three.js (has 3D textures and clipping planes, and is games
  tooling, which helps the games tie-in) and vtk.js (built for medical
  volumes). Neither is checked against this data yet.
- **Linked to 2D.** Clicking a point in 3D opens that slice at that place in
  2D, through the Depth tab's switch. The 2D view's current slice and
  viewport show as a plane and a box in 3D.
- **Size.** 512 x 512 x 15 RGB is about 11.8 MB raw. That's fine for one
  block. Bigger volumes need bricking (loading the block in chunks by level of
  detail), which is phase-later work.
- **Shared.** The camera and clip plane go over the hub like a viewport, so
  Follow works in 3D too.

## 9. Phases

1. **Get the data in.** Done - all 15 converted and checked. Still to do:
   load one in the existing viewer as a flat slide.
2. **Register.** Done, rigid - 15 registered pyramids on one canvas, measured
   before and after. Non-rigid is open.
3. **Step through slices, read only.** Done - tiler catalog, metadata and
   route, and the viewer's Depth tab, 2D only. See the
   [viewer README](../image-viewer/README.md#tools).
4. **Live.** `Z` on `Viewport`, Follow and Present on the host's slice.
5. **Annotate at a depth.** `Z` on annotations and dots, conflicts, history
   lines that say which slice moved where.
6. **3D view.** Done - the Depth tab's 2D / 3D switch, a ray-marched block
   with cut (X, Y, Z, diagonal), slices drawn, opacity, depth stretch,
   guides and reset, and a click on the tissue opening that place in 2D.
   Built from one 512 px thumbnail per slice, no extra file to make. See the
   [viewer README](../image-viewer/README.md#tools).
7. **More 3D.** Markers, camera and cut shared live, Follow in 3D.
8. **Bigger data.** PCa_Bx_3Dpathology for true 3D, HyReCo for mixed stains
   and measured registration.

Each phase measures something: alignment error (2), tile requests and time to
sharp on a slice change (3), how long until a follower's on the host's slice
(4, the same way [timing.md](timing.md) times viewports), frame rate of the 3D
view while cutting (6).

## 10. Open questions

- Is the 3D view in scope for the dissertation, or the stretch goal after
  slices, live and history?
- Is rigid registration good enough for the 3D view, or does it need a
  non-rigid step for the 38 um that's left?
- How should the 3D view show the gap between sections 9 and 10?
- three.js or vtk.js for the 3D view?
- Plane index or microns for `Z`? Storing the index and showing microns from
  `slices` covers both.
- Should annotations default to "every slice" or "the slice you drew on"?
- Where does volume data get hosted for the Azure deploy
  ([azure.md](azure.md))? The tiler image is already 3.1 GB with one slide.

## 11. Verification log

| Claim | Checked against | Status |
| --- | --- | --- |
| Goal figure is DPLab, Shen et al., Phys. Med. Biol. 2022, built from registered serial sections | ResearchGate figure page, PubMed and bioRxiv listings | Checked |
| Liver set: 15 H&E serial sections, VS200, CC BY 4.0, 3.0 GB, direct download | Zenodo record page | Checked |
| Liver set is VSI + ETS, 15 `.vsi` files | Zenodo zip preview listing | Checked |
| Liver set downloads without an account | Downloaded with plain `curl`, 2,963,985,418 bytes, md5 `98450391714bbcfff551c85d6702d935` matches Zenodo's | Checked |
| Liver set pixel size 0.27366 um, 20x, one focal plane, sizes per section | Bio-Formats `showinf` OME-XML on all 15 files | Checked |
| Liver set section thickness | Not on Zenodo, not in the VSI metadata | **Unknown** - ask the EPFL contact, or assume 4 um and say so |
| OpenSlide can't read VSI | Not on OpenSlide's format list. Not needed now, since we convert | Not tested |
| `bfconvert` + `vips tiffsave` gives a TIFF OpenSlide reads | All 15 converted, each opened with OpenSlide 4.0.1: generic-tiff, right size, 9 levels, mpp kept | Checked |
| Section 8's VSI claims 1691 rows it has no pixels for | Its 7 pyramid levels all stop at 35840 rows. Black band starts at row 35840 in the first conversion | Checked |
| A second run of the script skips finished sections | Ran it again: "15 already done, 0 to convert" | Checked |
| Liver sections 0-9 and 10-14 are two separate runs | All-pairs inlier matrix: 48-165 between file-order neighbours, at most 9 across the runs | Checked |
| The gap isn't a sharpness difference | Blurring all sections to sigma 1-3 first left 09 to 10 at 4-5 inliers | Checked |
| Rigid beats similarity | Skip-one error worst 114 um similarity, 57 um rigid, same 11 checks | Checked |
| Registered sections are placed right at full size | 512 px patches against originals through the inverse transform, sections 0, 8, 14: 2.7-3.6 grey levels apart, 14-21 when shifted 3 px | Checked |
| libvips affine uses the same convention as OpenCV | Section 0 written by vips, read back small, against OpenCV's warp: tissue Dice 0.9935 | Checked |
| Section thickness, so the gap's depth | Not in the data | **Unknown** - the 3D view assumes 4 um and says so |
| The 3D view draws the liver block, cuts it and opens 2D where clicked | Browser against the liver volume: block, X and diagonal cuts, a click on the front landed on slice 1 in the liver lobe in 2D | Checked |
| 2D / 3D back and forth leaks no GL contexts and fetches nothing again | 5 round trips: canvases 4 before and after, 0 thumbnails fetched again, 3D back in about 60 ms | Checked |
| The liver volume is found in tiler/data with no config | Tiler started with no volume setting lists 000-003 and liver (15 slices) | Checked |
| A step to a neighbouring slice fetches nothing for the slice it shows | Viewer against the liver volume, resource timings: Next fetched 15 tiles of the new neighbour only, the same for PageDown and Shift+wheel | Checked |
| Moving through slices and slides makes no new GL contexts | 4 WebGL canvases before and after stepping, jumping, a flat slide and back. Unit test: 3 layers made across a full sweep both ways | Checked |
| A flat slide's tiles are unchanged | Opening 000 after the volume: 1 tile layer, every tile on `/slides/000/TileGroup...`, no `/slice/` | Checked |
| The tiler serves the liver volume | Ran it with `Slides__Volumes__liver`: 15 slices, gap before 10, default 7, mpp 0.273655, tiles 6-46 ms, slice 15 is a 404 | Checked |
| The old tile route is the default slice | Same bytes as `/slice/7/` for the same tile | Checked |
| OpenSlide 3.4.1 gives no mpp for a generic TIFF | Read the bundled DLL's version, printed a TIFF's properties: `tiff.XResolution` and `tiff.ResolutionUnit`, no `openslide.mpp-x` | Checked |
| OpenSlideSharp crashes on property reads alongside other calls | Three repros crashed every run (MIRAX properties next to TIFF opens, TIFF reads, MIRAX reads). Its marshaler keeps the native string in a shared field. With the tiler's own interop all three pass, nine runs | Checked |
| PCa_Bx_3Dpathology: CC BY 4.0, HDF5, 3.8 TB, Aspera, one package | TCIA collection page | Checked |
| HyReCo: 9 cases x 4 sections, BigTIFF, CC BY-SA 4.0, login | IEEE DataPort listing via search | Checked |
| HyReCo zip sizes (233 GB, 274 GB) | Test mirror only | **Unconfirmed** |
| HunCRC has focal planes | Not stated on TCIA. Paper not readable. PathDB copy is a converted preview | **Unknown** |
| OpenSlide reads only plane 0 of NDPI | OpenSlide formats man page | Checked |
| OpenSlide skips MIRAX z layers | openslide-users post, 2014 | Old source |
| Slide 003 has a focus level layer with one plane | `tiler/data/003/Slidedat.ini` | Checked |
| 512 x 512 x 15 x 3 bytes is about 11.8 MB | Arithmetic | Checked |
