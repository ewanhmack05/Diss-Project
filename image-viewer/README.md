# Diss Project - Image Viewer

[![image-viewer](https://github.com/ewanhmack05/Diss-Project/actions/workflows/image-viewer.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/image-viewer.yml)

React + TypeScript + OpenLayers viewer for a dissertation on real-time
collaboration around whole-slide image annotation. Proof of concept.

Slides are loaded as tiled pyramids from `tiler`, and annotations, cell
counts and image adjustment presets are saved to `annotation-store`
(Postgres), grouped into a collection per slide. Everyone on the same slide
is kept in sync through `realtime-hub` - annotation and cell count changes
show up for others straight away, shapes show up while they're still being
drawn, an annotation's label and notes can be typed in by several people at
once, other people's viewports are drawn as coloured outlines (main map and
overview), and who's on the slide shows top-left. Everyone signs in with
Keycloak, apart from guests - someone opening an invite link without an
account can join view only under a name they type, which isn't saved
anywhere (see [docs/guests.md](../docs/guests.md)). Guest code is in
`src/components/guest/`.

## Tools

Tools are toggled from a toolbar. Each one opens a floating panel that can be
dragged anywhere over the slide ([dnd-kit](https://dndkit.com/)) or docked to
any edge of the screen - two panels on the same edge split it evenly.

- **Annotations** - **Free Form**, **Select** and **Saved** tabs
  - Six shape tools: line, freehand, polygon, arrow, rectangle, circle, plus
    line thickness, line style (solid/dashed) and a colour palette
  - Finishing a shape opens a label + colour form. While it's open, the shape
    can be dragged to reposition it before saving (an OL `Translate`
    interaction)
  - The arrowhead tracks the live sketch while drawing, not just once finished
  - Annotations can be drawn anywhere, including outside the slide's border
  - Other people's shapes show while they draw them, and while they sit
    waiting to be named, tagged with their name in their presence colour
  - **Saved** lists the slide's annotations; opening one shows an edit form
    for its label, notes and colour, with Delete. Label and notes are shared
    live with anyone else who has the same annotation open - a
    [Yjs](https://github.com/yjs/yjs) CRDT, so two people typing in the same
    box both keep their text (`src/components/realtime/sharedFields.ts`).
    Everything saves as it changes; the form lists who else is editing
  - **Saved** shows 50 a page, newest first, with search done by
    annotation-store across all of them. The map still loads every
    annotation - only the list pages. The page size is `SAVED_PAGE_SIZE` in
    `src/components/saved/paging.ts`, shared with saved cell counts
  - **Saved**'s Filter narrows by who saved it, shape, colour, group, notes
    and date. While it's open the map only draws what the search and
    filters let through, and the tab's count is the list's
  - **Select** picks annotations on the map - drag a box or a lasso round
    them (fully inside only), Shift to add, click one to put it in or take
    it out. Then recolour them, put them in a group, or delete them (with
    Undo). **Groups** are named sets of annotations in the collection: show
    or hide one on the map, pick everything in one, or open its page to
    rename it, add notes, recolour it, merge it into another group or delete
    what's in it (`src/components/annotation/Select/`). Viewers get this tab
    as **Groups**, to show and hide only
- **Cell Count** - place dots to manually count cells (e.g. mitotic figures),
  with a running tally, dot size and colour options, and an optional region
  of interest box. Saved counts can be reopened and viewed on the slide.
  A saved count's label and notes are shared live and autosave, the same
  as annotations. Saved counts page and search the same way. A count's dots
  load only when it's viewed on the map - the list and the edit form use
  the colour and placed-by summary annotation-store sends instead
- **Gallery** - every slide the tiler has, as cards (size, zoom, real size,
  channels, collections, who's on it) or a filmstrip, and going to another
  without a reload. Docked it's always a filmstrip. Asks first if you'd lose
  something - see [docs/gallery.md](../docs/gallery.md)
- **Rotate** - rotate the slide view
- **Ruler** - measure a straight-line distance, shown in µm using the slide's
  microns-per-pixel, or in pixels
- **Image Adjustments** - brightness, contrast and gamma, applied in the
  WebGL tile layer's shader. Settings can be saved as named presets
- **RealTime** - **Session** and **Users** tabs
  - **Session** - start, host, join or leave a session. Rejoining one you're
    already in, or looking back at an ended one, is in **Collections**. The host gets an
    invite link and the same code on its own. Working alone, **Join with a
    code** takes either the code or the whole link and brings up the same
    invite card the link does, over the viewer rather than instead of it
  - **Users** - everyone with an account in Keycloak. Who's online now
    comes first, with what they're doing (hosting, in a session, working
    alone, which slide), then everyone offline. The host can **Invite**
    anyone online on the same slide - they get a popup, look at the
    invite, and join if they want. With no working invite, one is made
    (can edit, 24 hours). Kept up to date over realtime-hub's presence hub
    (`src/context/PresenceContext.tsx`, `src/components/users/presence.ts`).
    If Keycloak's list can't be had, it shows just who's online
- **Messages** - an inbox of one to one conversations with anyone with an account, and a chat for
  the session you're in, with a badge for how many are unread. The list folds down to a rail of
  initials. **Send** on a saved row, a group or a collection asks who to. **Attach** sends what's selected,
  the area you're looking at, or if you're hosting an invite. Cards show a small preview of the area. **View** takes the map to what was
  sent and draws it in its own colours, without saving anything. What's sent is a copy, and **Add to my collection** adds it as new rows, which the
  History tab says came from them. Needs [messaging](../messaging/README.md) running, at the `messagingUrl` prop. Without
  it the panel says so and everything else works. Not for guests.
- **Collections** - **Mine** and **Shared** tabs, each collection with how
  many annotations and cell counts it has and when one was last added
  - **Mine** - your own collection on the slide: rename it, **Let others
    view it** (anyone signed in can then look, read-only), export, import
  - **Shared** - the sessions you're in (rejoin or view, export, import if
    you can edit, leave, or delete one you host once it's ended), and other
    people's shared collections (view and export)
  - **Export** is GeoJSON in slide pixels from the top left (y down, like
    QuPath) - annotations as their shapes, cell counts as their dots, groups
    by name. **Import** reads that or a QuPath-style file, shows what it
    found and what it can't use, then saves it all in one go
    (`src/components/collections/`)
- **Fullscreen** - uses the Fullscreen API (`requestFullscreen`)
- **Depth** - moving through a volume's slices: serial sections lined up on
  one canvas (see [docs/zstack.md](../docs/zstack.md)). The button's only
  there when the slide has more than one slice, and the panel closes itself
  on a flat slide. A slider with a mark per slice (a gap - cuts that are
  missing - is a break in the row), Previous and Next, and back to the
  slice it opened on. A note says when the slice is next to a gap. Page Up
  and Page Down, or Shift and the wheel on the slide, do the same from the
  map - a trackpad swipe adds up to one slice rather than racing through.
  The slice showing is in a chip at the top of the map. In Present it's
  locked, like panning (`src/components/depth/`, `src/context/SliceContext.tsx`)
  - **3D** - the switch at the top of the Depth tab shows the volume as a
    block ([three.js](https://threejs.org/), loaded the first time it's
    opened). Drag to turn it, scroll to zoom, right-drag to move it. Cut it on
    X, Y, Z or a diagonal to see inside, draw fewer slices to make it
    thinner, lower the opacity, stretch the depth, turn the outline and grid
    off. A frame on the block shows the slice the 2D view's on, and a gap is
    an empty layer. Clicking the tissue opens that slice at that place in 2D.
    The block is built in the browser from one thumbnail per slice, 512 px
    wide (`thumbnail.jpg?slice=`), about 250 KB in all, and kept for the
    page's life. It's ray marched in a fragment shader
    (`src/components/depth/volumeShader.ts`), stored premultiplied so
    filtering next to glass or a gap doesn't darken it. Sections are much
    thinner than the slide is wide, so it's drawn thicker than it is, and
    assumes 4 um sections since the data doesn't say

## Rendering

Slide tiles, saved annotations, cell-count dots and ROI boxes are drawn with
WebGL layers. Canvas is only used for arrowheads, the shape currently being
drawn, and the ruler label. See `docs/rendering.md`.

On a volume the slice showing has its neighbours loaded too, as tile layers
at opacity 0 - a hidden layer wouldn't load anything - so a step to the next
slice only swaps opacities and fetches nothing for the slice now showing,
just the new neighbour. Each tile layer is a GL context and browsers allow
about 16, so `SliceLayers` (`src/components/open-layers/sliceLayers.ts`)
keeps at most three and gives a new slice the layer that dropped out,
with a new source, rather than making another. Moving through every slice,
or to another slide, makes no new GL contexts. A flat slide is one layer on
the slide's own tile route, the same URLs as before volumes.

## Running

```bash
npm install
npm run dev     # http://localhost:5173 - passes --host, so it's also reachable on your LAN IP
npm test        # vitest
npm run lint    # oxlint
```

Needs `tiler` and `annotation-store` running (see the root README).
`realtime-hub` is optional - without it the viewer works on its own, keeps
retrying in the background and shows "Offline" top-left.

## Pointing it at a slide

`src/index.tsx` sets which slide it starts on (`source`, currently `003`) and
which tools appear in the toolbar. `?slide=001` in the address opens another,
and the Gallery moves between them. Every backend goes through the page's own
server - `/tiler`, `/store`, `/hub`, `/messaging` and `/auth`, proxied by
`vite.config.ts` to ports 5095, 5252, 5180, 5260 and 8080 - so it works the
same from `localhost`, the LAN or the VPN with only port 5173 reachable.

Available slide IDs are listed in `tiler/README.md`.

`TILER_URL` points `/tiler` at another tiler, e.g. one started with a volume
on another port, without stopping the usual one:

```bash
TILER_URL=http://localhost:5096 npx vite --port 5175 --strictPort --mode http
```

`.claude/launch.json`'s `image-viewer-volume` does the same.

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
  index.tsx               entry point - slide id, backend paths, enabled tools
  App.tsx                 composes the providers + map, panels, toolbar
  newId.ts                v4 ids that still work over plain http (LAN, VPN)
  textFilter.ts           name rules and the profanity check (obscenity)
  palette.css             colour variables
  interfaces/             Annotation, AnnotationGroup, CellCount, CellCountGroup,
                            ImageAdjustment, ImageSource
  context/                one provider per concern:
                            stores - AnnotationStore, CellCountStore,
                              AnnotationGroup, CellCountGroup, Collection
                            drawing - Draw, CellCountDraw, AnnotationSelect
                            live - Realtime, Presence, Navigation, Viewports,
                              SharedCount, Comparison, Messaging
                            tools - Adjustments, Rotation, Ruler, Toolbar
                            app - Auth, ImageViewer, Event, Dialog, Toast
  components/
    MapNode.tsx           mounts the OpenLayers map, syncs features onto it
    open-layers/          map/view/layer setup, styles, GeoJSON (de)serialisation,
                            WebGL or canvas renderer, less detail zoomed out
    annotation/           FreeForm/ (tool picker, add form), Saved/ (list, edit),
                            Select/ (box and lasso picking, groups), bulk batches
    cell-count/           CellCounter/ (tool picker, during-count, add form),
                            Saved/ (list, edit, groups), comparison/ (everyone
                            counts the same ROI), shared/ (shared counts),
                            dot + view helpers
    saved/                what both Saved lists share - rows, paging, filters
    collections/          Collections panel, export and import, history/
    gallery/              Gallery panel, ?slide= in the address, the check
                            before moving
                            (History tab, one row's timeline, put back, rollback)
    realtime/             RealTime panel, the hub connection, shared label and
                            notes (Yjs), live sketches, sessions and invites,
                            edit policy
    presence/             who's on the slide, top-left
    users/                Users tab, join with a code
    messages/             Messages panel - conversations, Send, Attach, previews
    guest/                joining as a guest, and making an account to edit
    rotation/             panel + rotation maths
    ruler/                panel + distance maths
    adjustments/          panel + adjustment values
    colour-picker/        colour picker wrapper + popup positioning
    toolbar/              toolbar, draggable panel, docking (DockZone,
                            DockEdge, DockPreview, DockedCard), focus order
    dialog/               popups for things a toast would let you miss
    info/                 (i) buttons that explain something, one open at a time
    toast/                toast notifications
    auth/                 sign-in screen styles (the screen is in AuthContext)
  icons/                  toolbar SVGs, plus shapes/ and changes/
```

Tests (`*.test.ts`) sit next to the code they cover.

## Text filter

[`src/textFilter.ts`](src/textFilter.ts) checks names people type in, using
[obscenity](https://github.com/jo3-l/obscenity)'s English list. Picked over
allprofanity for its use (1.5M downloads a month against 5k) and for
catching leetspeak, lookalike letters and stretched words.

- `nameProblem(name)` - null if the name is fine, otherwise the message to
  show. 2 to 24 characters after trimming, letters and numbers in any
  script plus space `-` `_` `.` `'`, and nothing rude.
- `isClean(text)` / `censorText(text)` - for other text. `censorText` hides
  rude words in what the Messages panel shows (messages, people's names,
  session names). Labels and notes aren't checked yet. `isClean` also
  catches spaced-out letters ("f u c k"); `censorText` doesn't, since it can
  only hide the exact spans it found.

Real names the list blocks (Dickinson, Cumming, Fukuda, Penistone...) are
let through by `REAL_NAMES` in the same file.
[`textFilter.names.test.ts`](src/textFilter.names.test.ts) holds the names
that must get through, and the ones still blocked on purpose ("Dick",
"Tit"). A new false positive goes in that test first, then in `REAL_NAMES`.

This only runs in the viewer, so someone sending a name straight to the
backend skips it. The backend only checks for SQL and special characters.

## Not yet implemented

- Rotation and image adjustments are only shared in Present, not live
  otherwise
- Whether someone's viewport box is on or off isn't kept past a reload
- Labels, notes and group names aren't run through the text filter yet -
  only names people type, and what the Messages panel shows
- Exporting a collection to a GeoJSON file leaves cell count groups out.
  Sending one keeps them
- The backend paths are fixed on the page's own origin, so every service
  has to sit behind one proxy. Separate apps on Azure need them made
  configurable first

The full list is in [docs/todo.md](../docs/todo.md).
