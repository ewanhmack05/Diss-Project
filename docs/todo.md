# Todo

Grouped by area, most important first, except 14 and 15, which are at the end
so links to the others still work. Version control is the dissertation's focus,
so it comes first and gets the most detail. Sizes are rough: small is an
afternoon, medium a few days, large a week or more.

## Done

- **Telling sessions apart** - new sessions are named with when they
  started ("Bob Hughes's session, 17 Nov 14:05"), each row in the
  Collections tab says when it started or ended, and ended ones fold under
  **Ended (n)**. Ending one nothing happened in deletes it, so empty ones
  don't pile up. Reopen is filled so it doesn't look greyed out
- **Pagination** - annotations and cell counts, with first/last and a
  page number you can type (51k annotations is 1,021 pages)
- **Collab tab** - split into sub tabs, a lot less text
- **Viewport boxes per person** - click someone's chip to switch their box
  on or off, hover to see it picked out even when it's off. On by default
  in a small session, off in a large one. Your choice only, nobody else
  sees it
- **Small vs large sessions** - an edit link lets in the first `maxEditors`
  editors, the host included. The host picks the number when they start
  the session (1 to 50), starting from the viewer's `maxEditors` in
  [index.tsx](../image-viewer/src/index.tsx) - 6 if that isn't set. It's
  saved on the session and can't change after. Anyone joining after that comes in view
  only. It only limits joining - the host can still make anyone an editor.
  When an editor leaves or is made view only, the next person through the
  link can edit again. Rules in
  [SessionSize.cs](../annotation-store/Collections/SessionSize.cs)
- **Guests** - an invite link opened without an account offers to join as
  a guest under a typed name, view only. The hub mints a short-lived token
  (guest id, session id, expiry - no name), annotation-store lets it read
  that one session, and the name only lives in the hub's room. Names go
  through obscenity in the viewer. Guests can make an account to edit,
  from their own tab or when the host asks them. See
  [guests.md](guests.md)
