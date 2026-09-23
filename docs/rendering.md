# Rendering and performance

WebGPU for OpenLayers?

- Taking into account we could have 2 or more users drawing for an unknown
  amount of time, the load on OpenLayers could expand, so delegating to the
  device's GPU for rendering would save browser power and deal with the load

## Where it's at

OpenLayers has no WebGPU renderer, but it does have WebGL layers, and those
are now in use:

| Layer | Renderer |
|---|---|
| Slide tiles | WebGL (`WebGLTileLayer`) - brightness/contrast/gamma run in its shader |
| Saved annotations | WebGL (`WebGLVectorLayer`) |
| Cell-count dots, live and viewed | WebGL |
| ROI boxes, live and viewed | WebGL |
| Arrowheads | canvas - WebGL can't draw a shape at a line's end |
| Shape being drawn / awaiting save | canvas - 1-2 features, needs style functions |
| Ruler | canvas - needs a text label |

- Test with lots of data: `python scripts/seed_stress.py` (see [scripts/README.md](../scripts/README.md))
- Not yet measured - a `?renderer=canvas` switch to compare frame times canvas vs GPU would give real numbers

## Panning delay - what it turned out to be

Not rendering. Measured causes, in order of impact:

1. **OpenTelemetry console exporter** - ~40 lines per tile request drawn to
   the terminal made each 16-tile pan ~30-60 ms slower. Now off unless
   `Telemetry__Console=true`.
2. **Per-slide lock in the tiler** - every tile for a slide read one at a
   time. Replaced with a pool of 8 OpenSlide handles per slide. (Removing
   the lock outright crashed - the bundled OpenSlide can't open handles on
   several threads at once, so opens are still serialised.)
3. **White gaps while tiles load** - `preload: Infinity` on the tile layer,
   so lower-res tiles fill in as a blurry preview.

Stats for all of this are on the Grafana dashboard (see
[dashboard/README.md](../dashboard/README.md)).
