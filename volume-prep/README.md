# volume-prep

[![volume-prep](https://github.com/ewanhmack05/Diss-Project/actions/workflows/volume-prep.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/volume-prep.yml)

Turns a set of serial sections - slices cut one after another from the same
tissue, each scanned flat - into something the viewer can stack into a
volume. Runs offline, once per dataset. The plan it's part of, and why, is
[docs/zstack.md](../docs/zstack.md).

```
raw .vsi files  --convert_sections.py-->  one pyramidal .tif per section + manifest.json
                --register_sections.py--> every section lined up on one canvas + registration.json
```

Both scripts are resumable or cheap to rerun, check their own output, and
print progress with the time left.

## Setup

Two tools to download and unzip anywhere - neither needs installing:

- [Bio-Formats bftools](https://downloads.openmicroscopy.org/bio-formats/7.3.1/artifacts/bftools.zip)
  7.3.1 (needs Java 8 or later) - reads the VSI
- [libvips](https://github.com/libvips/build-win64-mxe/releases) 8.18 or
  later - builds pyramids and applies the registration

`convert_sections.py` is standard library only. `register_sections.py` needs
Python 3.10+ and:

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r volume-prep/requirements.txt
```

Keep the raw and in-between data outside the repo - the paths below assume
a `zstack-data` folder next to it. Only the end result goes in: the
registered `.tif` files and `registration.json`, in `tiler/data/<id>/`, where
the tiler finds them as a slide called `<id>` (see the
[tiler README](../tiler/README.md#volumes)). The `.tif` files go through Git
LFS.

## 1. Converting

```bash
python volume-prep/convert_sections.py \
    --raw ../zstack-data/liver/raw --out ../zstack-data/liver/converted \
    --bftools ../zstack-data/tools/bftools --vips ../zstack-data/tools/vips-dev-8.18/bin
```

For each section it:

1. Reads the `.vsi`'s images with `showinf` and picks the full scan by name
   (`--series-name`, `20x_BF_01` by default). A VSI also holds the label, an
   overview and a macro image, so the number isn't safe. It stops if the scan
   has no pixel size, or more than one focal plane.
2. Pulls that image out with `bfconvert` as a flat tiled TIFF. A VSI can say
   it's bigger than what was scanned - section 8 of the liver set says 37531
   rows, but every level of its own pyramid stops at 35840, and Bio-Formats
   fills the gap with black. The script works out the scanned size from the
   pyramid and crops to it. The manifest keeps both sizes.
3. Builds 256 px JPEG tiles and the pyramid with `vips tiffsave`, which
   OpenSlide reads as a generic tiled TIFF.
4. Checks the result with `vipsheader`: same size as the source, and pixel
   size within 0.01%. Only then is it renamed into place and added to
   `manifest.json`.

Sections already in the manifest with their file the same size are skipped,
so a run that's stopped carries on where it left off. `--force` does them all
again, `--only 0 3` just those.

On the 15 liver sections: about 55 s a section, 13-14 minutes in all, 2.9 GB
in and 1.7 GB out.

**TIFFs.** A folder of `.tif`, `.tiff` or `.svs` sections (and no `.vsi`)
goes straight through libvips instead - no Bio-Formats, so `--bftools` isn't
needed. Its pixel size comes from the TIFF, and is stamped into the pyramid
so OpenSlide reports it. A TIFF with no resolution reads as 1 pixel per mm,
which the script refuses rather than carry into every measurement; give it
with `--mpp`:

```bash
.venv/Scripts/python volume-prep/convert_sections.py     --raw path/to/tiffs --out path/to/converted     --vips ../zstack-data/tools/vips-dev-8.18/bin --mpp 0.46
```

## 2. Registering

```bash
.venv/Scripts/python volume-prep/register_sections.py \
    --sections ../zstack-data/liver/converted --out ../zstack-data/liver/registered \
    --vips ../zstack-data/tools/vips-dev-8.18/bin --write
```

Then move the `.tif` files and `registration.json` into `tiler/data/liver/`
(the previews can stay where they are).

`--clahe` evens out the stain before features are found (CLAHE, then a
light blur), for a set where some sections are much paler than others.

`--section-microns 5` saves how thick the sections were cut in
`registration.json`; the tiler passes it on, and the 3D view draws the block's
depth from it instead of assuming 4 um.

For a big set it keeps memory flat: features for three sections at a time,
Dice checked neighbour by neighbour, and previews of at most 60 sections,
600 px wide.

Without `--write` it works out the alignment, saves `registration.json` and
two previews (`preview_before.gif`, `preview_after.gif`) in about 12 s, and
writes no full-size images.

How it works, all on small copies - a power-of-two downsample that brings the
biggest section to about 2000 px (1/16 on the liver, about 4.4 um a pixel;
`--downsample` to choose it):

1. **Tissue mask** - stain is coloured and glass is grey, so HSV saturation
   above 25 is tissue.
2. **Features** - RootSIFT on the tissue, matched both ways round with a
   ratio test of 0.8.
3. **Neighbour to neighbour** - RANSAC picks the matches that agree, then a
   rigid transform (turn and shift, no scale) is fitted to them. A link needs
   30 agreeing matches. Neighbouring liver sections give 48-165, sections far
   apart 3-17.
4. **Gaps** - below 30, the cuts either side share no structure, so only the
   outline of the tissue is lined up: centroids together, every turn 5
   degrees apart (and the main axis both ways round), the one that overlaps
   best, then ECC on the blurred masks. The link is saved as a gap.
5. **Guided** (`--guided`) - before giving up on a link, try the features
   again near where the outline puts them: a looser one-way ratio test of
   0.9, and only matches that land within 300 um of the outline's guess.
   5 agreeing matches makes it a guided link instead of a gap. Off by
   default, because a gap means cuts are missing, and on the EPFL liver it
   would paper over the real one with 6 matches.
6. **Chain** - every section is chained to the middle one, and a canvas big
   enough for all of them is worked out.
7. **Write** (`--write`) - libvips turns each full-size section onto the
   canvas and saves a tiled pyramid straight out, no temporary file. Then the
   written sections are read back small and their overlap measured again; it
   has to match what was predicted to within 0.02 Dice, or the run fails.

### Why these choices

Each was measured on the liver set before it went in:

| Choice | Instead of | Why |
| --- | --- | --- |
| Own script on OpenCV | VALIS | VALIS is the standard tool, but no change in 17 months, 116 open issues, and it pulls in torch, numpy<2 and Java. Same method, a few hundred lines we can test and explain |
| 1/16 scale | 1/8 | 1/8 gave about half as many agreeing matches |
| Rigid | Similarity (with scale) | Scale drifted 1.5%, which is 80 um across a section. Rigid cut the worst skip-one error from 114 to 57 um. Sections from one block don't change scale |
| No ECC refinement | ECC on the image after features | Moved the result 30-80 um without making overlap better. Not kept without a reason |
| Every turn for the outline | Main axis only | A near-round section with a tear moves its main axis; on the Kartasalo liver the sweep cut the mean landmark error from 253 to 190 um |
| Gap links on outline only | Forcing a feature fit | Across the gap, features give 4 agreeing matches - a guess. Outline alignment is honest about being coarse: on links where features work, it lands 27-271 um from them |

### What it measures

Saved in `registration.json` and printed as it goes:

- **Inliers** and **median residual** for each feature link - how well the
  matches it used agree. In-sample, so it flatters.
- **Skip-one error** - i to i+2 fitted directly, against i to i+1 to i+2
  chained, as the mean distance over i's tissue. The two estimates share no
  fit, so it's an honest error figure without landmarks. It includes both
  estimates' errors, so it's an upper bound of sorts.
- **Dice** of neighbouring tissue masks, before (sections as they come) and
  after. A secondary number only - it rewards lining up outlines, not the
  inside.

### The liver set

| What | Result |
| --- | --- |
| Links | 13 by features, 1 gap (09 to 10) |
| Median residual | 7.4 um (5.5-12.2 per link) |
| Skip-one error | median 38.1 um, worst 56.5 um, over 11 checks |
| Neighbour overlap (Dice) | 0.787 before, 0.906 after |
| Turn between neighbours | -15.8 to +8.3 degrees |
| Canvas | 40288 x 45104 px, 0.27366 um a pixel |
| Time | 12 s to register, about 70 s to write all 15 (4.5 s each) |
| Written | 1.9 GB, 15 tiled pyramids, 9 levels each |
| Written, read back small | overlap within 0.002 Dice of predicted |
| Written, full size | 512 px patches against the originals through the inverse transform: 2.7-3.6 grey levels apart (JPEG and resampling), against 14-21 with a deliberate 3 px shift |

**The gap.** Sections 0-9 and 10-14 are two runs of consecutive cuts with
nothing linking them. Every section's best match is its neighbour in file
order, so the order within each run is right, but every pair across the two
runs sits at the noise floor - 9 agreeing matches at most. It isn't focus or
blur: blurring every section to the same sharpness first didn't help. The
cuts between 9 and 10 just aren't there. The block lines up by outline across
it, to a few hundred microns.

**Rerun since.** With the outline sweep in, the liver comes out the same: the
same links and inliers, the same canvas and Dice, and every transform within
1 full-size pixel (0.27 um) of the committed one.

**What's left.** The 38 um skip-one error is mostly tissue that stretched
differently on each slide, which a rigid transform can't take out. A
non-rigid step on top would - that's next if the 3D view needs it.

### A harder set: Kartasalo's liver

47 consecutive H&E sections of a mouse liver, 5 um apart, 0.46 um a pixel,
from Kartasalo et al., "Comparative analysis of tissue reconstruction algorithms
for 3D histology", Bioinformatics 2018 (5 um sections, said in its methods)
([Fairdata](https://etsin.fairdata.fi/dataset/c76335fa-cdcf-4ddc-ab1c-1882bad82861)).
Its point is that it comes with landmarks: four holes made with a laser through the block
before cutting, marked on every section by two people. So it measures the
registration against something real, not against itself.

Liver this uniform is hard for features: one patch of hepatocytes looks like
the next, so the both-ways ratio test throws most matches out, and the plain
run made every one of the 46 links a gap. What it took, measured on the
landmarks one change at a time (median across the 46 neighbour pairs):

| Run | Median | Mean |
| --- | --- | --- |
| Sections as they come | 653 um | |
| Outline only | 68 um | 274 um |
| Features, at 1/32 with CLAHE | 47 um | |
| Guided, 300 um, ratio 0.9 | 40.8 um | 253 um |
| Guided, with the outline sweep | 40.8 um | 190 um |

```bash
.venv/Scripts/python volume-prep/register_sections.py     --sections path/to/converted/liver --out path/to/registered/liver     --vips ../zstack-data/tools/vips-dev-8.18/bin     --downsample 32 --clahe --guided --section-microns 5 --write
```

Gives 4 feature links, 37 guided and 5 gaps. Through the whole volume -
every section onto the reference, each hole compared across all the
sections it shows on:

| | Before | After |
| --- | --- | --- |
| Observer 1, median | 586 um | 43 um |
| Observer 2, median | 586 um | 46 um |
| Observer 1, 90th percentile | 1495 um | 276 um |
| Between the two observers | | 7 um median |

**The floor.** Five pairs (4-5, 5-6, 11-12, 12-13, 13-14) can't be lined up
rigidly closer than 290-440 um however it's done: fitting the best rigid
transform straight to their own landmarks leaves that much. The tissue tore
or folded between those cuts. That's where the mean and the 90th percentile
come from, and only a non-rigid step would help.

### And its prostate

260 sections, with nuclei cut in half by the blade marked on each pair of
neighbours instead of holes - so it's scored pair by pair (`--kind pairs`),
and the two observers marked different nuclei, so there's no gap between
them to report. Same flags as the liver; 1/32 with CLAHE beat the default
1/8 on both observers (42 against 44 um, 29 against 33 um median).

| | Before | After |
| --- | --- | --- |
| Links | | 208 features, 51 guided, no gaps |
| Observer 1, median | 301 um | 42 um |
| Observer 2, median | 263 um | 29 um |
| Observer 1, 90th percentile | 1156 um | 134 um |
| Written | | 260 pyramids, 8.5 GB, about 13 minutes |

**The read-back check failed it, by 0.001.** Written sections came back
0.007 Dice below prediction on the median pair and 0.021 at worst, over the
0.02 allowed. Measured section by section, they're in the right place - the
worst seven land within 0.4 of a working pixel (6 um) of where registration
put them - but their tissue masks are 4-5% smaller. Prostate tissue is thin
and pale at the edges, and JPEG's colour subsampling takes enough saturation
out of those edges to drop them below the tissue threshold. The liver, solid
and darker, comes back within 0.001. So the check is right to be strict and
was left as it is; it's a mask-size effect, not a placement one.

### Scoring against landmarks

```bash
.venv/Scripts/python volume-prep/landmark_error.py     --registration path/to/registered/liver/registration.json --kind through     --landmarks observer1.txt observer2.txt
```

`--kind through` is for points that go through the block (the liver's
holes); `--kind pairs` for points marked on a section and again on the next
(the prostate's). Prints before and after for each observer, and how far
apart the observers are, in um. `--json` for a file.

## Tests

```bash
python -m unittest discover -s volume-prep
```

Under a second. No slides needed - the registration tests make their own
textured images, move them by known amounts, and check the transform comes
back to under a pixel. Covers the geometry (scaling transforms to full size,
chaining, the canvas), the rigid fit (exact, never scales or mirrors),
features on related and unrelated images, the outline fallback (and a
torn, turned section only the sweep gets), guided matching from a rough
start, with and without `--guided`, CLAHE, the exact
arguments libvips gets, and the conversion script's reading of Bio-Formats
and libvips output, which sections it redoes, and its crop for sections that
claim more than was scanned.

CI ([volume-prep.yml](../.github/workflows/volume-prep.yml)) runs ruff and
the tests.
