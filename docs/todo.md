# Todo

Grouped by area, most important first. Version control is the dissertation's
focus, so it comes first and gets the most detail. Sizes are rough: small is
an afternoon, medium a few days, large a week or more.

## Done

- **Pagination** - annotations and cell counts, with first/last and a
  page number you can type (51k annotations is 1,021 pages)
- **Collab tab** - split into sub tabs, a lot less text
- **Stress testing** - [seed_stress.py](../scripts/README.md), OpenLayers vs
  WebGL numbers in [rendering.md](rendering.md), OpenTelemetry into the
  Grafana [dashboard](../dashboard/README.md)
- **Ruler** is shared live
- **Bulk changes over 20k** - deletes, recolours and new groups go in
  batches the store accepts (it took at most 20,000 ids, and a 21k delete
  failed silently)

## 1. Version control

Nothing keeps earlier versions yet. Annotation and cell count edits are last
write wins, a delete removes the row, and once something's overwritten it's
gone. The Yjs history for a label or notes box is dropped when the last
person closes it.

### The steps, in order

Each one builds on the one before.

| # | Step | What it means here | Size |
|---|------|--------------------|------|
| 1 | Soft delete | A delete sets `DeletedAt` instead of removing the row. Also gives an undo after the 8s window has passed | medium |
| 2 | History log | One row per change: what, who, when, before and after, and which change set it was part of. This is the "user log" too - who did what is in it, so it doesn't need a store of its own | large |
| 3 | Periodic snapshots | The whole collection's state saved every so often, so rolling back far doesn't mean replaying every change | medium |
| 4 | Viewing history | A timeline per annotation or count in its Saved row, and one for the whole collection | medium |
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
- **Change sets, not just rows.** A bulk delete of 21k annotations should be
  one entry you can undo in one go, not 21k separate ones. Give every request
  a change set id (like a commit) and log each row under it. A Select tab
  recolour, a group merge and an import are each one change set.
- **Log the change, the state, or both.** Logging every change (event
  sourcing) gives a full history, but rebuilding a state means replaying it.
  Saving whole states is quick to read but large. Both - changes plus a
  snapshot every N changes - is what games replays and most version control
  systems do.
- **Database support.** Postgres has no built-in system-versioned (temporal)
  tables, so it's a history table written by annotation-store in the same
  transaction as the change - or a trigger. Doing it in the app keeps who did
  it and the change set id without extra work.
- **Soft delete knock-ons.** Every query has to skip deleted rows: the Saved
  lists, `/total`, facets, export, the map's load. An EF Core global query
  filter (`HasQueryFilter`) does that in one place. It also needs a purge rule
  (how long deleted rows are kept) and a decision on what deleting a group
  does to its annotations' history.
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

## 3. Guest accounts and small vs large sessions

Needs decisions before any code.

**The idea:**

- Small and large sessions as their own area
- **Small** - works as now: everyone signed in, everyone can edit, no
  guests. Capped at about 6 people
- **Large** - past the cap, it turns into a large session. Extra people,
  and any guests, are view only

**Already there:** `CollectionRole { Viewer, Editor, Owner }` in
[CollectionMember.cs](../annotation-store/Collections/CollectionMember.cs),
so read only exists. Nothing for guests yet (see [auth.md](auth.md)).

**Guest identity - leaning towards:**

- A random id and a made up name like "Guest 4821"
- Not letting guests type their own name - avoids the ethics problem of
  people putting in real names
- Guests are always `Viewer`

**Open questions:**

- Do guests get a Keycloak account, or a short-lived token from our own
  service? Ask before building
- Does a large session ever go back to small?
- When it turns large, which 6 stay editors - the first 6 in, or the host
  picks?
- Can the host make a guest an editor?
- Is 6 the right cap? Measure it rather than guess

## 4. Showing other people's viewports on hover

Everyone's viewport box is already drawn all the time
([MapNode.tsx](../image-viewer/src/components/MapNode.tsx), from the hub's
`Viewport` in
[Messages.cs](../realtime-hub/Slides/Messages.cs)). With a large session
that's a lot of boxes. Instead: show a person's box when you hover their
name in the people list, and maybe keep "always show" as a toggle. Small to
medium. Games parallel: a minimap showing where your teammates are.

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
- Guest identity - Keycloak or our own tokens (section 3)

## Suggested order

1. Ask the questions in section 9 - free, and unblocks section 3
2. Soft delete, then the history log
3. Hover viewports - quick and visible
4. Guests and small vs large sessions, once the answers are in
5. History view, rollback, then the editing policy and its evaluation
6. Own WebGL drawing and dark mode if there's time
