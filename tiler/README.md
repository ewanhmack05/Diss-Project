# tiler

ASP.NET Core (.NET 10) tile server for whole-slide images. Opens `.mrxs`
(MIRAX) files via [OpenSlideSharp](https://github.com/IOL0ol1/OpenSlideSharp)
(.NET bindings for [OpenSlide](https://openslide.org/), native Windows
binaries bundled via `OpenSlideSharp.runtime.win`) and serves tiles in a
[Zoomify](https://en.wikipedia.org/wiki/Zoomify)-compatible URL scheme, which
the `image-viewer` frontend consumes via OpenLayers' `ol/source/Zoomify`
(see `image-viewer/src/components/open-layers/OpenLayers.ts`).

## Running

```bash
dotnet run --project tiler --urls http://localhost:5095
```

## Data

Slides live in `tiler/data/` as `<id>.mrxs` + a same-named companion folder
(both required - that's how MIRAX stores a slide). `SlideCatalog` discovers
every `.mrxs` under `data/` at startup and uses the filename (minus
extension) as the slide's id, so dropping in another slide is enough to
make it available - no config needed.

Included samples, all from [OpenSlide's public test data](https://openslide.org/):

| id    | source file               | notes                                    |
|-------|----------------------------|-------------------------------------------|
| `000` | CMU-1 (1/16 downsample)    | H&E brightfield, 6-level pyramid, 7436x15494px |
| `001` | Mirax2-Fluorescence-1      | 3-channel fluorescence                   |
| `002` | Mirax2-Fluorescence-2      | 3-channel fluorescence                   |

`image-viewer/src/index.tsx`'s `DEFAULT_SLIDE_ID` picks which one loads by
default; `?slide=<id>` overrides it per-request.

## API

- `GET /slides` - every discovered slide: `{ id, fileName, width, height, tileSize }`
- `GET /slides/{id}` - metadata for one slide
- `GET /slides/{id}/TileGroup{n}/{z}-{x}-{y}.jpg` - a tile. `{n}` (Zoomify's
  static-file bucketing number) is accepted but ignored since we serve
  dynamically; `z` is the zoom tier (0 = single tile covering the whole
  slide, increasing tiers double resolution up to native), `x`/`y` are the
  tile's column/row within that tier.

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
a MIRAX slide's scanned area) render black instead of white. Fine for now;
revisit if it looks wrong once annotations/collaboration are layered on top.
