# Gallery

The viewer used to show one slide, picked in `index.tsx`. The Gallery tool
lists every slide the tiler has and moves between them without reloading
the page.

## What it looks like

A toolbar button, second after fullscreen, opens a panel like any other.

| Where the panel is      | What it shows                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Floating, cards         | A card per slide - picture, name, size in pixels, max zoom and µm per pixel, real size, kind and channels, file size, collections, live sessions, who's on it now |
| Floating, filmstrip     | Pictures only in a row, with the name in a bar under each. The button at the top switches between the two              |
| Docked left or right    | Always a filmstrip, running down the edge                                                                                |
| Docked top or bottom    | Always a filmstrip, running along the edge                                                                               |

Docked, the pictures are smaller and a fixed size (8em), and an edge with
only the gallery on it shrinks to fit them - 11em at the sides, 14em along
the top or bottom, against 20em and 21em for other panels
(`edgeSizeEm` in [dock.ts](../image-viewer/src/components/toolbar/dock.ts)).
Share the edge with another panel and it goes back to the usual size, since
that panel needs the room.

A filmstrip has the arrows on a ribbon floating over the bottom of it, with
"3 of 4" between them. Docked along the top or bottom it overlaps the
pictures rather than taking a row of its own, so the edge stays slim. The open slide has an outline, and a dot by a
name means someone's working on it now - a live session you're in, or
someone online with it open.

Each picture is a square from the middle of the slide, its shorter side
across - so a slide twice as tall as it's wide shows its middle half. The
tiler cuts it (`GET /slides/{id}/thumbnail.jpg?width=192&square=true`), so
it's read at the size it's shown. If the tiler can't make one, the viewer
falls back to the one tile that's the whole slide, cropped to the same
square.

Guests don't get it - they're on the one session their link is for.

## Where the numbers come from

| What                         | From                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name, kind, channels, levels | The tiler, from OpenSlide's `mirax.*` properties - see [tiler.md](breakdown/tiler.md). The name falls back to the id when the scanner left it as `None` |
| Size, max zoom, µm per pixel | The tiler, as before                                                                                                                                       |
| Real size                    | Worked out in the viewer - width x microns per pixel                                                                                                       |
| Collections                  | annotation-store's `GET /slides/summary` - collections you can open that have something in them                                                           |
| Live sessions                | The same - sessions you're in that haven't ended                                                                                                           |
| People here now              | The realtime hub's presence, which already said which slide everyone's on                                                                                  |

Empty collections aren't counted. Opening a slide makes everyone an empty
personal collection there (`POST /collections/ensure`), so counting those
would only say who'd looked. Which collections you can open is the rule
`GET /collections` already used, now in one place
(`CollectionAccess.VisibleTo`) - if every collection becomes public, that's
where it changes.

Max zoom is the objective the scanner reports, so slide 000 says x20 even
though it's a 1/16 copy. The µm per pixel next to it (3.72, against 0.23 to
0.32 for the others) is the honest figure.

## Moving to another slide

The map is built once, for the first slide. Moving swaps what's
slide-specific on it and nothing else
([OpenLayers.ts](../image-viewer/src/components/open-layers/OpenLayers.ts)'s
`showSlide`):

- the tile source on the main map and the overview
- a new view for each, since a view's zoom ladder is fixed when it's made
  and comes from the slide's size - it opens on the whole slide
- the zoom label, scale bar and overview are moved onto the new view

The layers, their WebGL contexts and every panel stay. Annotations and
counts redraw because the stores load the new slide's collection.
Rotation, adjustments and the ruler reset, as they did when a slide loaded.

Checked in the browser: the map object is the same one before and after,
and the page has the same number of canvases.

The address follows the slide (`?slide=001`), so back and forward move
between slides and a copied link opens the same one. The slide `index.tsx`
starts on keeps the plain address. A `?slide=` that can't be an id (`..`,
`/`, spaces) is ignored.

### What you'd lose

Every move goes through one check
([MoveGuard.tsx](../image-viewer/src/components/gallery/MoveGuard.tsx)) - the
gallery, the arrows, an invite, a message, the Users tab and back and
forward. With nothing to lose it just goes. Otherwise a popup says what
would go, and lets you stay:

- an annotation drawn but not saved
- a cell count running or not saved
- a comparison or shared count you're in - you leave it
- the live session you're in - you leave the room, but stay a member and
  can go back in from its slide

Escape means stay. Saying no to back or forward puts the address back.

### Links to other slides

Three places used to stop at "that's on another slide":

| Where                         | Now                                                                    |
| ----------------------------- | ---------------------------------------------------------------------- |
| An invite to another slide    | "Join session on slide 001" - joins, then moves there into the session |
| Something sent from another slide | "Open slide 001", then View works as usual                         |
| The Users tab                 | "Go there" next to anyone on another slide                             |

Joining a session on another slide remembers it under that slide's key, so
the move lands in it. Done the old way, the current slide's list wouldn't
have it, which read as being taken out.

## What's next - sessions across slides

For now a session is one slide, like a personal collection. The next step
is a session that moves between slides with its people: the host goes from
003 to 002, and everyone else is asked whether to go too.

That turns the data round. Today it's slides > collections - every
collection has one `SlideId`. A session spanning slides is collections >
slides.

**The rows already say which slide they're on.** Every annotation and cell
count carries its own `SlideId`, so they don't change.

**A join table, not an array.** `CollectionSlides` (collection, slide, who
added it, when) rather than a list of ids on the collection:

- "which collections are on this slide" stays an index lookup - it's the
  gallery's count
- adding a slide to a session is a row, so the history log can record it
  and it can be put back like anything else
- a personal collection keeps exactly one row, so `POST /collections/ensure`
  and its unique index don't change

**The session keeps a current slide** - for the invite preview, someone
joining late, and the realtime room to start everyone on.

**Reads need a slide.** `GET /annotations?collectionId=` would return every
slide's rows. It needs `&slideId=` (the column and its index are already
there), and the same for counts, groups and the Saved lists.

**The hub.** The room stays the session, so moving doesn't disconnect
anyone. It needs:

- a "moved slide" message - the host's move becomes everyone else's prompt
  ("Ewan moved to slide 002 - go too?"), and in Present it just moves them
- viewports, sketches and rulers only drawn for people on your slide
- comparison and shared counts tied to the slide they started on

**Version control.** Putting a whole collection back would reach across
slides, and the History tab needs a slide column. Snapshots are per
collection, so they'd hold every slide's rows.

**Size.** Large - a migration, a contract change in annotation-store and
the hub, and the viewer's move becoming two-way.

## Tests

- tiler: `SlideMetadataTests`, `ThumbnailTests`, `SlideApiTests` (names,
  kinds, channels, the thumbnail's size, background and cache header, the
  square crop, against the real slides - skipped where they're LFS pointers)
- annotation-store: `SlideSummaryTests` (what's counted, sharing, sessions
  ending, deleted and restored, guests refused, two queries however many
  slides)
- image-viewer: `gallery/slideUrl.test.ts` (reading and writing `?slide=`,
  unsafe ids), `gallery/slides.test.ts` (every line on a card, layout by
  dock side, moving along), `gallery/moving.test.ts` (what the popup says),
  `open-layers/OpenLayers.test.ts` (each slide's own extent and ladder)
