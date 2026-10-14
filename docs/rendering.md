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
- Measure with `scripts/map_bench.js` - results below
- Still not compared against canvas - a `?renderer=canvas` switch would give
  the GPU-vs-canvas numbers

## Where the map breaks - measured 2026-10-13

Load raised step by step with `seed_stress.py`, then `map_bench.js` run on
each step: circle-drag pans and wheel zooms driven by synthetic mouse events,
timing every frame. Dev server, slide 003, 1600x900 at device pixel ratio 1,
Chromium 152, AMD Radeon RX 7800 XT (D3D11). That's a high-end desktop GPU,
so treat these as a ceiling - a laptop will hit each limit sooner.

"Freeze" is main-thread long tasks (over 50 ms each) after the data arrives,
so the API's own time isn't counted. "Settle" is the redraw when the view
stops moving, which is when the WebGL layers rebuild their buffers - it's
the hitch at the end of every pan and every zoom step.

### Annotations

The seeded mix averages 36 points a shape (freehand traces are 120,
circles 51), so 25k annotations is about 0.9M points.

| Annotations | Pan at fitted view | Worst frame | Freeze on opening | Settle |
|---|---|---|---|---|
| 2,000 | 60 fps | 17 ms | none | - |
| 10,000 | 55 fps | 83 ms | 103 ms | - |
| 25,000 | 20 fps first run, 35 fps after | 233 ms | 237 ms | 64 ms |
| 50,000 | 8 fps first run, 11-14 fps after | 617 ms | 766 ms | 174 ms |

- **Smooth up to ~10k, visibly laggy at 25k, unusable at 50k.** At 50k the
  map can't hold 60 fps sitting still.
- **It's the WebGL annotations layer.** At 25k, with layers switched off one
  at a time (warmed up): tiles only 60 fps, arrowheads only 60 fps, WebGL
  annotations only 35 fps, both 35 fps. The canvas arrowhead layer costs
  nothing worth measuring.
- **The cost while dragging is on the GPU, not in JavaScript.** OpenLayers'
  render takes under 0.5 ms of main-thread time per frame during a drag at
  25k, yet frames take ~30 ms. Once the view settles, the buffer rebuild is
  main-thread work and grows with the count - that's the stutter at the end
  of each gesture.
- The first run after the data loads is slower than later ones - compare
  warm runs.

### Cell-count dots

One saved count viewed at a time, as the viewer does.

| Dots | Pan | Worst frame | Freeze on View | Settle |
|---|---|---|---|---|
| 10,000 | 60 fps | 17 ms | 479 ms | 2 ms |
| 100,000 | 60 fps | 18 ms | 728 ms | 16 ms |
| 250,000 | 57-60 fps | 50 ms | 1.3 s | 40 ms |
| 450,000 | 55-59 fps | 67 ms | 2.0 s | 70 ms |
| 500,000 | couldn't be saved at the time - over annotation-store's 30 MB request limit. Since raised to 80 MiB, a million dots | | | |

- **Points are cheap to draw.** Panning holds ~60 fps all the way to the
  largest count the API will take. What breaks is the freeze when View is
  clicked: the dots JSON is parsed and every dot made into a Feature on the
  main thread in one go, and nothing responds until it's done.
- **About 225 ms of each freeze has nothing to do with the count being
  viewed.** `SavedCountList.tsx` parses every saved count's dots on every
  render, and clicking View re-renders the list. With the four counts above
  saved (810k dots in all), every click paid for all of them - which is why
  the 10k row's freeze is so high.

### What would move the limits

- Annotations: load by extent and zoom rather than everything at once, and
  simplify shapes at low zoom so the GPU has fewer points when the whole
  slide is in view. The Saved list already pages (50 at a time from
  annotation-store), but the map still loads every annotation.
- Dots: build viewed dots in chunks or a worker so View doesn't freeze the
  page. Done since: the Saved list pages, and gets each count's colour
  and placed-by summary rather than its dots - those load only for the
  count viewed on the map.
- One count can now hold a million dots (POST /cellcounts takes 80 MiB).
  Not yet checked: the realtime hub takes messages up to 1 MB (about 17k
  dots), and a new count goes out to the session with all its dots. What
  happens past that - the message dropped, or the sender's connection
  closed - needs trying with a live session.

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