- **Simulated people** - `scripts/simulate_session.py <invite link>` joins
  made up people to a session and has them move round live, for testing
  large sessions without other people (see the
  [scripts README](../scripts/README.md#simulated-people-in-a-session))
- **Stress testing** - [seed_stress.py](../scripts/README.md), OpenLayers vs
  WebGL numbers in [rendering.md](rendering.md), OpenTelemetry into the
  Grafana [dashboard](../dashboard/README.md)
- **Ruler** is shared live
- **Bulk changes over 20k** - deletes, recolours and new groups go in
  batches the store accepts (it took at most 20,000 ids, and a 21k delete
  failed silently)
- **Soft delete and change sets** (version control step 1, since replaced
  by the history log below) - annotations,
  groups, cell counts, image adjustments and collections are only hidden
  when deleted (`Deleted`, `DeletedIn`), never removed. Every write goes in
  a change set - who, what, when - and the viewer sends one
  `Change-Set-Id` with every batch, so a 21k delete is one change.
  `POST /changesets/{id}/restore` puts a change set's deletes back, any
  time, and the Select tab's Undo uses it - the delete is no longer held
  back for 8s. See
  [annotation-store.md](breakdown/annotation-store.md#11-history-and-change-sets)
- **History log** (version control step 2, the store half) - a `history`
  schema apart from the data, with what every change did to every row: a
  delete keeps the whole row, an edit the columns it changed, before and
  after. Written with every save in the same transaction, so nothing can
  change without it. The live tables only hold what's there now - soft
  delete's `Deleted` and `DeletedIn` are gone, and the migration moved every
  soft-deleted row into the history. Putting a change back now undoes what it
  changed too, so a deleted group comes back with what was in it. See
  [version-control.md](breakdown/version-control.md#4-the-history-area)
- **Collection history** (version control step 4, the collection half) -
  the Collections panel's History tab lists every change in the collection
  you're in: who, what, when. Editors can put back anything a change
  deleted, long after the Undo toast's gone, and everyone sees it come back
  live. The restore answers with the rows it put back, so nothing loads
  again. See
  [image-viewer.md](breakdown/image-viewer.md#history---putting-deletes-back)
- **One row's timeline and going back on it** (version control steps 4 and 5,
  the rest of them) - History on a Saved row lists everything that's happened
  to that annotation or count, each change from and to. Editors can put it how
  it was at any point, which undoes everything since, whoever did it, and is a
  change of its own. A page first says what would change. If someone's changed
  it since you opened it, it's turned down rather than undoing what you haven't
  seen. A deleted row can come back on its own too, from its name on the change
  that deleted it. See
  [version-control.md](breakdown/version-control.md#going-back-on-one-row)

- **Snapshots and putting a whole collection back** (version control steps 3
  and 5) - a change opened in the History tab can put the whole collection back
  to how it was just after it: rows added since are taken out, rows deleted
  since come back, and everything else goes back, whoever changed it. It's a
  change of its own, so it can be gone back on. A snapshot of what can change is
  taken every 5,000 entries, so working that out only has to undo what's since
  the nearest one. Everyone else's viewer loads the collection again. See
  [version-control.md](breakdown/version-control.md#putting-a-whole-collection-back)
- **Evaluation** (version control step 7) - conflicts, text merging, latency,
  history cost and rendering, all simulated. See [evaluation.md](evaluation.md)
- **Messaging** - its own [service](../messaging/README.md) with its own database:
  one to one conversations and a chat for the session you're in. The hub only says
  something's waiting, so a faked notice shows nobody anything. The viewer's Messages
  tool is an inbox, with a list that folds down to a rail. See [messaging.md](messaging.md)
- **Sending things** - **Send** on saved annotations and counts, both kinds of group,
  what's picked on the Select tab and collections. **Attach** sends the area you're
  looking at, or an invite to your session. What's sent is a copy, up to 5MB
- **Looking at what's sent** - a preview on each card and **View** on the map, in
  its own colours, without keeping anything. **Add to my collection** adds it as new rows
- **Where something came from** - adding something sent records who sent it, the
  message, the collection and which row each new one was copied from. History says
  "Added 2 annotations from Bob". This is a recorded parent for a copy between
  collections, for [personal vs session as branches](#things-to-decide-before-building)
- **Cell count groups** - the same as annotation groups, merging and first change
  wins included, and they go through history, put back, rollback and snapshots
- **Invites are messages** - Invite on the Users tab opens your conversation with them
  and sends it there, so they can be offline and nothing pops up. `InviteUser` is gone
  from the hub
- **Gallery** - every slide the tiler has, as cards or a filmstrip, docked or
  floating, and moving between them without a reload: one map, new tiles and
  view, annotations redrawn, panels left open. The address follows the slide.
  The tiler gives names, kinds, channels and a square thumbnail from the middle
  of the slide; annotation-store counts collections and live sessions per
  slide. Invites, sent things and the Users tab can go to another slide now.
  See [gallery.md](gallery.md)
- **Gallery for a big set** - tried on the 200-slide TCIA
  Hungarian-Colorectal-Screening set. Search by name, a Filter sheet like the
  Saved lists' (kind, z-stack, objective, channel, collections, people on it
  now), cards 24 to a page, a scrollbar along the bottom dock that can be
  reached, thumbnails that try again before falling back, and a tiler that
  lists 200 slides in 0.06s after a restart instead of 50s. See
  [gallery.md](gallery.md#finding-a-slide)
- **On the map tab** (phases 1 to 3 of [layers.md](layers.md#9-phases)) - the
  Collections panel opens on where you're working and how much of it is on the
  map, with a chip per person and per group to show or hide, and why anything's
  hidden. A dot on the Collections button says something's off the map. The
  Select tab is only picking now
- **Z-stacks** - a slide can be a volume, one slice per section. volume-prep
  converts and lines up serial sections (rigid), the tiler serves them, and the
  Depth tab steps through them. Two sets are in: 15 sections from EPFL and 47
  from Kartasalo, both mouse liver. See [zstack.md](zstack.md#9-phases)
- **3D view** - the same slices as a block in three.js: cut on X, Y or a
  diagonal, how many slices, opacity, true depth, a gap between slices. The gap
  between liver sections 9 and 10 shows as a break. A Z cut was built and taken
  out, as Slices drawn already did it
- **Annotating at a depth** - a shape is on the slice it was drawn on, a range
  or every slice, and its slices can change after saving, with conflicts checked
  under either policy. A count stays on the slice it was counted on. All of it
  goes through history, put back, rollback, snapshots and files. Moving
  between slices couldn't be put back at first - the columns that go back were
  listed by hand in four places, and slices weren't in any of them. A test now
  fails for a column that's in neither the list that goes back nor the one
  that's fixed. See
  [version-control.md](breakdown/version-control.md#slices-go-back-together)
- **Working together in 3D** (all six phases) - the slice live, who's in 3D,
  other people's cameras, Follow and Present in 3D, look here, and markers. A
  marker is three clicks: a corner, the opposite corner, then how deep. See
  [volume-live.md](volume-live.md#5-phases)
- **Four viewers read** - Cytomine 2013, xOpat, PIMIP and CytoBrowser, in
  [background.md](background.md#read-and-noted). What came out of them is in
  [section 12](#12-ideas-from-the-reading)
- **Playback videos** - `node record.js` in [playback](../playback/README.md) remakes
  them all, messaging included, and each scene checks what it shows

## 1. Version control

All seven steps are done (see Done), the last one simulated only: every write
is in a change set that says who did what, and the history schema keeps what
each change did to every row, before and after. How it's built, across the
services, is in [version-control.md](breakdown/version-control.md). The Yjs
history for a label or notes box is dropped when the last person closes it.

### The steps, in order

Each one builds on the one before.

| #   | Step                                              | What it means here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Size   |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | ~~Soft delete~~                                   | Done, then replaced by step 2 - deleted rows are kept in the history now, not hidden in the live tables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | medium |
| 2   | ~~History log~~                                   | Done in the store - `history.Entries`, one row per row a change touched, under its change set. This is the "user log" too - who did what is in it, so it doesn't need a store of its own. The History tab's detail page shows each changed field from and to (label, notes, colour as swatches, groups by name, "10 annotations" for a bulk recolour). One edit is one History row too - an open edit form sends one `Change-Set-Id` with every autosave, and the store folds repeat updates to a row in one change set into one entry, from how it was when the form opened to how it was when it closed | large  |
| 3   | ~~Periodic snapshots~~                            | Done - a snapshot of what can change, every 5,000 entries, so a whole collection can go back to any change. See [version-control.md](breakdown/version-control.md#putting-a-whole-collection-back)                                                                                                                                                                                                                                                                                                                                                                                                        | medium |
| 4   | ~~Viewing history~~                               | Done - the collection's timeline is the History tab, with put back, and each change shows what it changed, from and to. Every annotation and count has a timeline of its own, from History on its Saved row                                                                                                                                                                                                                                                                                                                                                                                               | medium |
| 5   | ~~Rollback~~                                      | Done at all three sizes - a change set (unless someone's changed it since), one row to any point on its timeline, and a whole collection to any change                                                                                                                                                                                                                                                                                                                                                                                                                                                    | medium |
| 6   | ~~Policy for two or more people editing at once~~ | Done - labels and notes merge (Yjs); colour, group and a group's name and notes are last write wins or first come wins, picked per session; locking is for the write-up. Checked per field, from the value a save started from. See [version-control.md](breakdown/version-control.md#8-two-people-changing-the-same-thing)                                                                                                                                                                                                                                                                               | large  |
| 7   | ~~Evaluate it~~                                   | Measured - see [evaluation.md](evaluation.md). Everything's simulated, so real people are still to come                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | large  |

### Things to decide before building

- **Where the order comes from.** Decided: annotation-store's own.
  `history.Entries` has a counting `Id`, and timelines, restores, rollback and
  snapshots (`UpToEntry`) all go by it. There's no version number per item -
  conflicts are checked per field, from the value a save started from. The hub's
  `seq` resets when a room empties and isn't in the log (see
  [realtime-hub known gaps](breakdown/realtime-hub.md#12-known-gaps)).
- **Change sets, not just rows.** Done - every write is in one, and batches
  share one through the `Change-Set-Id` header. A Select tab recolour, a
  group merge and an import are each one change set, with an entry per row
  under it.
- **Who can put a change back.** Any editor can, for anyone's change - it's
  rollback, not undo. The other option is only the person who made it plus
  the host. It's one check each side if it changes: `canRestore` in the
  viewer's `collections/history/history.ts` and the Editor check on
  `POST /changesets/{id}/restore` in `History/ChangeSets.cs`.
- **Log the change, the state, or both.** Decided for step 2: the change,
  per row - the changed columns before and after for an edit, the whole row
  for a delete, nothing for a create. The live tables are the current state,
  so nothing needs replaying to read it. Snapshots (step 3) only matter for
  putting a whole collection back to a point in time.
- **Database support.** Decided: Postgres has no system-versioned
  (temporal) tables, so it's a `history` schema written by annotation-store
  in the same transaction as the change - from EF's change tracker on every
  save, not a trigger, which keeps who did it and the change set id without
  extra work. A separate history service with its own database was ruled
  out - see [version-control.md](breakdown/version-control.md#why-not-a-separate-service).
- **Who can put a whole collection back.** Any editor for now, the same as
  putting a change back, though it undoes far more. It's one check each side if
  it should be the host only: `canRollBack` in the viewer's
  `collections/history/rollback.ts` and the Editor check on
  `POST /changesets/{id}/rollback` in `History/CollectionRollback.cs`.
- **Soft delete knock-ons.** Gone with soft delete - deleted rows are in
  the history, and a deleted group comes back with what was in it.
- **Undo vs rollback.** Undo is "take back my last change" and only touches
  your own edits - the command pattern, or Yjs's `Y.UndoManager` for text.
  Rollback is "put this back how it was at 3pm" and touches everyone's. They
  need different UI and behave differently when someone else has edited the
  same thing since.
- **Catching up.** The hub doesn't replay ops someone missed - they catch up
  on the next load. With a history log a client could ask for "everything
  since version N" instead - the same idea as a game sending the changes
  since the last state the client acknowledged.
- **Personal vs session as branches.** A personal collection and a session
  are close to branches. Copying your own annotations into a session is a
  merge. Worth a paragraph even if it isn't built.

### Policies for two people editing the same thing

| Policy                                                   | How it behaves                                                                            | Built with                                                                                                                                                                                                  | Games / tools parallel                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Last write wins (built - a session's "Last change wins") | Later save silently replaces the earlier one, and the store counts it                     | Nothing, plus the save's was so the store can count what it overwrote                                                                                                                                       | Simple state sync where the server takes the latest input |
| First come wins (built - "First change wins")            | Second save is refused with a 409, and they're shown what changed and by whom, and choose | Per field, not a row version: the save sends the value it started from, and it's refused if that's changed since and it would change it again. A row version would call a regroup and a recolour a conflict | Perforce's exclusive checkout                             |
| Locking                                                  | Whoever starts editing holds it until they finish or time out                             | A lock per item on the hub, shown on the map                                                                                                                                                                | Locking an actor in Unreal's Multi-User Editing           |
| Merge                                                    | Both changes are kept                                                                     | Yjs (CRDT) - already used for labels and notes                                                                                                                                                              | Collaborative editors                                     |

Comparing at least two of these on the same field, with numbers, is the
strongest thing the evaluation can show.

### Known gaps still open

The full list is in
[version-control.md](breakdown/version-control.md#12-known-gaps). The ones that
matter most:

- **Not logged:** renaming a collection, sharing, ending a session, members and
  invite links
- **Someone else's typing saves under your edit**, in a session with the same
  box open
- **A form left open** puts its old text back on its next pause, after a put
  back, a timeline step or a whole collection rollback
- **Only the first 5 deleted rows** of a change can be opened
- **The hub trusts the viewer** to have saved before it tells everyone

### Games parallels to write up

- Authoritative server: annotation-store has the final say, the hub relays
- Rollback netcode: roll back to a known state, apply changes in order
- Snapshots and deltas: periodic snapshots plus the changes since
- Unreal Multi-User Editing: transactions, locking, a shared session
- Perforce: changelists (change sets), exclusive checkout (first come wins)
- Editor undo stacks: the command pattern

### Reading to add to [background.md](background.md)

Worth finding and adding with links. None of these are in there yet:

- Shapiro et al., _Conflict-free Replicated Data Types_ (2011) - the theory
  behind Yjs
- Ellis and Gibbs, _Concurrency Control in Groupware Systems_ (1989) -
  operational transformation, what Google Docs-style editors came from
- Kleppmann, _Designing Data-Intensive Applications_ - the chapters on
  replication and on transactions/lost updates
- Fowler, _Event Sourcing_ - logging changes vs saving state
- Glenn Fiedler's _Gaffer on Games_ articles and the GGPO rollback
  netcode write-ups - the games side

## 2. Evaluation

Measured, simulated - results and how far to trust them in
[evaluation.md](evaluation.md). Real people depend on ethics, so that's in
[section 11](#11-what-id-do-in-the-future).

- **Latency** - how long a change takes to reach everyone else. The hub
  already stamps each op with `serverTime`
- **Conflicts** - two people editing the same annotation or count at once:
  how often it happens, and how many changes each policy loses.
  `scripts/simulate_conflicts.py` runs it (see the
  [scripts README](../scripts/README.md#people-changing-the-same-thing)), and
  `annotation_store.conflicting_saves` counts it on the dashboard
- **Yjs vs last write wins** for labels and notes
- **History cost** - how much the log grows per change, and how long a
  rollback of 1, 1k and 20k items takes
- **Canvas vs WebGL frame times**
- Already there to build on: the hub's `/rooms/{roomId}/docs` endpoint (doc
  sizes), the Grafana [dashboard](../dashboard/README.md),
  `scripts/seed_stress.py`

## 3. Guest accounts - what's left

Guests are done (see Done). Still open:

- Letting guests in on one link but not another - every link lets them in
  now. A flag on `CollectionInvites` and a switch in the invite UI
- Running the name filter over the rest of what people type (labels,
  notes, group and session names) - `isClean` and `censorText` are there
- Is the default editor cap right? Hosts pick their own now, starting from
  index.tsx's `maxEditors` (6 at the moment) - what they pick, saved as
  `MaxEditors` on each session, is the data to measure it with

## 4. Viewport boxes - what's left

The per-person on/off is done (see Done). Still open:

- Switching boxes on or off from the Collaboration panel's Active tab too -
  it only previews on hover for now
- What you picked isn't kept past a reload
- Games parallel for the write up: a minimap showing where your teammates
  are, and spectator views you pick from

## 5. Rendering

- Write our own WebGL drawing for the shapes OpenLayers' WebGL can't do -
  triangles (arrowheads, now drawn on a canvas) and circles (dots) - and
  compare it with what's there
- Explain WebGL's limits in the write up - the table in
  [rendering.md](rendering.md) is a start
- WebGPU - could take on part of the load in theory. A paragraph in the
  write up, not code

## 6. Still unfinished from before

- **Image adjustments** are only shared in Present. Rotation goes with the
  host's view, so Follow and Present both share it. Neither is shared otherwise
- **Sessions are one slide each** - the Gallery moves between slides, but a
  session stays on one. Next is a session that moves with its people, the
  others asked whether to follow - a `CollectionSlides` join table, reads by
  slide, a "moved slide" hub message. Large. Written up in
  [gallery.md](gallery.md#whats-next---sessions-across-slides)
- **Azure** - two options costed in [azure.md](azure.md), nothing deployed
  yet. Tiler runs on linux now, so it isn't blocked. The deploy workflow has
  messaging in it, but has never run, and separate apps need the viewer's service
  addresses made configurable first. Only slide 003 is in the tiler image, so
  where the volumes are hosted isn't decided

## 7. Messaging - what's left

Built (see Done). Still open:

- **Cell count groups in GeoJSON files** - exporting a collection to a file leaves
  them out. Sending one, and the store's own export, keep them
- **Send buttons not tried by hand** - on annotation groups, the Select tab and
  collections. Same path as the ones that were, but no video or click has been through them
- **Session chat isn't in the playback video** - see
  `NOT_SHOWN` in [coverage.js](../playback/lib/coverage.js)

For the write up: a copy between collections keeps where it came from, which makes
it close to the merge in
[Personal vs session as branches](#things-to-decide-before-building).

## 8. Design

- Dark and light mode, following the system setting. The CSS already uses
  variables, so it's mostly a second set of values
- Top and bottom dock layout - docking there works, and most panels lay
  themselves out for it. Collections, Collaboration and Messages have no styles
  for it
- Overhaul designs generally
- **On the map, phases 4 and 5** - other people's collections over yours, read
  only, then copying from one into yours. Phases 1 to 3 are done (see Done).
  Phase 5 is the one that touches annotation-store. See
  [layers.md](layers.md#9-phases)

## 9. Maybe - probably cut

- **Language support** - is it worth the effort? Adds nothing to the version
  control argument
- **ML annotation suggestions** - needs training data, and moves away from
  the dissertation (could change the spec)

## 10. Questions to ask (supervisor / work)

- Can I use work's data?
- Can I use work's resources, e.g. Azure?
- Help from inside work, e.g. a UX review or a lab analyst trying it out
- Does doing this dissertation with a company need declaring?

## 11. What I'd do in the future

Not being done for this project - left for the write up as what comes next. See
[ethics.md](ethics.md).

- **Ethical approval** - whether NHS approval is needed, before any real data or
  real people. Testing with people depends on it, so the evaluation stays simulated.
  Notes and shapes may describe patient slides, a sent copy outlives losing access to
  the original, and guests' typed names could be real ones
- **Keeping history** - a purge rule. Nothing's purged now, so the log grows forever
- **Retention** - the log keeps user ids and names indefinitely, and messages are kept
  until someone deletes them. Both need a rule
- **Label and notes history** - they're merged live with Yjs, but no version is kept
  once the box closes. Saving one to the history log when the last editor closes it is
  the simple way, and enough for a history view

## 12. Ideas from the reading

From the four viewers read so far - Cytomine 2013, xOpat, PIMIP and CytoBrowser,
written up in [background.md](background.md#read-and-noted). None built yet.

- **Hover an annotation for its details** (Cytomine) - area, perimeter, term,
  who drew it, in a small box over the map. The map has no hover on
  annotations today, only on people's names. Good to add, small
- ~~**A layer per person**~~ (Cytomine) - done, in a joint collection: People
  chips on the Collections panel's On the map tab. See [layers.md](layers.md).
  Other people's personal collections as layers on top of yours is still open
  (phase 4 there)
- **Annotation presets on each mouse button** (xOpat) - a preset is a shape
  plus a label and colour, and left and right click can each hold one, so two
  kinds of thing can be marked without going back to the panel. Right click
  isn't used on the map now (only `singleclick`, in `useMapSelection.ts`), so
  it's free, though the browser's own menu would need stopping
- **Automatic outline** (xOpat) - double click and it outlines the joined-up
  area of a chosen layer from where you clicked, like a flood fill; Alt for
  placing points by hand; Shift to paint an area with a brush that becomes a
  polygon. It needs a layer to fill on (a model's output, or a threshold of
  the image), so it's later than the rest
- **Two views side by side** (xOpat) - see
  [rendering.md](rendering.md#ideas-from-xopat)
- **Plugins** (xOpat, CytoBrowser) - both make it easy to add a new tool
  without touching the core. The toolbar's panels are close already; worth a
  paragraph on whether the tools could be loaded as plugins
- **Stories** (xOpat's Presenter) - record views with notes and play them
  back. Present mode does it live; a recorded one would suit teaching
- **More slide formats** - see
  [tiler.md](breakdown/tiler.md#11-more-formats-and-more-than-one-tiler)
- **Annotation count on gallery cards** - see
  [gallery.md](gallery.md#in-other-viewers)
- **Annotations as GeoJSON** (CytoBrowser saves JSON) - already done here:
  collections import and export GeoJSON in slide pixels
  ([collectionGeoJson.ts](../image-viewer/src/components/collections/collectionGeoJson.ts))

## 13. Grouping slides in the gallery - thoughts, not built

The gallery is one flat list. With the TCIA set that's 200 slides, one per
patient, and a real study has several per patient - serial sections,
different stains, a biopsy and a resection - so the list stops being enough
before search and filters run out. Grouping is a big change, so these are notes
to decide from, not a plan.

**What a group is.** Patient, area (organ, site, block), stain, scan batch,
study arm. A slide is in several at once - patient 12 _and_ H&E _and_ colon -
so groups are tags with a key, not folders in a tree. A tree forces one way of
slicing the set, and whoever set it up picks it for everyone. A z-stack is
already a group of a kind: sections of one block lined up, opened as one slide.

**Where the tags come from**, cheapest first:

1. _The data folder_ - subfolders as groups (`colon/patient-012/slide.mrxs`).
   Nothing new to write, but it's one way of slicing again, and moving files
   breaks the slide ids annotation-store keys everything on
2. _A manifest next to the slides_ - a CSV or JSON of slide id to tags
   (`hcrc-012, patient=12, diagnosis=adenoma`). TCIA ships one for this
   collection already: a 3.93 KB clinical CSV (demographics and diagnosis) per
   patient. The tiler reads it with the slides and sends `tags` on each slide
   in `GET /slides` - a contract change, but an added field. No database
3. _Groups people make_ - in annotation-store, like annotation groups: named,
   shared, editable. Those are edits, so they'd need the history log and
   putting back like everything else, and permissions for who can change a
   shared group. The most work, and the only one that suits a set nobody
   catalogued

Probably 2 first, with 3 later if people need groups the files don't have.

**What it looks like.** The tags become Filter sheet sections on their own -
a Patient section, a Diagnosis section - which the sheet built for search and
filters already handles: chips with counts, any of these. A "Group by" picker
above the cards adds headers ("Patient 12 - 3 slides"), folding, and the pager
counting groups rather than slides so a group isn't split across pages. The
filmstrip gets a divider and the group's name between runs. A saved filter
("adenomas, x40") is a smart group, the way an asset browser's saved searches
are.

**What it touches.**

- Sessions across slides (see [gallery.md](gallery.md#whats-next---sessions-across-slides))
  - a group is the natural thing for a session to span: "review patient 12"
  rather than one slide. Worth deciding together, since both turn slides into
  sets
- The arrows step within a group, and the address could carry it
  (`?slide=hcrc-012&group=patient-12`)
- Ethics - patient ids are personal data. TCIA's are pseudonymised; an NHS
  number wouldn't be, so a manifest from real clinical data needs the same
  thought as [section 11](#11-what-id-do-in-the-future)

**Games parallel for the write up.** Engine asset browsers deal with the same
thing: thousands of assets, many ways to slice them. Unreal has folders plus
Collections (hand-made and dynamic, saved searches) and Unity has labels.
Both kept folders and added tags and saved searches on top, rather than making
one tree do everything.

**Size.** The manifest and tag filters: medium - the tiler reads a file and
sends a field, and the viewer gets new sections and a Group by. Groups people
make, with history: large.

## 14. Z-stacks and 3D - what's left

Built (see Done). Still open, with the rest in
[zstack.md](zstack.md#10-open-questions) and
[volume-live.md](volume-live.md#7-open-questions):

- **Live things that don't know the slice** - shared and comparison counts, and
  2D shapes part way through being drawn, carry no slice. So dots placed from
  different slices land in one count, saved on one slice, and someone's
  half-drawn shape shows on your slice too. Read from the code (`SharedDot` and
  `ComparisonDot` in the hub's
  [Messages.cs](../realtime-hub/Slides/Messages.cs), sketches in
  [sketch.ts](../image-viewer/src/components/realtime/sketch.ts)), not tried.
  Medium - the counts need a hub contract change
- **A shape's outline can't change after saving**, only its slices, and a
  count's slice can't change at all
- **Non-rigid registration** - rigid stops at a 43 um median on Kartasalo's
  liver and can't fix torn sections. Large
- **Follow in 2D while the host's in 3D** - the follower stays on the host's
  slice. Should their map go to where the host's camera is pointing too?
- **The cut under Follow** - following takes the host's cut, so you can't keep
  your own. Is that right?
- **How many cameras before it's noise** - past 6, only the host's and recent
  movers show. A guess, and it wants real people
- **Guests' cameras** go to everyone in the session. Not in
  [ethics.md](ethics.md) yet
- **Live 3D isn't in a playback video** - the depth scene is one person
- **Frame rates on integrated graphics** - [zstack.md](zstack.md#9-phases)'s are
  from a desktop graphics card
- **Bigger data** - a true 3D set (PCa_Bx_3Dpathology) and mixed stains (HyReCo),
  phase 8 in [zstack.md](zstack.md#9-phases). Probably future work

## 15. Known bugs and gaps elsewhere

Each service's doc has its own list. These are the ones worth fixing or saying in
the write up, from the [viewer](breakdown/image-viewer.md#16-known-gaps),
[tiler](breakdown/tiler.md#9-known-gaps),
[annotation-store](breakdown/annotation-store.md#15-known-gaps) and
[hub](breakdown/realtime-hub.md#12-known-gaps):

- **Reopening a session doesn't reload it** - a bug. Changes made while you were
  looking at it read only don't show until a reload
- **Saves aren't rolled back if they fail** - there's a toast, but it stays on
  screen, and on everyone else's
- **Viewing a big count freezes the page** while its dots are read
- **The map loads every annotation** in a collection, not just what's in view
- **Transparent corners are black on tiles**
- **The tiler has no sign in** - fine for public slides only
- **No component tests** in the viewer
- **Before anything's deployed** - any origin is allowed, and the guest signing
  key is a dev one. See [azure.md](azure.md#before-anything-is-public)

## Suggested order

1. **Reading list** for [background.md](background.md), alongside the others
2. **Writing it up** - version control is finished and measured
