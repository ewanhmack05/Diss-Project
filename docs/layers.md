# Layers - the On the map tab

**Status: phases 1 to 3 built** on branch `layers` - the tab, its header,
People and Groups chips, the Collections tab, Show all clearing the Saved
list, the dot on the Collections button, group pages opened from the chips,
and the Select tab cut down to picking. What was built differently from this
design is in [Built so far](#built-so-far). Phases 4 and 5 are still design. Two choices are made: it's a tab in the Collections panel, not a new
panel, and its layout is compact chips. Phase 1 went with the recommendation
on [open decisions](#8-open-decisions) 1, 4, 8 and 9.

One tab that answers two questions the viewer has no single answer to today:
**where am I working**, and **why is this on the map, or not**.

## Contents

1. [What gets better](#1-what-gets-better)
2. [What's confusing today](#2-whats-confusing-today)
3. [Words](#3-words)
4. [The On the map tab](#4-the-on-the-map-tab)
5. [The rules](#5-the-rules)
6. [What moves where](#6-what-moves-where)
7. [How it's built](#7-how-its-built)
8. [Open decisions](#8-open-decisions)
9. [Phases](#9-phases)
10. [For the write-up](#10-for-the-write-up)
11. [Verification log](#11-verification-log)

## 1. What gets better

- **Every reason an annotation is off the map is shown in one place.** Today
  there are five, in three panels (below). After, there's one tab, and it says
  how many are on the map out of how many there are: "15 of 24 shown". When
  those two numbers differ, it says why.
- **Where new work saves is always one glance away**, at the top of the tab,
  not split between the Collaboration and Collections panels.
- **Other people's shared collections can be laid over yours** without leaving
  your own - the Cytomine "layer per user" idea across collections, not just
  inside one.
- **No new toolbar button.** The toolbar already has ten panels. This goes
  into the Collections panel, and the panel keeps three tabs.

Measured by:

- Controls that change what's drawn: 5 places in 3 panels, down to 1 tab.
- The "N of M shown" line is computed from the same `isShown` check the map
  uses ([layers.ts](../image-viewer/src/components/collections/map/layers.ts)),
  so it's a test target: for any mix of hidden groups, people and a Saved
  filter, the line and the map's feature count must match.
- A short task check with a tester: "Bob says he drew a box near the vessel
  and you can't see it - find out why." Count the clicks before and after.

## 2. What's confusing today

**What's drawn depends on five things, each with its own rules:**

| Control | Where | Lasts | In the code |
| --- | --- | --- | --- |
| Which collection is active | Collaboration (start, reopen, join) and Collections (open, view, rejoin) | Until you switch | `open`, `leaveSession` in [CollectionContext.tsx](../image-viewer/src/context/CollectionContext.tsx) |
| The Annotations panel being open | Toolbar | While it's open | `annotationsVisible` in [MapNode.tsx](../image-viewer/src/components/MapNode.tsx) |
| Hidden groups | Annotations > Select | While Select is open | `hiddenGroupIds` in [AnnotationGroupContext.tsx](../image-viewer/src/context/AnnotationGroupContext.tsx) |
| Hidden people | Annotations > Select | While Select is open | `hiddenPeople`, same file |
| Saved list search and filters | Annotations > Saved | While Saved is open | `mapFilter`, set by [SavedAnnotationList.tsx](../image-viewer/src/components/annotation/Saved/SavedAnnotationList.tsx) |

Three of them undo themselves when you change tab, so something can vanish
and come back without the person touching it.

**Nothing where you draw says which collection you're in.** The Annotations
panel never names it. Since the "Working in" picker went, the only clue is
what's on the map.

**One kind of thing has three names and two homes.** A session, your own
collection and someone's shared collection are all rows in `Collections`
(`Kind` is `Personal` or `Session`). In the viewer they're "Mine", "Sessions"
and "Shared with everyone" in the Collections panel, and "your session" in the
Collaboration panel.

**Groups live in a picking tool.** The group list and group pages sit on the
Select tab, so viewers get a Select tab that's really a groups list.

## 3. Words

The data keeps its names. What the viewer says changes:

| Thing | Says now | Would say |
| --- | --- | --- |
| Your personal collection | "Mine", "your collection" | **Your own** |
| A session | "Alice Moore's session", "Sessions" | **Session: name** - unchanged, it's already clear |
| Someone's shared personal collection | "Shared with everyone" | **Name's own** |
| Any of the above | "collection" | **collection** - still the umbrella word, and the panel's name |

## 4. The On the map tab

The Collections panel's tabs become **On the map**, **Collections** and
**History**. On the map is first and opens by default. Like the panel's tabs
today, it's your own state: never shared, and Present doesn't follow it.

```text
┌ Collections ─────────────────────────────┐
│ On the map │ Collections │ History       │
├──────────────────────────────────────────┤
│ Session: Ward round            [Switch]  │
│ New annotations save here                │
│ ██████████████████░░░░░░░░░░             │
│ 15 of 24 shown · 9 by people   Show all  │
├──────────────────────────────────────────┤
│ PEOPLE                                   │
│ (You 4) ( Alphonse 9 ) (Winry 7)         │
├──────────────────────────────────────────┤
│ GROUPS                                   │
│ (Tumour margin 6) (Vessels 3) (None 6)   │
├──────────────────────────────────────────┤
│ OVER THIS                                │
│ ( Bob's own 12 ) ( Carol's own 5 )       │
└──────────────────────────────────────────┘
  (filled) = on the map   ( plain ) = off
```

### The header

- **The active collection's name** and **Switch**. Switch opens the same list
  the Collections tab shows - your own, sessions you're in, shared ones - and
  picking one calls the same `open()`. Starting and joining sessions stay in
  Collaboration.
- **"New annotations save here"**, or "View only - you can't add here" when
  you're a viewer or the session has ended.
- **The bar**: the share of the active collection's annotations on the map.
- **"N of M shown"**, then the biggest reason when N < M ("9 by people", "6 by
  groups", "narrowed by Saved"). Hovering or focusing the line lists every
  reason. **Show all** puts every chip back on and clears the Saved filters.

### Chips

Each chip is a toggle button: filled when it's on the map, plain when it's
off, with its count.

| Gesture | Does |
| --- | --- |
| Click (or Enter, Space) | Hide or show it |
| Double-click (or Shift+Enter) | Only this one in its row - every other chip in the row goes off. Again puts the row back |
| Right-click (or the context menu key) | A small menu: Only, Show all in this row, and for groups Open group |

- **People** - "You" first, then by name, then "Before sign-in" if there are
  any, from today's `peopleIn`.
- **Groups** - by name, then **None** for annotations in no group, so those
  can be hidden too. Today they can't.
- **Over this** - other collections you can open on the slide, off to begin
  with. Turning one on draws it under yours, faded and dashed. Read only, not
  in the counts above, and not pickable.
- **Lots of chips** - a row shows as many as fit on two lines, then "+5 more",
  which opens the rest in place. Sessions are capped at a handful of editors,
  so People rarely gets there; Groups might.

### Docking

It's the shortest of the three layouts drafted. Docked left or right it's
about two-thirds the height of a stacked list. Docked top or bottom, where
panels get 21em, the header and People and Groups fit; Over this scrolls.

Guests get the header (their one session, no Switch), People and Groups. No
Over this - a guest's token only opens their session.

## 5. The rules

1. **Hidden lasts until you switch collection.** Not until a tab closes.
   Switching collection resets the chips and Over this, since they were about
   the old one. A reload resets them too (in memory only).
2. **Something off the map is never silent.** The tab always shows it, and
   when the panel's closed and N < M, the Collections toolbar button gets a dot.
3. **Saved filters still narrow the map, and say so.** The Saved list keeps
   doing it - finding something by search and seeing it alone on the map is
   useful - but the tab names it, and Show all clears it.
4. **Annotations are drawn while Annotations or Collections is open.** Today
   it's only Annotations. With On the map open you're looking at what's on the
   map, so hiding them then would be odd.
5. **Hidden things can't be picked.** As now - hiding takes them out of what's
   picked, and All, box and lasso only see what's shown.
6. **Overlays are snapshots.** They load when turned on and when the tab
   opens, with a refresh button in the Over this heading. They aren't live:
   someone working alone in their own collection has no realtime room to hear
   from (see [section 7](#overlays)).

## 6. What moves where

| From | To | Why |
| --- | --- | --- |
| Collections > Mine | Collections > Collections, top section "Your own" | Mine and Shared were both lists of collections |
| Collections > Shared (Sessions, Shared with everyone) | Collections > Collections, sections "Sessions" and "Shared with you" | Same |
| Groups list - Annotations > Select | Collections > On the map, Groups chips | It's about what's shown, not what's picked |
| People list - Annotations > Select | Collections > On the map, People chips | Same |
| Group pages - from Select | Opened from a group chip's menu | Same page, new door |
| "Add to group" on a group row - Select | Stays on Select, as a "Group…" picker next to Recolour | Putting picked things in a group is a picking action |
| Group "Select" (pick all in a group) | Stays on Select, as "Pick a group…" | Same |
| Which collection you're in - only in Collaboration and Collections | Collections > On the map header | One glance away |
| Collaboration > start, join, invite, roles, navigation | Stays | The live session |
| History | Stays, third tab | Unchanged |

Select becomes only picking and changing many at once. Viewers, who can't
pick, lose the Select tab and use On the map.

## 7. How it's built

Viewer only for phases 1 to 3. No annotation-store or realtime-hub change
until phase 5.

### State

A `LayersContext` takes over what's in `AnnotationGroupContext` now:
`hiddenGroupIds`, `hiddenPeople`, `togglePerson`, `setHiddenPeople`,
`showAll`, plus the overlay picks and a hidden flag for "no group".
`AnnotationGroupContext` goes back to being about groups' data. The reset
moves from "Select tab unmounts" (`SelectTab.tsx`'s effect calling
`showAll`) to "collectionId changes".

`isShown` grows into one function the map, the "N of M" line and the pick
actions all call, taking the hidden sets and the Saved `mapFilter`, so the
three can't disagree. The reasons for the line come from the same pass.

"Only this one in its row" is `onlyShowing` and `isOnlyShown` in
`layers.ts`, which work for any row of chips.

### The tab

`CollectionsTab` in
[CollectionsPanel.tsx](../image-viewer/src/components/collections/CollectionsPanel.tsx)
goes from `"mine" | "shared" | "history"` to `"map" | "collections" |
"history"`, starting on `"map"`. One `Chip` component for all three rows:
a `button` with `aria-pressed`, the count inside it, and the double-click,
Shift+Enter and context menu handlers.

### Map

- **Your collection** - the existing saved-annotations WebGL layer, unchanged
  apart from rule 4's visibility.
- <a id="overlays"></a>**Overlays** - one more `WebGLVectorLayer` for all of
  them together, features tagged with their collection, drawn under yours with
  a faded, dashed style. One layer, not one per collection: each WebGL layer
  holds its own GL context and browsers allow about 16 (the comment on the
  map's teardown in `MapNode.tsx` says the same).
- Loading an overlay is `GET /annotations?collectionId=` - it only needs
  Viewer, and `RoleAsync` in
  [CollectionAccess.cs](../annotation-store/Collections/CollectionAccess.cs)
  already gives Viewer on any shared personal collection. No store change.
- Live overlays would need the hub to send a collection's ops to people not
  in its room. Not in this design; snapshots plus refresh first.

### Size of the change

Large: two panels change, a new context, a behaviour change, and the
Collections panel's tabs are rebuilt. No contract change in phases 1 to 4.

## 8. Open decisions

| # | Question | Recommendation | Other option |
| --- | --- | --- | --- |
| 1 | How long does hiding last? | Until you switch collection | Until the panel closes (today's rule, moved here) |
| 2 | Do Saved filters still narrow the map? | Yes, and the tab says so | No - list only, map untouched |
| 3 | ~~A new panel, or a tab in Collections?~~ | **Decided: a tab in Collections** | - |
| 4 | Annotations drawn with only Collections open? | Yes (rule 4) | No - Annotations panel still decides |
| 5 | Viewers lose the Select tab? | Yes, everything they had there is in On the map | Keep it, read only |
| 6 | Overlays in phase 4, or later? | Phase 4 - it's the part that adds something new, not just tidying | After the write-up, as future work |
| 7 | ~~Layout of the tab~~ | **Decided: compact chips** | Stacked sections, outliner tree |
| 8 | Keep the panel's name, "Collections"? | Yes - people know where it is, and it's the umbrella word | "Layers", which fits the first tab better |
| 9 | Double-click for "only this one"? | Yes, with Shift+Enter and the right-click menu as the ways that can be found | Right-click menu only |

## 9. Phases

Each phase ships with its tests, and leaves the viewer working.

1. **Built.** **On the map tab with the header, People and Groups.** `LayersContext`;
   `Chip`; Groups and People move out of Select; Mine and Shared merge into
   the Collections tab; reset on collection switch; "None" chip for ungrouped.
   Tests: `isShown` and the "N of M" reasons for every mix of hidden groups,
   people, "None" and a Saved filter; "only this one" for any row; reset on
   switch.
2. **Built.** **Saved filter shown on the tab**, cleared by Show all, and the dot on the
   toolbar button. Tests: the reason appears and clears; the dot follows N < M.
3. **Built.** **Select tidied** - "Group…" and "Pick a group…" pickers, viewers lose the
   tab, annotations drawn while Collections is open. Tests: picking skips
   hidden ones, as now.
4. **Over this** - one WebGL layer, read only, faded and dashed, snapshot plus
   refresh. Tests: overlay features never pickable and never in the counts;
   one layer whatever the number of overlays.
5. **Later: copy from an overlay into yours** - a change set with a `Source`
   saying which collection it came from, the same record
   [messaging](messaging.md#where-it-came-from) keeps for "add from message".
   This is the one that touches annotation-store.

### Built so far

Phases 1 to 3, plus rule 4 brought forward. Where it differs from the design above:

| Design said | Built | Why |
| --- | --- | --- |
| Switch opens a list of collections | Switch goes to the Collections tab | Opening one has rules - Rejoin, or View when a live session's empty, Reopen for the host - that live in `SharedCollectionList.tsx`. Going there keeps them in one place |
| Right-click menu has Only, Show all in this row, Open group | All three, Open group for named groups (not None) | As designed, from phase 3 |
| Rows show two lines of chips, then "+N more" | The first 12, then "+N more" | Simpler and predictable; a session rarely has 12 people drawing |
| Groups and People move out of Select | Done in phase 3. Add and Select became the "Add to a group…" and "Pick a group…" dropdowns; Send moved to the group page; Delete was already on it | Picking actions stay with picking, the rest with the group |
| Group pages open from the chip menu | And the Groups row says "Right-click a group to open it", or how to make one when there are none | Right-click alone is hard to find |
| The Collections button's title says how many are off the map | The title stays "Collections"; the count is on the dot's own tooltip and the button's `aria-description` | The recorder, and anyone else, finds toolbar buttons by their title |
| Rule 4 in phase 3 | Done now | Without it, chips toggled with the Annotations panel closed changed nothing you could see |
| Saved filter reason in phase 2 | Built in phase 1, with the count | It came free with the tally |

How it's put together:

- [layers.ts](../image-viewer/src/components/collections/map/layers.ts) - the
  pure part: `peopleIn`, `groupsIn` (with None), `isShown`, `onlyShowing`,
  `isOnlyShown`, `tally` and `reasons`. It replaced `Select/people.ts`.
- [LayersContext.tsx](../image-viewer/src/context/LayersContext.tsx) - which
  chips are off. Kept with the collection it's about and reset during render
  when that changes, so moving collection (and coming back) starts with
  everything on, with no render that still has the old ones off. `setRow`
  takes a function of the row as it is, because a double-click arrives
  straight after two clicks, before React has rendered either.
- [OnTheMapTab.tsx](../image-viewer/src/components/collections/map/OnTheMapTab.tsx) -
  the tab. The chip menu goes on the page through a portal, at the chip's
  place on screen, so the panel's edge can't cut it off.
- The Select tab takes hidden annotations out of what's picked when the chips
  change, and its **All** picks only what's shown.
- [useMapTally.ts](../image-viewer/src/components/collections/map/useMapTally.ts) -
  the one count both the tab and the toolbar's dot read, so they can't
  disagree. `offTheMap` in `layers.ts` words the button's title ("6
  annotations off the map").
- **Show all and the Saved list.** The Saved list's search and filters are its
  own state, so Show all can't reset them directly. `AnnotationStoreContext`
  has `clearSaved()`, which bumps `savedClears`; the open Saved list sees the
  new number and empties its search and filters, reset while rendering like
  the chips, so neither the list nor the map shows the old filters for a
  render. Show all only asks when the Saved list is narrowing the map.
- **The dot** is on the Collections button when something's off the map and
  the panel's closed - open, the tab says why itself. Same place as the
  Messages count, without a number.
- **The group page** is the same `GroupPage` as before, now opened by the On
  the map tab in place of its chips. **Select on map** picks the group's
  shown annotations (`shownInGroup` in `layers.ts`) and raises the
  Annotations panel on its Select tab. Picking is cleared on leaving Select by
  `useClearPickedOnLeave`, not when the tab unmounts - see the
  [viewer breakdown](breakdown/image-viewer.md#the-select-tab---many-at-once)
  for why.

Checked:

- 38 tests in `layers.test.ts`, including one that tries every mix of
  hidden people, groups and a Saved check and confirms the tally adds up and
  matches `isShown` exactly, four for the dot's wording and four for
  `shownInGroup`. The viewer's suite: 1088 pass.
- In the running viewer, as alice with three simulated people (9, 8 and 7
  annotations) and a group made through Select from "only Edward": click,
  real double-click, Shift+Enter, the right-click menu, Show all, picking
  only what's shown, hiding taking things out of what's picked, Switch, and
  everything back on after leaving the session and coming back.
- Phase 2, the same way: no dot with everything shown or with the panel open,
  a dot and "Collections - 6 annotations off the map" with it closed; a Saved
  search for "Rectangle" read as "3 of 18 shown · 9 by the Saved list", and
  Show all brought back all 18 and emptied the search box; a "Saved by" filter
  went from "Filter 1" back to "Filter" the same way.
- Phase 3, the same way: making a group from "only Alphonse"; Pick a group
  picking 5 and resetting; "Add 5" to it; hiding Edward dropping the picker to
  his group's shown count and his annotations out of what's picked; Open group
  from a real right-click; Select on map opening the Annotations panel in
  front with all 10 picked; Free Form and back, and closing the panel,
  clearing the pick; viewing read-only giving only Saved and a read-only
  group page with Send.
- Playback's scenes are rewritten for the new layout: Collections opens on On
  the map, groups are made and added to with the Select tab's dropdowns, and
  hidden, opened, renamed, merged and deleted from the Collections panel. Every
  `sam.did` id is kept. Playback's own tests pass (57).
  `node record.js --only annotation-groups` records it in 134s with all 21 of
  its features shown, Merge and Delete the group included. Recording needs
  Playwright's own ffmpeg (`npx playwright install ffmpeg`).

## 10. For the write-up

- **Overlays are looking at someone's branch without merging it.** A
  personal collection is close to a branch ([todo.md](todo.md#things-to-decide-before-building)),
  and Over this makes that visible: your branch on top, theirs under it, read
  only. Phase 5's copy, with its recorded source, is a merge with a parent -
  the version control argument made concrete.
- **Level editors already work this way.** Unreal's sublevels and Unity's
  additive scenes let a designer load other people's parts of a level around
  their own and choose what's shown, without owning them. Worth checking and
  citing before it goes in the dissertation - not yet checked against their
  documentation.
- **Cytomine 2013** is the prior work for a layer per user
  ([background.md](background.md#read-and-noted)).

## 11. Verification log

Checked against the code on branch `layers` before writing:

| Claim | Checked |
| --- | --- |
| Annotations drawn only while the Annotations panel is open | `const annotationsVisible = activeTools.includes("annotations")` in `MapNode.tsx` |
| Hidden groups and people reset when Select closes | `SelectTab.tsx` effect cleanup calls `clear()` and `showAll()` |
| Saved list narrows the map while open, and stops when it closes | `SavedAnnotationList.tsx` sets `setMapFilter`, and sets it to null on unmount |
| Annotations panel never names the active collection | No collection name or "session" in `AnnotationsPanel.tsx` |
| Collections panel tabs are Mine, Shared, History | `CollectionsTab` in `CollectionsPanel.tsx` |
| Ungrouped annotations can't be hidden today | `isShown` only hides by a group id, and the group list has no "no group" row |
| Panels docked top or bottom get 21em | `edgeSizeEm` in `dock.ts`, as [gallery.md](gallery.md#what-it-looks-like) records |
| The toolbar has ten panels | `ToolId` in `ToolbarContext.tsx` has ten ids |
| Reading another collection needs only Viewer | `GET /annotations` calls `RequireAsync(..., CollectionRole.Viewer)` in `annotation-store/Program.cs` |
| Shared personal collections give Viewer | `RoleAsync` in `CollectionAccess.cs` |
| About 16 WebGL contexts at once | The comment on the map's teardown in `MapNode.tsx` |
| Cell-count groups have no show or hide | No hidden state in `CellCountGroupContext.tsx` - so cell counts stay out of this design |

Not checked: the Unreal and Unity parallels in section 10, against their
documentation. Not measured: "about two-thirds the height of a stacked list"
in section 4 is from the mockups, not a built panel.
