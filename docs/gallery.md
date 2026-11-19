# Gallery

The viewer used to show one slide, picked in `index.tsx`. The Gallery tool
lists every slide the tiler has and moves between them without reloading
the page.

## What it looks like

A toolbar button, second after fullscreen, opens a panel like any other.

| Where the panel is      | What it shows                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Floating, cards         | A card per slide - picture, name, size in pixels, max zoom and µm per pixel, real size, kind and channels, file size, collections, live sessions, who's on it now. 24 to a page |
| Floating, filmstrip     | Pictures only in a row, with the name in a bar under each. The button at the top switches between the two              |
| Docked left or right    | Always a filmstrip, running down the edge                                                                                |
| Docked top or bottom    | Always a filmstrip, running along the edge, with the search box and Filter button down its left                         |

Down the side the pictures are smaller and a fixed size (8em). Along the top
or bottom they're as big as fits over the scrollbar - the list is a size
container and each picture is `100cqh` less the scrollbar, the tile's border
and the name bar. A fixed 8em didn't fit there: the scrollbar pushed the row
past the bottom of the panel, which cut the scrollbar off, so with 200 slides
there was no way along but the arrows. An edge with only the gallery on it
shrinks to fit - 11em at the sides, 14em along the top or bottom, against
20em and 21em for other panels (`edgeSizeEm` in
[dock.ts](../image-viewer/src/components/toolbar/dock.ts)). Share the edge
with another panel and it goes back to the usual size, since that panel needs
the room.

A filmstrip has the arrows on a ribbon floating over the bottom of it, with
"3 of 4" between them. Along the top or bottom it sits just above the
scrollbar, so all of the scrollbar can be dragged. The open slide has an outline, and a dot by a
name means someone's working on it now - a live session you're in, or
someone online with it open.

Each picture is a square from the middle of the slide, its shorter side
across - so a slide twice as tall as it's wide shows its middle half. The
tiler cuts it (`GET /slides/{id}/thumbnail.jpg?width=192&square=true`), so
it's read at the size it's shown. One that doesn't load is asked for again
after 1s and 4s (`&try=1`, `&try=2`, so the browser doesn't hand back the
failure), and only then falls back to the one tile that's the whole slide,
cropped to the same square. For a MIRAX slide that tile is mostly black -
nothing's scanned round the tissue - and falling back on the first failure
left black squares in the strip whenever the tiler was busy or restarting,
until the page was reloaded. Checked by stopping the tiler while a page of
cards loaded and starting it again: every first try and `try=1` got a 502,
every `try=2` loaded, none fell back.

## Finding a slide

With a set like the 200 TCIA slides, scrolling isn't enough. Above the slides,
in every layout:

- **Search** - every word typed is somewhere in the name the scanner gave it,
  its id or its file name, in any case. "hcrc 01" finds hcrc-010 to hcrc-019
- **Filter** - the same sheet as the Saved lists' (see `FilterSheet` below),
  with a badge for how many are on. Kind (brightfield, fluorescence, not
  stated), Z-stack (z-stacks, flat), Objective, Channel (when any slide has
  channels), Collections (with, without) and People on it now (a live session
  on it or someone with it open). Each chip says how many slides it covers,
  out of all of them, so chips don't vanish as others go on
- **Pages** - cards come 24 to a page with the Saved lists' pager, opening on
  the page the open slide's on. Searching or filtering starts from the first.
  The strips aren't paged: they scroll, with the scrollbar or the arrows, and
  a page break in a filmstrip would just be a second way to get stuck

While anything's narrowing it, the bar says "3 of 12 · 202 in all", and the
arrows step through what's showing - from a slide that's filtered out, to the
nearest one showing on that side. Nothing matching says so, with a button to
clear the search and filters.

All of it's worked out in the viewer from what the tiler and annotation-store
already sent ([galleryFilters.ts](../image-viewer/src/components/gallery/galleryFilters.ts)),
so it's instant and nothing new goes to a server. That holds into the
thousands; past that the tiler's list itself would want paging.

