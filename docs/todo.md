# Todo

Grouped by area, most important first. Version control is the dissertation's
focus, so it comes first and gets the most detail. Sizes are rough: small is
an afternoon, medium a few days, large a week or more.

## Done

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
- **Soft delete and change sets** (version control step 1) - annotations,
  groups, cell counts, image adjustments and collections are only hidden
  when deleted (`Deleted`, `DeletedIn`), never removed. Every write goes in
  a change set - who, what, when - and the viewer sends one
  `Change-Set-Id` with every batch, so a 21k delete is one change.
  `POST /changesets/{id}/restore` puts a change set's deletes back, any
  time, and the Select tab's Undo uses it - the delete is no longer held
  back for 8s. See
  [annotation-store.md](breakdown/annotation-store.md#11-deletes-and-change-sets)
- **Collection history** (version control step 4, the collection half) -
  the Collections panel's History tab lists every change in the collection
  you're in: who, what, when. Editors can put back anything a change
  deleted, long after the Undo toast's gone, and everyone sees it come back
  live. The restore answers with the rows it put back, so nothing loads
  again. See
  [image-viewer.md](breakdown/image-viewer.md#history---putting-deletes-back)

## 1. Version control

Step 1 is done (see Done): deletes only hide, and every write is in a
change set that says who did what. How it's built so far, across the
services, is in [version-control.md](breakdown/version-control.md). Edits are still last write wins, and once
something's overwritten it's gone. The Yjs history for a label or notes box
is dropped when the last person closes it.

### The steps, in order

Each one builds on the one before.

| # | Step | What it means here | Size |
|---|------|--------------------|------|
| 1 | ~~Soft delete~~ | Done - a delete sets `Deleted` and `DeletedIn` instead of removing the row, and a change set can be restored any time | medium |
| 2 | History log | One row per change: what, who, when, before and after, under its change set (the `ChangeSets` table is there - this adds the rows under it). This is the "user log" too - who did what is in it, so it doesn't need a store of its own. The History tab's detail page then shows each changed field as from -> to (label, notes, colour as swatches, "48 annotations, red -> blue" for a bulk recolour) - right now "Changed an annotation" can't say what changed, since the PUT overwrites label, notes and colour together and nothing keeps the old values. The edit forms autosave every 500ms pause, each its own change set, so an open form should send one `Change-Set-Id` for the whole edit - one History row per edit, before = when it opened, after = when it closed | large |
| 3 | Periodic snapshots | The whole collection's state saved every so often, so rolling back far doesn't mean replaying every change | medium |
| 4 | Viewing history | Partly done - the collection's timeline is the History tab, with put back. Still to do: a timeline per annotation or count in its Saved row, which needs the history log (step 2) | medium |
| 5 | Rollback | Put one item, or a whole change set, back to an earlier version. Sent live like any other change | medium |
| 6 | Policy for two or more people editing at once | First come wins vs last write wins vs locking vs merging - see below. Pick one per kind of field, and say why | large |
| 7 | Evaluate it | See [Evaluation](#2-evaluation) | large |

### Things to decide before building

- **Where the order comes from.** The hub's `seq` resets when a room empties
  and isn't saved anywhere (see
  [realtime-hub known gaps](breakdown/realtime-hub.md#12-known-gaps)), so it
  can't be the version number. Use a version that annotation-store owns - a
  per-item version number, plus a per-collection counter for ordering across
  items. Keep the hub's `seq` in the log as well, for working out live
  latency.
- **Change sets, not just rows.** Done for step 1 - every write is in one,
  and batches share one through the `Change-Set-Id` header. A Select tab
  recolour, a group merge and an import are each one change set. The
  history log still needs to put each row's before and after under it.
- **Who can put a change back.** Any editor can, for anyone's change - it's
  rollback, not undo. The other option is only the person who made it plus
  the host. It's one check each side if it changes: `canRestore` in the
  viewer's `collections/history/history.ts` and the Editor check on
  `POST /changesets/{id}/restore` in `ChangeSets.cs`.
- **Log the change, the state, or both.** Logging every change (event
  sourcing) gives a full history, but rebuilding a state means replaying it.
  Saving whole states is quick to read but large. Both - changes plus a
  snapshot every N changes - is what games replays and most version control
  systems do.
- **Database support.** Postgres has no built-in system-versioned (temporal)
  tables, so it's a history table written by annotation-store in the same
  transaction as the change - or a trigger. Doing it in the app keeps who did
  it and the change set id without extra work.
- **Soft delete knock-ons.** Done with an EF Core global query filter
  (`HasQueryFilter`) on all five tables. Still open: a purge rule (nothing is
  purged now), and a deleted group comes back empty because which
  annotations were in it isn't kept until the history log.
- **Undo vs rollback.** Undo is "take back my last change" and only touches
  your own edits - the command pattern, or Yjs's `Y.UndoManager` for text.
  Rollback is "put this back how it was at 3pm" and touches everyone's. They
  need different UI and behave differently when someone else has edited the
  same thing since.
- **Text fields.** Labels and notes are merged live with Yjs, but nothing is
  kept once the box closes. Either save a version to the history log when the
  last editor closes it, or keep the Yjs updates. The first is simpler and
  enough for a history view.
- **Catching up.** The hub doesn't replay ops someone missed - they catch up
  on the next load. With a history log a client could ask for "everything
  since version N" instead - the same idea as a game sending the changes
  since the last state the client acknowledged.
- **Personal vs session as branches.** A personal collection and a session
  are close to branches. Copying your own annotations into a session is a
  merge. Worth a paragraph even if it isn't built.
- **Privacy.** The log keeps user ids and names indefinitely. Needs a
  retention rule, and guests (see section 3) should be logged by their guest
  id only.

### Policies for two people editing the same thing

| Policy | How it behaves | Built with | Games / tools parallel |
|--------|----------------|------------|------------------------|
| Last write wins (now) | Later save silently replaces the earlier one | Nothing - it's the default | Simple state sync where the server takes the latest input |
| First come wins | Second save is refused with a conflict, and they're shown what changed | A version on each row - the save sends the version it started from, a mismatch is a 409. Npgsql can use Postgres's `xmin` as that version | Perforce's exclusive checkout |
| Locking | Whoever starts editing holds it until they finish or time out | A lock per item on the hub, shown on the map | Locking an actor in Unreal's Multi-User Editing |
| Merge | Both changes are kept | Yjs (CRDT) - already used for labels and notes | Collaborative editors |

Comparing at least two of these on the same field, with numbers, is the
strongest thing the evaluation can show.

### Games parallels to write up

- Authoritative server: annotation-store has the final say, the hub relays
- Rollback netcode: roll back to a known state, apply changes in order
- Snapshots and deltas: periodic snapshots plus the changes since
- Unreal Multi-User Editing: transactions, locking, a shared session
- Perforce: changelists (change sets), exclusive checkout (first come wins)
- Editor undo stacks: the command pattern

### Reading to add to [background.md](background.md)

Already there: *Database Version Control - A Software Configuration
Management Approach*, *Temporal and Real-Time Databases*. Worth finding and
adding with links:

- Shapiro et al., *Conflict-free Replicated Data Types* (2011) - the theory
  behind Yjs
- Ellis and Gibbs, *Concurrency Control in Groupware Systems* (1989) -
  operational transformation, what Google Docs-style editors came from
- Kleppmann, *Designing Data-Intensive Applications* - the chapters on
  replication and on transactions/lost updates
- Fowler, *Event Sourcing* - logging changes vs saving state
- Glenn Fiedler's *Gaffer on Games* articles and the GGPO rollback
  netcode write-ups - the games side

## 2. Evaluation

- **Latency** - how long a change takes to reach everyone else. The hub
  already stamps each op with `serverTime`
- **Conflicts** - two people editing the same annotation or count at once:
  how often it happens, and how many changes each policy loses
- **Yjs vs last write wins** for labels and notes
- **History cost** - how much the log grows per change, and how long a
  rollback of 1, 1k and 20k items takes
- **Canvas vs WebGL frame times** - the WebGL side is measured in
  [rendering.md](rendering.md) (2026-10-13). Still needed: the same
  `map_bench.js` run with annotations drawn on a canvas, to compare against
- Already there to build on: the hub's `/rooms/{roomId}/docs` endpoint (doc
  sizes), the Grafana [dashboard](../dashboard/README.md),
  `scripts/seed_stress.py`

## 3. Guest accounts - what's left

Guests are done (see Done). Still open:

- Letting guests in on one link but not another - every link lets them in
  now. A flag on `CollectionInvites` and a switch in the invite UI
- Running the name filter over the rest of what people type (labels,
  notes, group and session names) - `isClean` and `censorText` are there
- Typed names bring back the ethics question of people putting in real
  names, even unsaved - needs a line in the write up
- Is the default editor cap right? Hosts pick their own now, starting from
  index.tsx's `maxEditors` (40 at the moment) - what they pick, saved as
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

- **Rotation and image adjustments** are only shared in Present, not live
  otherwise
- **Sessions are one slide each** - whether one should cover several (a
  case) is still open (see [thought-process.md](thought-process.md))
- **Azure** - two options costed in [azure.md](azure.md), nothing deployed
  yet. Tiler runs on linux now, so it isn't blocked

## 7. Design

- Dark and light mode, following the system setting. The CSS already uses
  variables, so it's mostly a second set of values
- Top and bottom dock layout
- Overhaul designs generally

## 8. Maybe - probably cut

- **Language support** - is it worth the effort? Adds nothing to the version
  control argument
- **ML annotation suggestions** - needs training data, and moves away from
  the dissertation (could change the spec)

## 9. Questions to ask (supervisor / work)

- Can I use work's data?
- Can I use work's resources, e.g. Azure?
- Help from inside work, e.g. a UX review or a lab analyst trying it out
- Does doing this dissertation with a company need declaring?
- Is NHS ethical approval needed? Ask early - it takes a long time

## Suggested order
