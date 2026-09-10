# Diss Project - Image Viewer

Standalone image viewer for a dissertation on real-time collaboration around
image annotation. Scoped down to a single static image with no tiling backend. This is a proof of concept, so it also pulls in [dnd-kit](https://dndkit.com/) for the draggable tool panel
will build on.

- A bottom-docked **toolbar** (matching `$toolbar-width`/button sizing from
  their `ImageViewer.scss`) toggles tools on and off - order is Fullscreen,
  then Annotations
- The **Annotations** tool opens a floating panel over the canvas, draggable
  anywhere via dnd-kit, with **Free Form** and **Saved** tabs
- **Free Form** offers all six shape tools (line, freehand, polygon, arrow,
  rectangle, circle) plus line thickness/style and a colour palette -
  finishing a shape opens a label + colour form before it's saved. The arrow
  tool's arrowhead tracks the live sketch while still drawing, not just once
  finished. While the naming form is open, the just-drawn shape can be
  dragged to reposition it before saving (an OL `Translate` interaction).
  Annotations can be drawn anywhere, including outside the image's border -
  the view has no extent constraint.
- The colour swatches' custom picker is [react-colour-palette](https://github.com/ewanhmack/ColorPicker),
  vendored as a tarball (see below) rather than the native `<input type="color">`
- **Saved** lists saved annotations; opening one shows an edit form with
- **Fullscreen** uses the real Fullscreen API (`requestFullscreen`), same as
  their toolbar's OpenLayers `FullScreen` control

Annotations live in memory only (`AnnotationStoreContext`) - there's no
backend annotation-store service or persistence across reloads yet.

### Vendored colour picker

`react-colour-palette` (from [ewanhmack/ColorPicker](https://github.com/ewanhmack/ColorPicker))
is a private, unpublished package, so it's vendored as a prebuilt tarball at
`vendor/react-colour-palette-0.0.1.tgz` and installed as a `file:` dependency

- `npm install` picks it up like any other dependency, no extra step needed.
  To update it: pull the latest ColorPicker source, `npm run build && npm pack`
  there, replace the tarball in `vendor/`, then `npm install` here again.

Not yet implemented: persisted annotation store, multi-image index, real-time sync.

## Running

```bash
npm install
npm run dev
```

## Pointing it at an image

`src/index.tsx` resolves the image path in this order:

1. A `?src=` query param, e.g. `http://localhost:5173/?src=/my-image.jpg`
2. The `DEFAULT_IMAGE_PATH` constant in `src/index.tsx` (currently `/sample.svg`)

Either way, the path must resolve to something the dev server can serve - drop
image files into `public/` and reference them by their `/`-rooted path. The
image is rendered via OpenLayers' `ImageStatic` source (a single image, not a
tiled pyramid) - pan/zoom work out of the box; swapping in a tiled source
later only touches `components/open-layers/OpenLayers.ts`.

## Layout

```
src/
  index.tsx                    entry point, resolves the image filepath
  App.tsx                      composes the providers + ViewerShell (map,
                                draggable panel, toolbar)
  interfaces/
    Annotation.ts               annotation record shape
  context/
    ImageViewerContext.tsx     imagePath
    ToolbarContext.tsx         activeTools[], toggleTool() - which tool
                                panels are currently open
    AnnotationStoreContext.tsx  saved annotations (in-memory CRUD)
    DrawContext.tsx             transient drawing state (active tool, colour,
                                 thickness, style, the just-drawn pending shape)
  components/
    MapNode.tsx                mounts the OpenLayers map, syncs annotations
                                onto it, wires the Draw interaction
    open-layers/
      OpenLayers.ts            OpenLayerMap(): builds the OL Map/View/layers
      Styles.ts                 stroke/fill/arrowhead style for annotations
      GeoJSON.ts                 feature <-> GeoJSON string (de)serialization
    annotation/
      Tools.ts                  shape configs (OL Draw options), colour palette
      FreeForm.tsx               tool picker <-> add-annotation form switcher
      FreeFormToolPicker.tsx     shape/thickness/style/colour controls
      AddAnnotationForm.tsx      label + colour form shown after drawing
      SavedAnnotationList.tsx    saved annotations list
      SavedAnnotationEdit.tsx    edit form - Delete instead of archive
      AnnotationsPanel.tsx       Free Form / Saved tab container
    toolbar/
      Toolbar.tsx               bottom-docked tool buttons (Annotations,
                                 Fullscreen)
      DraggablePanel.tsx        dnd-kit-powered floating panel frame
```