The filter sheet's shell - the button, following the panel, closing on a click
outside or Escape, Clear all and Done - came out of the Saved lists' menu into
[FilterSheet.tsx](../image-viewer/src/components/saved/FilterSheet.tsx), so both
use it and look the same. Docked along the bottom the sheet now comes up from
the button instead of dropping off the bottom of the screen
(`placeSheet`'s "above"), which fixes the Saved lists docked there too.

## A big set of slides

The tiler lists slides by opening each one, and OpenSlide reads all of a MIRAX
slide's `Index.dat` to do it - 15 MB each for the TCIA slides. The first
`GET /slides` after a start took 50s for 200 of them, and the gallery said
"Loading slides…" the whole time. The tiler now keeps what it read in the data
folder and reads it in the background at start, so after a restart the list
takes 0.06s. See [tiler/README.md](../tiler/README.md#slide-info-between-starts).

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
| Z-stack                      | The tiler's `slices` - more than one is a volume                                                                                                           |

Empty collections aren't counted. Opening a slide makes everyone an empty
personal collection there (`POST /collections/ensure`), so counting those
would only say who'd looked. Which collections you can open is the rule
`GET /collections` already used, now in one place
(`CollectionAccess.VisibleTo`) - if every collection becomes public, that's
where it changes.

Max zoom is the objective the scanner reports, so slide 000 says x20 even
though it's a 1/16 copy. The µm per pixel next to it (3.72, against 0.23 to
0.32 for the others) is the honest figure.

## In other viewers

CytoBrowser (Rydell and Lindblad 2021, see
[background.md](background.md#read-and-noted)) opens on a gallery of thumbnails:
a low-resolution picture of each image, and hovering one shows a zoomed-in
version of the middle. Picking one asks whether to start a new annotation
session or carry on with an earlier one.

What a card should say, from notes on reading it, against what it says now:

| Wanted                  | Here now                                                         |
| ----------------------- | ---------------------------------------------------------------- |
| Size                    | Yes - pixels, real size, file size                               |
| Resolution              | Yes - µm per pixel                                               |
| Zoom level              | Yes - max zoom, as the scanner reports it                        |
| Collections             | Yes - ones you can open with something in them                   |
| Users on the image      | Yes - live sessions and who's on it now                          |
| Annotations             | No - collections are counted, not what's in them                 |
| Zoomed preview on hover | No - the picture is a square from the middle, the one size       |

Annotations would come from the same `GET /slides/summary` call
([SlideSummaryEndpoints.cs](../annotation-store/Collections/SlideSummaryEndpoints.cs)) -
a third query next to `CollectionsWithWork` and `LiveSessions`, counting
annotations in the collections `VisibleTo` already lets in. One more number per
slide, not a new request.

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
  square crop, against the real slides - skipped where they're LFS pointers),
  `SlideInfoCacheTests` and `SlideInfoWarmupTests` (kept info used without
  opening the slide, read again when a file changes, read once however many
  ask at once, the warm-up). `scripts/time_slide_list.py` times the list on a
  first start and a restart
- annotation-store: `SlideSummaryTests` (what's counted, sharing, sessions
  ending, deleted and restored, guests refused, two queries however many
  slides)
- image-viewer: `gallery/slideUrl.test.ts` (reading and writing `?slide=`,
  unsafe ids), `gallery/slides.test.ts` (every line on a card, layout by
  dock side, moving along, thumbnail retries), `gallery/galleryFilters.test.ts`
  (search, every filter, chip counts, arrows over what's showing, pages),
  `gallery/stripLayout.test.ts` (the CSS that keeps the bottom strip's
  scrollbar in reach), `saved/sheetPlacement.test.ts` (the sheet coming up
  from the bottom dock), `gallery/moving.test.ts` (what the popup says),
  `open-layers/OpenLayers.test.ts` (each slide's own extent and ladder)
- playback: the gallery scene checks the bottom-docked row fits the panel
  with room for the scrollbar, and the toolbar doesn't cover it
