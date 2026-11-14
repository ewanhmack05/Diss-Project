# tiler

[![tiler](https://github.com/ewanhmack05/Diss-Project/actions/workflows/tiler.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/tiler.yml)

ASP.NET Core (.NET 10) tile server for whole-slide images. Opens `.mrxs`
(MIRAX) files via [OpenSlideSharp](https://github.com/IOL0ol1/OpenSlideSharp)
(.NET bindings for [OpenSlide](https://openslide.org/)) and serves tiles in a
[Zoomify](https://en.wikipedia.org/wiki/Zoomify)-compatible URL scheme, which
the `image-viewer` frontend consumes via OpenLayers' `ol/source/Zoomify`
(see `image-viewer/src/components/open-layers/OpenLayers.ts`).

## Running

```bash
dotnet run --project tiler --urls http://localhost:5095
```

Localhost is enough even when sharing the viewer with other machines -
the viewer's dev server proxies to it (see the root README).

## Tests

```bash
dotnet test tiler/Tests -c Release
```

xUnit, in `Tests/`. The maths, the metadata tidying and the thumbnail
encoding are tested on their own. The rest goes through the real API
(`WebApplicationFactory`) against the four slides in `data/`. Those are in
Git LFS, and when they're missing or only LFS pointer files (as in CI,
which checks out without LFS) the slide tests skip rather than fail.
`git lfs pull` first to run them all.

Volumes are tested against slices the tests make themselves -
`Tests/TiledTiff.cs` writes small one-colour tiled TIFFs, so each slice is a
different colour and a test can tell which one it got. They need OpenSlide
installed but no slide files, so CI (which installs `libopenslide0`) runs
them. `Tests/ConcurrencyTests.cs` reads properties while other slides are
read and opened - see [OpenSlideSharp's strings](#openslidesharps-strings).

`-c Release` so it doesn't fight a tiler already running from `bin/Debug`
over the locked dll.

### On Linux (Docker)

The same tiler as a Linux container, with slide 003 built in - what gets
deployed to Azure (see `docs/azure.md`). From the repo root:

```bash
docker build -t diss-tiler tiler
docker run --rm -p 5095:8080 diss-tiler
```

The image is about 3.1 GB, nearly all of it the slide. The first build
takes a few minutes sending the slide to Docker; after that a code change
only rebuilds the small app layer.

### Windows vs Linux

OpenSlide is a native library, so it comes from a different place on each:

- **Windows** - `OpenSlideSharp.runtime.win` bundles the DLLs. It's only
  referenced when building on Windows (see `Tiler.csproj`).
- **Linux** - the distro's package, `libopenslide0` (OpenSlide 3.4) on the
  Ubuntu 24.04 .NET image. OpenSlideSharp asks for the Windows DLL's name,
  `libopenslide-0`, which Linux doesn't have, so `Slides/OpenSlideNative.cs`
  points it at `libopenslide.so.0` instead (or `.so.1`, OpenSlide 4, if
  that's what's installed).

SkiaSharp needs its own Linux native library too -
`SkiaSharp.NativeAssets.Linux.NoDependencies`. Tiles come out byte for
byte the same on both.

Both are OpenSlide 3.4. It doesn't work out microns per pixel for a
generic TIFF (4.0 does), so `SlideMetadata.MicronsPerPixel` falls back to
the TIFF's own `XResolution` and `ResolutionUnit` - without it a volume
would have no pixel size, and the ruler would be wrong on it.

### Memory

Each OpenSlide handle keeps its own cache of decoded tiles, in native memory -
about 32 MB once it's warm. The tiler keeps up to 8 handles a slice so a pan
reads in parallel, and it never used to close them, so memory only went up:
from 128 MB to 788 MB over 900 tiles across the liver volume and slide 003,
and about 3 GB after a real session. It wasn't .NET's heap - the same test
with the workstation garbage collector gave 771 MB.

So handles are now on a budget (`HandleBudget` in
`Slides/SlideHandlePool.cs`), across every slide and slice:

- At most `Slides:MaxOpenHandles` open at once (default 24). Opening one more
  first closes whichever handle has been idle longest, wherever it is. If
  every handle is busy, the request waits for one to come back.
- Handles idle for `Slides:IdleHandleMinutes` (default 5) are closed, checked
  once a minute.

The same 900 tiles now peak at 624 MB, and a second round on the same tiler
stays there (612-621 MB) instead of climbing. A slice you've stopped looking
at no longer holds memory - which matters for a volume with hundreds of
slices. On a 260-slice volume (Kartasalo's prostate), loading every slice
for the 3D view and then stepping through 60 slices in 2D peaked at 265 MB.

```bash
Slides__MaxOpenHandles=16 dotnet run --project tiler --urls http://localhost:5095
```

### OpenSlideSharp's strings

OpenSlideSharp passes strings to and from OpenSlide through its
`CustomStringMarshaler`, which keeps the native copy of a string in a
field. .NET makes one marshaler and shares it between every call on every
thread, so two string calls at the same time free each other's memory.
Reading slide properties while anything else used OpenSlide crashed the
process - the first `/slides` while someone was panning would have done it,
and the test host died every run once the volume tests ran alongside the
slide tests. 1.1.2 is the latest OpenSlideSharp and the marshaler hasn't
changed since 2021.

So `Slides/OpenSlideApi.cs` opens slides and reads their properties
itself, with .NET's own UTF-8 marshalling (a fresh copy per call), and
OpenSlideSharp is only used for reading pixels. Nothing in the tiler hands
it a string any more. Don't call `OpenSlideImage.Open`, `TryGetProperty`,
`GetPropertyNames` or the indexer - use `SlideHandlePool.Open` and
`OpenSlideApi.Properties`.

## Data

The tiler has no database. It only reads slide files, and nothing it does is
saved. What it holds is in memory, and it works it out again after a restart:

| What               | Where                                                   | What it's for                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Slide ids to paths | `SlideCatalog`, read at startup                         | Which slides there are, and each one's files - one for a flat slide, one per slice for a volume. The id is what annotation-store keeps as `SlideId` - not a foreign key, so removing a file leaves collections pointing at nothing |
| `SlideInfo`        | `SlideCatalog`, read the first time a slide's asked for | Width, height, tile size, objective power, microns per pixel and the gallery's metadata (name, kind, channels and so on). Every tile request needs the size                                           |
| Open slides        | `SlideHandlePool`, one pool per slice                   | A few OpenSlide handles, each used by one thread at a time. One handle crashes if it's read from several threads at once, and locking it would make every tile in a pan wait in line. All of them share one budget - see [Memory](#memory) |

Slides live in `tiler/data/` as `<id>.mrxs` + a same-named companion folder
(both required - that's how MIRAX stores a slide). `SlideCatalog` discovers
every `.mrxs` under `data/` at startup and uses the filename (minus
extension) as the slide's id, so dropping in another slide is enough to
make it available - no config needed.

`Slides:DataPath` (or the `Slides__DataPath` environment variable) points it
at a different folder - relative to the app's folder unless it's absolute.

### Volumes

A volume is a stack of serial sections - slices cut one after another from
the same tissue - lined up so the same pixel is the same place on every
slice. It's one slide with several slices. The folder for one is what
`volume-prep/register_sections.py --write` makes (see
[volume-prep](../volume-prep/README.md)): a `registration.json` and a tiled
TIFF per slice, all the same size.

Any folder in `data/` with a `registration.json` in it is a volume, with
the folder's name as its id - so `data/liver/` is the slide `liver`, found
at startup like the `.mrxs` files, no config needed. The MIRAX slides' own
folders (`data/000/` and so on) have no `registration.json`, so they're
left alone. The slices are `.tif`, which `.gitattributes` puts in Git LFS
like the slides.

Checked out without LFS (as CI does) a volume's `.tif` files are small text
pointers, not pictures. The tiler leaves that volume out and logs a warning
saying to `git lfs pull`, rather than not starting - the same as the slide
tests skip.

A volume kept somewhere else can be given in config as an id and a folder,
relative to the app's folder unless it's absolute:

```bash
Slides__Volumes__kidney=../../zstack-data/kidney/registered dotnet run --project tiler --urls http://localhost:5095
```

A volume that's there but wrong stops the tiler starting, with a message
that says why: a folder that isn't there, no `registration.json`, a slice
file missing, slices of different sizes, or the same id as a `.mrxs` or
another volume.

From `registration.json` the tiler takes the slice order, the default slice
(the one the rest were lined up to) and where the gaps are - a link
registration could only line up by the tissue's outline, because the cuts
between are missing. A "guided" link isn't a gap.

Each section's `order` is its own number, so a set can start at 1 or skip a
section that was left out; slices are numbered 0 up in that order, and the
links and default slice count the same way. Two sections with the same
number stop it starting.

Included samples, all from [OpenSlide's public test data](https://openslide.org/):

| id    | source file             | notes                                          |
| ----- | ----------------------- | ---------------------------------------------- |
| `000` | CMU-1 (1/16 downsample) | H&E brightfield, 6-level pyramid, 7436x15494px |
| `001` | Mirax2-Fluorescence-1   | 3-channel fluorescence                         |
| `002` | Mirax2-Fluorescence-2   | 3-channel fluorescence                         |
| `003` | HPS stain               | Brightfield, 101832x219976px, ~2.9 GB          |

And one volume, `liver` - 15 serial H&E sections of mouse liver and small
intestine from [EPFL BIOP on Zenodo](https://zenodo.org/records/12072433)
(CC BY 4.0), converted and registered by `volume-prep` onto one
40288x45104px canvas, 1.9 GB. Sections 0-9 and 10-14 are two separate runs,
so slice 10 has a gap before it. See [docs/zstack.md](../docs/zstack.md).

`image-viewer/src/index.tsx`'s `DEFAULT_SLIDE_ID` picks which one loads by
default; `?slide=<id>` overrides it per-request.

## API

- `GET /slides` - every discovered slide, each as below
- `GET /slides/{id}` - metadata for one slide:

  | Field              | What it is                                                                                                            |
  | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
  | `id`, `fileName`   | The file name without `.mrxs`, and with it. For a volume, its config id and its folder's name                         |
  | `width`, `height`  | Level 0 size in pixels                                                                                                |
  | `tileSize`         | Always 256                                                                                                            |
  | `objectivePower`   | Objective magnification, or null                                                                                      |
  | `mppX`, `mppY`     | Microns per level 0 pixel, or null. OpenSlide's, or worked out from the TIFF's resolution                             |
  | `name`             | The scanner's slide name (`SLIDE_NAME`), trimmed. The id when it's missing, blank or `None`                           |
  | `kind`             | `"brightfield"`, `"fluorescence"` or null, from `SLIDE_TYPE`                                                          |
  | `channels`         | Fluorescence filter names in file order, each once, `Default` left out. `[]` for brightfield                          |
  | `levels`           | How many zoom tiers the tile ladder has (`ZoomifyTiling.ComputeTiers(...).Count`)                                     |
  | `objectiveName`    | `OBJECTIVE_NAME`, null when missing or `Default objective`                                                            |
  | `camera`           | `CAMERA_TYPE`, or null                                                                                                |
  | `backgroundColour` | `#rrggbb`, lower case - the colour of the parts that weren't scanned, from the file's `IMAGE_FILL_COLOR_BGR`. Or null |
  | `fileBytes`        | The `.mrxs` plus everything in its folder. For a volume, every slice's file                                           |
  | `slices`           | `[{index, gapBefore}]`, one for a flat slide. `gapBefore` is true when the cuts before it are missing                |
  | `defaultSlice`     | The slice tiles come from when none is asked for. `0` for a flat slide                                                |
  | `sectionMicrons`   | How thick each slice was cut, from `registration.json`, or null. The 3D view assumes 4 um when it's null              |

  The MIRAX values come from OpenSlide, which hands every line of the
  slide's `Slidedat.ini` back as a property named `mirax.SECTION.KEY`.
  `Slides/SlideMetadata.cs` tidies them. The scan date, `SLIDE_ID`,
  `PROJECT_NAME` and the label and macro images are never sent, since they
  can identify a real slide - see `docs/ethics.md`.

- `GET /slides/{id}/thumbnail.jpg?width=N` - a JPEG of the whole slide (its default slice, or `&slice=S`), `N`
  pixels wide (256 if left out, clamped to 32-1024) and as tall as the
  slide's shape makes it. Read from the smallest pyramid level that's at
  least that wide, or up to 5% narrower and scaled up (`NarrowerBy` in
  `Slides/Thumbnail.cs`), so even slide 003 takes about 100-250 ms. The 5%
  matters for volumes: 1024 of Kartasalo's 32384 px liver would otherwise
  read the 2024 px level, not the 1012 one, for the last 1% - four times
  the pixels for every slice, and its 47 thumbnails took the tiler to 842
  MB. With it, 311 MB. Laid on the
  slide's background colour (white if it has none), so unscanned corners
  don't come out black. `Cache-Control: public, max-age=86400`.
- `GET /slides/{id}/thumbnail.jpg?width=N&square=true` - `N` x `N`, the
  square in the very middle of the slide, as big as its shorter side. A
  1:2 portrait slide shows its middle half. Only that square is read, from
  the smallest level with at least `N` pixels across it. Same clamp,
  background and cache header. `square=false` or left out is the whole
  slide as above.
- `GET /slides/{id}/TileGroup{n}/{z}-{x}-{y}.jpg` - a tile. `{n}` (Zoomify's
  static-file bucketing number) is accepted but ignored since we serve
  dynamically; `z` is the zoom tier (0 = single tile covering the whole
  slide, increasing tiers double resolution up to native), `x`/`y` are the
  tile's column/row within that tier. From the default slice, so a viewer
  that doesn't know about slices still works.
- `GET /slides/{id}/slice/{slice}/TileGroup{n}/{z}-{x}-{y}.jpg` - the same
  tile from one slice. Every slice is on the same grid, so the same
  `z-x-y` is the same place on each. 404 for a slice that isn't there; a flat
  slide only has slice 0.

  On the liver volume (15 slices of 40288 x 45104) a full-resolution tile
  takes 6-46 ms, the same as a flat slide's.

## How tiling works

`Slides/ZoomifyTiling.cs` reimplements OpenLayers' `ol/source/Zoomify`
default tier calculation (`ComputeTiers`: halve width/height repeatedly until
both fit in one 256px tile, then reverse so tier 0 is the coarsest) so the
tier/tile numbering the frontend computes lines up exactly with what this
server answers. For a requested tile, `Resolve` picks the best native
OpenSlide pyramid level for that tier's downsample factor
(`GetBestLevelForDownsample`), reads the corresponding region, and reports
both the size to read at that level and the target tile size - the two only
match when a tier happens to coincide with a native level, so `Program.cs`
resizes via SkiaSharp whenever they don't.

The frontend caps its own zoom range to the same ladder
(`computeResolutionLadder` in `OpenLayers.ts`) so you can't zoom in past
native resolution or out past "whole slide, one tile" - see that file's
comments for how it's derived per slide.

**Known simplification:** OpenSlide returns pre-multiplied BGRA; tiles are
encoded straight to JPEG (no alpha channel) without compositing onto a
background colour first, so fully-transparent regions (e.g. corners outside
a MIRAX slide's scanned area) render black instead of white. Thumbnails
don't have this - `Slides/Thumbnail.cs` lays them on the background colour
first - and tiles could do the same.
