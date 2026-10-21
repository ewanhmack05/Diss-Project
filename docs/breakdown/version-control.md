# Version control breakdown

Version control is the dissertation's focus: every change to a collection
is kept, said who made it, and can be taken back. It isn't one service. It
runs through annotation-store (what's kept and how it comes back), the
viewer (the History tab, Undo, live updates) and realtime-hub (telling
everyone else). This page follows it across all three. The per-service
breakdowns have the detail for each part, and
[todo.md](../todo.md#1-version-control) has the plan and the decisions
still to make.

## Contents

1. [Where it's up to](#1-where-its-up-to)
2. [How the pieces fit](#2-how-the-pieces-fit)
3. [Change sets](#3-change-sets)
4. [The history area](#4-the-history-area)
5. [Putting a change back](#5-putting-a-change-back)
6. [In the viewer](#6-in-the-viewer)
7. [Who can put things back](#7-who-can-put-things-back)
8. [Test data](#8-test-data)
9. [Tests](#9-tests)
10. [What's next](#10-whats-next)
11. [Known gaps](#11-known-gaps)
12. [Files](#12-files)
13. [Glossary](#13-glossary)

## 1. Where it's up to

The steps from [todo.md](../todo.md#the-steps-in-order), each building on
the one before:

| # | Step | State |
|---|------|-------|
| 1 | Soft delete | Done, then replaced by step 2 - every write is in a change set, and a change set can be put back any time |
| 2 | History log | Done in the store - a `history` schema, apart from the data, with what every change did to every row: a delete keeps the whole row, an edit the columns it changed, before and after. The live tables only hold what's there now. Not shown in the viewer yet |
| 3 | Periodic snapshots | Not started |
| 4 | Viewing history | Mostly done - the collection's timeline is the History tab, and opening a change shows what it changed, from and to. A timeline per annotation or count is next |
| 5 | Rollback | Mostly there - putting a change set back brings back what it deleted and undoes what it changed, unless someone's changed it since. Putting one row back to a point in time isn't built |
| 6 | Policy for two people editing at once | Not started - still last write wins |
| 7 | Evaluate it | Not started |

What works today, end to end: delete 21,000 annotations in one go, see it in
the History tab as one change, and put it all back days later - for
everyone in the session, live. Delete a group and put it back, and what was
in it goes back in. Every edit's before and after is kept, and opening it in History shows
each field from and to. What doesn't yet: a timeline for one annotation (see
[What's next](#10-whats-next)).

## 2. How the pieces fit

```mermaid
flowchart LR
  subgraph Viewer
    S["Select tab<br/>bulk delete + Undo"]
    H["Collections > History<br/>list, detail, Put back"]
    C["Contexts<br/>annotations, counts,<br/>groups, adjustments"]
  end
  A["annotation-store<br/>change sets, history,<br/>restore"]
  P[("Postgres<br/>public: what's there now<br/>history: ChangeSets + Entries")]
  R["realtime-hub<br/>relays ops"]
  O["Everyone else<br/>in the session"]

  S -- "bulk-delete<br/>Change-Set-Id" --> A
  S -- "restore (Undo)" --> A
  H -- "GET /changesets<br/>POST restore" --> A
  A --> P
  A -- "rows put back" --> H
  H --> C
  C -- "create op per row" --> R
  R --> O
```

- **annotation-store owns it all.** It decides what a change set is, writes
  the history with every save, and puts things back from it. The viewer never
  works out what to restore - it asks for a change set to be put back and is
  told what came back.
- **One API, two areas.** History is its own schema with its own tables,
  but annotation-store is the only way in. A second service with its own
  database would need its own copy of who can see what, couldn't put
  something back in one transaction, and could fall behind - see
  [Why not a separate service](#why-not-a-separate-service).
- **realtime-hub is only a relay.** It doesn't know about change sets. Whoever
  puts something back sends a create op per row, the same as an import, and
  the hub passes them on.
- **No polling.** The viewer doesn't watch for other people's restores; their
  create ops arrive live, and anything that wrote without telling realtime
  shows up on the next refetch.

## 3. Change sets

A change set is one change someone made, like a commit or a Perforce
changelist. It's a row in `history.ChangeSets`
([ChangeSet.cs](../../annotation-store/History/ChangeSet.cs)):

| Field | What it is |
|-------|------------|
| `Id` | A GUID - chosen by the client, or made by the store |
| `CollectionId` | The collection it was made in |
| `UserId`, `UserName` | Who made it, from their token |
| `What` | What the first request in it did |
| `Created` | When |

- **Every write makes one.** Annotations, groups, cell counts, image
  adjustments, an import and deleting a collection all go through
  `ChangeSetAsync` in
  [ChangeSets.cs](../../annotation-store/History/ChangeSets.cs) once the
  access check and validation have passed, so a turned-down write leaves no
  change set behind.
- **Several requests can be one change.** A request can send a
  `Change-Set-Id` header. Every batch of a 21k bulk delete goes with the same
  id ([bulk.ts](../../image-viewer/src/components/annotation/bulk.ts)), so
  it's one change to read and one to put back. The response always says
  which change set it went in.
- **One person, one collection.** An id already used by someone else, or in
  another collection, is a 400.
- **Batches at the same moment.** The viewer sends batches all at once, so
  two can try to make the same change set together. The second insert fails
  on the primary key and reads the first one's instead.
- **What a change can be.** `add`, `change` and `delete` for an annotation,
  a group, a cell count and an image adjustment, plus `change annotations`
  and `delete annotations` (bulk), `merge groups`, `import`,
  `delete collection` and `restore`. Renaming a collection, sharing, ending a
  session, members and invite links aren't logged - they aren't the data
  being versioned.

## 4. The history area

```mermaid
flowchart LR
  subgraph public["public - what's there now"]
    A[Annotations]
    G[AnnotationGroups]
    C[CellCounts + RegionsOfInterest]
    I[ImageAdjustments]
    L[Collections]
  end
  subgraph history["history - everything that happened"]
    S[ChangeSets]
    E[Entries]
  end
  W["every write"] --> public
  W -- "same transaction" --> history
  S --- E
```

- **An entry is what one change did to one row** (`history.Entries`): which
  row, create, update or delete, and `Before` / `After` as `jsonb`.
  - **Delete:** `Before` is the whole row, so it can be put back. A merged
    group's delete also says where it went (`MergedInto`).
  - **Update:** just the columns that changed, before and after - a recolour
    of 20,000 shapes is 20,000 small entries, not 20,000 copies of GeoJSON.
  - **Create:** nothing. The live row has it, or a later delete's copy will.
- **Written with every save.** The context's `SaveChanges` reads EF's change
  tracker and writes the entries in the same transaction as the change
  ([HistoryLog.cs](../../annotation-store/History/HistoryLog.cs)), for
  annotations, groups, cell counts, ROIs and image adjustments. A versioned
  row changing outside a change set throws, so nothing can change without
  its history.
- **Bulk changes in bulk.** Up to 20,000 annotations at once go through
  [AnnotationBulk.cs](../../annotation-store/History/AnnotationBulk.cs):
  before values in one query, the change in one statement, the history in
  one Postgres `COPY`.
- **The live tables only hold what's there now.** A delete takes the row
  out. No `Deleted` column, no query filter - nothing reading the tables has
  to remember to skip anything.
- **A collection is the exception.** It holds everything in it, so deleting
  one hides it (`Collections.Deleted`) rather than copying the lot into the
  history. Its owner can bring it back.
- **Moving off soft delete.** The `HistoryArea` migration turned every
  soft-deleted row into a delete entry, using Postgres' own `to_jsonb` - the
  same shape `HistoryLog` writes - then took them out of the live tables and
  dropped the columns. It can be run back down.
- **Nothing's purged.** History stays for good. A retention rule comes with
  the privacy question in
  [todo.md](../todo.md#things-to-decide-before-building).

### Why not a separate service

The cleanest-looking split is a history service with its own database, fed
events by annotation-store. It was ruled out because the two would share
data they both need:

- **Who can see it.** Only annotation-store knows members, roles, guests and
  ended sessions. History would have to ask it every time, or keep a copy
  that goes stale - someone taken out of a session could still read it.
- **Putting back crosses the line.** The old rows would be in one service
  and the live ones in the other, so a restore could half happen.
- **It drifts.** Events need an outbox, de-duplicating and ordering, and
  history would be a moment behind - delete something, open History, and
  it isn't there yet.
- **Reads that need both.** "300 still deleted" depends on what's live now,
  and two databases can't be joined.
- **Two copies of an annotation's shape.** Old entries keep the shape from
  when they were written, and the other service can't see the migrations.

A schema of its own, behind the one API and written in the same
transaction, keeps the separation without any of that. `HistoryLog` is the
seam if it ever needs to be split out.

More in [annotation-store.md section 11](annotation-store.md#11-history-and-change-sets).

## 5. Putting a change back

`POST /changesets/{id}/restore` puts it back how it was before that change.

```mermaid
sequenceDiagram
  participant B as Bob's viewer
  participant A as annotation-store
  participant P as Postgres
  participant H as realtime-hub
  participant C as Carol's viewer
  B->>A: POST /changesets/c1/restore
  A->>P: INSERT history.ChangeSets c2 "restore" (Bob)
  A->>P: rows c1 deleted - INSERT back from their entries
  A->>P: columns c1 changed - set back, if nobody's changed them since
  A->>P: history.Entries for c2
  A-->>B: { counts, annotations, groups, cellCounts, imageAdjustments, changedAnnotations }
  Note over B: back on the map and in the Saved lists
  B->>H: create op per row, update op per changed annotation
  H->>C: the same
  Note over C: back for Carol too
```

- **Rollback, not undo.** Any editor can put back anyone's change, and the
  restore is a change of its own - "Put back a change" in the History list,
  made by whoever did it.
- **What comes back.** Every row the change deleted, unless it's back
  already. And every column it changed on a row that's still here - but only
  if it's still what the change made it, so a later edit is never undone.
- **So groups work.** A deleted group comes back with what was in it (the
  delete ungrouped them, and each of those is an update to put back). A
  merge put back takes back what was moved. An annotation whose group has
  gone since comes back ungrouped, or in the group it was merged into.
- **It answers with the rows.** How many of each came back, the rows
  themselves as the reads give them (cell counts without their dots), and
  `changedAnnotations` - ones that were already there and went back how they
  were. The viewer shows them and tells everyone else without loading
  anything again.
- **One transaction.** All of it comes back or none of it does.
- **Again is harmless.** Putting back something already back answers zeros
  and empty lists - someone else got there first.
- **Turned down:** a viewer or guest (403), someone not in the collection or
  a change set that doesn't exist (404), an ended session (409), and a
  personal collection whose owner has a newer one for that slide (409).
- **How long.** 20,000 annotations put back take about 5 seconds on
  Postgres 17 in Docker - the rows are rebuilt from their entries in the
  database, not sent through the app. Soft delete flipped a column instead,
  which was quicker; keeping deleted rows out of the live tables costs that.

## 6. In the viewer

### Undo on a bulk delete

The Select tab's delete asks first, takes them off the map, and sends the
delete straight away as one change set. The toast's **Undo** (8 seconds)
puts that change set back. The delete isn't held back for the 8 seconds any
more - it's in annotation-store at once, with its history, so closing the
tab during the toast doesn't lose it. After the toast's gone, the History
tab can still put it back. See
[image-viewer.md](image-viewer.md#the-select-tab---many-at-once).

### The History tab

In the Collections panel, for the collection you're in.

- **The list** - one line a change, newest first, under day headings (Today,
  Yesterday, then the date): an icon for the kind of change, what it did
  ("Deleted 2,140 annotations"), the person's initials and the clock time.
  A red bin marks a delete that still has something to put back. Paged 50 at
  a time with the Saved lists' pager. **Filter** narrows it to who made the
  change, the kind (added, changed, deleted, merged, imported, put back) and
  when, with the Saved lists' filter popout; **Newest first / Oldest first**
  turns it round.
- **The detail** - clicking a row opens it in place of the list: who, when to
  the second and how long ago, what's still deleted, the change set's id,
  and **what changed** - each field from and to ("Label  Region 4 ->
  Region 4 (checked)", colours as swatches, groups by name), many rows as
  one line ("10 annotations", the colours they started as -> the one they
  went to), and what it deleted by name.
  **Put back** and **Cancel** are there for editors, with a line saying what
  will happen. This page is the confirm - there's no popup. Once put back it
  stays open and says so.
- **After a restore** the rows go back into the annotation, cell count, group
  and adjustment contexts (an annotation already there is replaced, so it
  moves back into its group), the Saved lists refetch, everyone else gets a
  create op per row and an update for each changed one, and a toast says
  what came back.

See [image-viewer.md](image-viewer.md#history---putting-deletes-back) for
how it's built.

### Small things that had to change for it

- Someone else's create op clears that id from your deleted ids - otherwise
  the Saved list kept hiding a row that had been put back.
- The Select tab forgets annotations once they're deleted, so putting them
  back doesn't pick them again.
- `POST /collections/ensure` hands back the other request's collection when
  two arrive together, instead of a 500 - the viewer's first load can send
  two.

## 7. Who can put things back

Any editor, for anyone's change. The other option is only the person who
made it plus the host. It's still to be decided (see
[todo.md](../todo.md#things-to-decide-before-building)), so it's kept to one
check each side:

- the viewer's `canRestore` in
  [history.ts](../../image-viewer/src/components/collections/history/history.ts)
- the Editor check on `POST /changesets/{id}/restore` in
  [ChangeSets.cs](../../annotation-store/History/ChangeSets.cs)

## 8. Test data

[seed_history.py](../../scripts/seed_history.py) makes a session called
"History test" on the slide, with about 20 changes from alice, bob and carol
over the last four and a half days: an import, adds, a recolour, edits,
groups made, merged and deleted, cell counts, a bulk delete that's put back
and one that isn't. Five still have something to put back.

The changes go through the API, so the change sets are real. The store
stamps them all as now, so the script then moves them - and the history's
copies of rows deleted since - back in Postgres with `psql`, and reads the oldest one back through the API to check it landed in
the store's database. See the
[scripts README](../../scripts/README.md#history-test-data).

## 9. Tests

| Where | Tests | Covers |
|-------|-------|--------|
| annotation-store `HistoryTests` | 38 | A delete leaves the live table and keeps the whole row, an edit keeps only what changed, a create copies nothing, nothing versioned changes outside a change set, no history columns on the live tables. Batches in one change set (and at the same moment, Postgres only). Restore - its own change set only, editors only, collections by their owner, answers with the rows, a group back with what was in it, a recolour undone but never a later edit, a count back with its dots and ROI, an annotation following a merged group, ten restores at once putting it back once (Postgres only). What a change did, from and to. A row deleted again later belonging to the later delete. Narrowing by person, kind and date, oldest first, the facets. Who and what on every write, header rules, the list and total |
| annotation-store `HistoryMigrationTests` | 1 | Postgres only: soft-deleted rows become delete entries that rebuild exactly, and go back on the way down |
| annotation-store `CollectionsTests` | 1 of 19 | 20 ensures at the same moment all get the one collection (Postgres only) |
| annotation-store `PostgresPoolTests` | 1 | Every test class's connections fit in a stock Postgres |
| viewer `changes.test.ts` | 14 | From and to for every kind of field - text, (empty), colours, groups by name, flags, numbers, image adjustment settings one by one - many rows on one line, deletes by name |
| viewer `history.test.ts` | 26 | Labels for every kind of change, icons, initials, what's still deleted, who can put back, toast and note wording, day grouping, the ops sent to everyone else (creates, and updates for changed annotations) |
| viewer `bulk.test.ts` | 13 | Batches, one change set id per change, Undo only after the delete's in |
| viewer `savedDates.test.ts` | 15 | Day headings by the calendar, times, "12 minutes ago" |
| viewer `paging.test.ts` | 1 of its tests | The History list's page and total URLs |
| scripts `test_seed_history.py` | 13 | The story's order, the SQL that moves it back (history's copies included, nothing touching the old soft delete columns), reading the connection string |

The Postgres-only tests are the ones SQLite can't show: requests at the
same moment, and the real migrations. CI runs the store's suite on both.

## 10. What's next

The history has what the next pieces need; they're mostly the viewer now.

- **One row per edit.** The edit forms autosave every 500ms pause, each its
  own change set. An open form should send one `Change-Set-Id` for the whole
  edit, so it's one History row - before is when it opened, after when it
  closed.
- **A timeline per annotation or count** - the other half of step 4. Every
  entry for one row, by `CollectionId`, `Entity` and `EntityId` (indexed).
- **Putting one row back to a point in time** - step 5's other half.
- **Snapshots** (step 3), if replaying entries for a big collection gets
  slow.

The decisions still open - where the order comes from, text fields,
privacy - are listed in
[todo.md](../todo.md#things-to-decide-before-building), along with the
policies for two people editing the same thing (step 6) and the games
parallels for the write-up.

## 11. Known gaps

- **Changes from before history was kept** show "Nothing was recorded for
  this change" - soft delete only kept deletes.
- **Autosaves flood the list.** Every pause while typing in an edit form is
  its own "Changed an annotation" row.
- **A restore can't be put back.** It reverts deletes and updates, and the
  rows a restore brings back are creates, which aren't undone.
- **A column added later.** An old delete's copy of a row won't have a column
  added since - a new non-null column needs a default.
- **Putting back 20,000 takes about 5 seconds**, where soft delete was
  near-instant.
- **Nothing is purged**, and change sets and entries keep names, user ids and
  whole rows for good.
- **Not logged:** renaming a collection, sharing, ending a session, members
  and invite links.
- **The hub doesn't check ops against the store** - it trusts the viewer to
  have saved, or restored, before telling everyone.

## 12. Files

| File | What's in it |
|------|--------------|
| [annotation-store/History/ChangeSet.cs](../../annotation-store/History/ChangeSet.cs) | `ChangeSet`, `HistoryEntry`, `HistoryOp` |
| [annotation-store/History/HistoryLog.cs](../../annotation-store/History/HistoryLog.cs) | Writes history from every save, the `COPY` writer, rebuilding a row from its entry, reverting an update |
| [annotation-store/History/AnnotationBulk.cs](../../annotation-store/History/AnnotationBulk.cs) | Deleting and changing up to 20,000 annotations with their history |
| [annotation-store/History/ChangeSets.cs](../../annotation-store/History/ChangeSets.cs) | `ChangeSetAsync`, `GET /changesets`, `/total`, restore |
| [annotation-store/History/ChangeSetChanges.cs](../../annotation-store/History/ChangeSetChanges.cs) | `GET /changesets/{id}/changes` - what one change did, grouped |
| [annotation-store/Annotations/AnnotationDbContext.cs](../../annotation-store/Annotations/AnnotationDbContext.cs) | The `history` schema, and the save that writes history with every change |
| [annotation-store/Migrations/20261021133213_HistoryArea.cs](../../annotation-store/Migrations/20261021133213_HistoryArea.cs) | The history schema, and moving soft-deleted rows into it |
| [image-viewer/src/components/annotation/bulk.ts](../../image-viewer/src/components/annotation/bulk.ts) | Batches, one change set per bulk change, Undo |
| [image-viewer/src/components/collections/history/](../../image-viewer/src/components/collections/history) | History list, detail, icons, the restore hook and the plain logic in `history.ts` |
| [image-viewer/src/components/saved/savedDates.ts](../../image-viewer/src/components/saved/savedDates.ts) | Day headings, times, how long ago |
| [image-viewer/src/context/](../../image-viewer/src/context) | `addRestored` on the annotation, cell count, group and adjustment contexts |
| [scripts/seed_history.py](../../scripts/seed_history.py) | The test history |

## 13. Glossary

- **Change set** - one change someone made, as a row in `history.ChangeSets`.
  Its entries say what it did to each row.
- **History entry** - what one change did to one row: the whole row for a
  delete, the changed columns before and after for an edit.
- **Restore / put back** - undoing one change set: what it deleted comes
  back, and what it changed goes back if nobody's changed it since. The UI
  says "put back".
- **Undo** - the toast's button on a bulk delete: a restore of that change
  set, offered for 8 seconds.
- **Rollback** - putting something back how it was, whoever changed it.
  Restore is rollback; Undo is the same thing offered straight after.
- **Soft delete** - what step 1 did: hiding a row instead of removing it.
  Replaced by the history schema - only collections are still hidden.
