# Diss Project - Image Viewer

React + TypeScript + OpenLayers viewer for a dissertation on real-time
collaboration around whole-slide image annotation. Proof of concept.

Slides are loaded as tiled pyramids from `tiler`, and annotations, cell
counts and image adjustment presets are saved to `annotation-store`
(Postgres), grouped into a collection per slide. Real-time sync between
users is not built yet - see the root README and `docs/`.

## Tools

Tools are toggled from a toolbar. Each one opens a floating panel that can be
dragged anywhere over the slide ([dnd-kit](https://dndkit.com/)) or docked to
any edge of the screen - two panels on the same edge split it evenly.

- **Annotations** - **Free Form** and **Saved** tabs
  - Six shape tools: line, freehand, polygon, arrow, rectangle, circle, plus
    line thickness, line style (solid/dashed) and a colour palette
  - Finishing a shape opens a label + colour form. While it's open, the shape
    can be dragged to reposition it before saving (an OL `Translate`
    interaction)
  - The arrowhead tracks the live sketch while drawing, not just once finished
  - Annotations can be drawn anywhere, including outside the slide's border
  - **Saved** lists the slide's annotations; opening one shows an edit form
    for its label, notes and colour, with Delete
- **Cell Count** - place dots to manually count cells (e.g. mitotic figures),
  with a running tally, dot size and colour options, and an optional region
  of interest box. Saved counts can be reopened and viewed on the slide
- **Rotate** - rotate the slide view
- **Ruler** - measure a straight-line distance, shown in µm using the slide's
  microns-per-pixel, or in pixels
- **Image Adjustments** - brightness, contrast and gamma, applied in the
  WebGL tile layer's shader. Settings can be saved as named presets
- **Fullscreen** - uses the Fullscreen API (`requestFullscreen`)

## Rendering

Slide tiles, saved annotations, cell-count dots and ROI boxes are drawn with
WebGL layers. Canvas is only used for arrowheads, the shape currently being
drawn, and the ruler label. See `docs/rendering.md`.

## Running

```bash
npm install
npm run dev     # http://localhost:5173 - passes --host, so it's also reachable on your LAN IP
npm test        # vitest
npm run lint    # oxlint
```

Needs `tiler` and `annotation-store` running (see the root README).

## Pointing it at a slide

`src/index.tsx` sets which slide opens (`source`, currently `003`) and which
tools appear in the toolbar. The `tiler` (port 5095) and `annotation-store`
(port 5252) URLs use whichever host the page was loaded from, so it works the
same from `localhost` or from another device on the network.

Available slide IDs are listed in `tiler/README.md`.

### Vendored colour picker

`react-colour-palette` (from [ewanhmack/ColorPicker](https://github.com/ewanhmack/ColorPicker))
is a private, unpublished package, so it's vendored as a prebuilt tarball at
`vendor/react-colour-palette-0.0.1.tgz` and installed as a `file:` dependency.

- `npm install` picks it up like any other dependency, no extra step needed.
  To update it: pull the latest ColorPicker source, `npm run build && npm pack`
  there, replace the tarball in `vendor/`, then `npm install` here again.

## Layout

```
src/
  index.tsx               entry point - slide id, service URLs, enabled tools
  App.tsx                 composes the providers + map, panels, toolbar
  interfaces/             Annotation, CellCount, ImageAdjustment, ImageSource
  context/                one provider per concern:
                            Annotation/CellCount stores, Collection,
                            Draw/CellCountDraw, Adjustments, Rotation, Ruler,
                            Toolbar, Toast, Event, ImageViewer
  components/
    MapNode.tsx           mounts the OpenLayers map, syncs features onto it
    open-layers/          map/view/layer setup, styles, GeoJSON (de)serialisation
    annotation/           FreeForm/ (tool picker, add form), Saved/ (list, edit)
    cell-count/           CellCounter/ (tool picker, during-count, add form),
                            Saved/ (list, edit), dot + view helpers
    rotation/             panel + rotation maths
    ruler/                panel + distance maths
    adjustments/          panel + adjustment values
    colour-picker/        colour picker wrapper + popup positioning
    toolbar/              toolbar, draggable panel, docking (DockZone,
                            DockEdge, DockPreview, DockedCard)
    toast/                toast notifications
  icons/                  toolbar SVGs
```

Tests (`*.test.ts`) sit next to the code they cover.

## Not yet implemented

- Real-time sync between users
- Sign-in - collections use a placeholder user id (`001`) until Keycloak is
  added (see `docs/auth.md`)