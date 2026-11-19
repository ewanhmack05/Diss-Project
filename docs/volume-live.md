# Working together in 3D

A draft of what a live session does when someone's in the Depth tab's 3D
view. Phases 4 and 7 of [zstack.md](zstack.md#9-phases), worked out in
detail. **All six phases are built** (the slice live, who's in 3D, other
people's cameras, Follow and Present in 3D, look here in 3D, and markers) -
see [phase 1](#51-phase-1-built), [phase 2](#52-phase-2-built),
[phase 3](#53-phase-3-built), [phase 4](#54-phase-4-built),
[phase 5](#55-phase-5-built) and [phase 6](#56-phase-6-built).

## Contents

1. [Where it is now](#1-where-it-is-now)
2. [Why it matters for the dissertation](#2-why-it-matters-for-the-dissertation)
3. [What it does](#3-what-it-does)
4. [What goes over the hub](#4-what-goes-over-the-hub)
5. [Phases](#5-phases)
6. [How it's measured](#6-how-its-measured)
7. [Open questions](#7-open-questions)
8. [Verification log](#8-verification-log)

## 1. Where it is now

In 2D a session shares a lot:

- **Viewports.** Everyone's view box goes out about ten times a second
  (`VIEWPORT_THROTTLE_MS = 100` in `RealtimeContext.tsx`). Others see it as a
  box in your colour, and Follow and Present move them to it.
- **Sketches.** Whatever you're part way through drawing.
- **Ops.** Annotations and counts, saved and sent.
- **Screen.** Under Present, your panels, their tabs and your image
  adjustments.

Nothing about depth goes out at all, 2D or 3D:

- **The slice.** In 2D, `SliceContext` holds which slice you're on, and it
  stays on your machine. Under Follow you can be on the host's view box but
  on a different slice, looking at different tissue.
- **The 3D view.** It's yours alone. Your camera, the cut, opacity, how
  thick the block is, and whether you're in 2D or 3D at all - nobody else
  knows any of it.

So today a session on a volume isn't really shared: two people "in the same
place" can be looking at different things.

## 2. Why it matters for the dissertation

Depth is another dimension of the same shared state the project is about.
The 2D work showed that viewports, live edits and versioned changes can be
kept in step between people. A volume asks whether that still holds when
"where you are" is a slice and "what you see" is a camera you can turn
freely.

It's also the part closest to a game engine's editor:

- The 3D view is three.js, which is games tooling.
- Several people in one 3D scene, each with their own camera, seeing where
  the others are looking and jumping to them, is what a multi-user level
  editor has to solve. Unreal Engine's Multi-User Editing does it: each
  other user in your level shows as an avatar at their position and
  viewpoint, and the Connected Clients list has "Teleport to user's point
  of view". It has no continuous follow, only that one-off jump, so Follow
  and Present here go further. Its session also keeps every transaction,
  hands them to late joiners and lists them as change history, the same
  split as here: presence is live and dropped, edits are kept. Sources:
  [Multi-User Editing Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/multi-user-editing-overview-for-unreal-engine)
  (Presence, Session Change History) and
  [Getting Started](https://dev.epicgames.com/documentation/en-us/unreal-engine/getting-started-with-multi-user-editing-in-unreal-engine)
  (late joiners), both Unreal Engine 5.9, marked Beta.
- Cameras and cut planes are continuous, high-rate state, not documents.
  They need a different treatment from annotations (send the latest, drop
  the rest), and showing that split working is a finding in its own right.

## 3. What it does

Ordered by what's needed first. Each says who sees what, and when.

### 3.1 The slice, live (2D first)

Needed before anything 3D. Without it, Follow in 2D on a volume is wrong.

- **Viewport boxes say the slice.** Someone on another slice is drawn dashed,
  with the slice in their label: "Ann · slice 9". On your slice, solid as
  now.
- **Follow and Present take the slice too.** Moving with the host means
  their slice and their box. Stepping slices yourself under Follow breaks
  it, the same as panning does now.
- **The Users tab and Active list** show which slice each person is on, for
  volumes only.

### 3.2 Who's in 3D

- **Each person's view** - 2D or 3D - shows next to their name in Active, and
  on their chip on the map.
- **Present switches you with the host.** When the host goes into 3D,
  everyone presented to goes too, and comes back to 2D with them. This is the
  Depth panel's open tab and switch, following the way Present already opens
  panels.
- **Follow doesn't switch you.** Someone following in 2D while the host's in
  3D stays in 2D on the host's slice. The host's camera is shown in 3D only.

### 3.3 Other people in the block

What you see of others while you're in 3D:

- **Their camera,** as a small pyramid (a view frustum) in their colour,
  pointing where they're looking, with their name over it. Faded when
  they've been still for a while.
- **Their 2D view box,** for people in 2D: a rectangle on their slice's
  plane in the block, in their colour. The 3D view already draws your own
  slice as a frame (`sliceFrame` in `VolumeView.tsx`); this draws everyone's.
- **Their cut,** for people in 3D, as a thin outline of the plane, not a cut
  of your block. Your block is cut by your cut only.
- **Hover or click** a camera or box for "Go there", which moves your camera
  to theirs - the 3D version of Go there on the Users tab.
- **Too many** - past six or so cameras, only the host's and anyone who's
  moved in the last minute are drawn. The same idea as viewport boxes being
  off by default in a large session.

### 3.4 Follow and Present in 3D

| | Follow | Present |
| --- | --- | --- |
| Camera | Host's, eased to it rather than jumped | Host's, and you can't turn your own |
| Cut, its position | Host's | Host's |
| Opacity, thickness, gap, guides | Yours | Host's |
| Slice | Host's | Host's |
| Breaking away | Turn or zoom yourself | Not possible, as in 2D |

Follow takes what changes *where* you look; Present takes what the block
*looks like* as well. That's the same line 2D draws: Follow takes the
viewport, Present takes adjustments and panels too.

**Easing.** Camera updates arrive at most ten a second. Jumping to each one
looks jerky in 3D, where a small turn moves everything on screen. The
follower eases towards the latest one each frame (about 100 ms behind),
the way the 2D map animates when it's sent somewhere (`view.animate` in
`MapNode.tsx`).

### 3.5 Pointing at something

- **Look here, in 3D.** The host clicks a point on the block, and everyone
  gets a pulse there for a few seconds, with "Go there" for anyone not
  following. In 2D, "look here" sends a viewport; in 3D it sends a point,
  the host's camera, and the slice it's on.
- **Open in 2D for everyone.** The host's click-through to 2D (`openInTwoD`)
  takes the people presented to with it, onto that slice and place.

### 3.6 Marking in 3D

The box round a feature from DPLab's figure, now shared:

- **While it's drawn,** it goes out as a sketch (tool `marker3d`), so others
  see it grow, as they do a 2D shape now. The hub needs nothing new:
  sketches are opaque to it.
- **Once saved,** it's an annotation with a slice range and a box, so it has
  history like anything else. That's annotation-store work from phase 5 of
  [zstack.md](zstack.md#annotation-store) (a new shape and column) and is the
  biggest piece here.
- **On the 2D map,** a marker shows as its box on every slice it spans.

### 3.7 What stays yours

- Your camera, unless you're following or presented to.
- Opacity, thickness, gap between slices and guides, unless presented to.
- The 3D view's sharp cut face and detail loading. Each machine loads its
  own tiles; only *where* goes out.

## 4. What goes over the hub

Two kinds of state, handled differently, the same split as in 2D:

- **Where people are** - slice, camera, view. Continuous, many updates a
  second, only the latest matters. Kept on the participant in the hub, sent
  throttled, never stored.
- **What's been made** - markers. Saved in annotation-store, with history
  and conflict rules, sent as ops.

### Changes

| What | Where | Typed or opaque | Contract change? |
| --- | --- | --- | --- |
| `Viewport.Z` - the slice index | `Messages.cs`, `realtime.ts` | Typed | Yes - hub and viewer together |
| `Viewport.Camera` - position, target and field of view, or null in 2D | `Messages.cs`, `realtime.ts` | Typed | Yes - same change |
| `Screen.depth` - view (2D/3D) and the block's settings | `realtime.ts` | Opaque to the hub | No - viewer only |
| `HostRequest` kind `look3d` - a point, a camera and a slice | `realtime.ts` | Opaque `Data` | No - viewer only |
| Sketch tool `marker3d` | `realtime.ts` | Opaque `Data` | No - viewer only |
| Saved markers | annotation-store | Typed | Yes - store, migration and viewer |

**Why the camera goes on the viewport, not its own message.** A viewport is
"where you're looking"; in 3D that's a camera. One message keeps one
throttle, one latest-value per person in the hub, and one place Follow
listens to. A separate `UpdateCamera` would need all three again, and could
arrive out of step with the slice.

**Why the block's settings go in Screen.** They change when someone moves a
slider, not every frame, and only Present uses them, as it does the panels
already in Screen. Opaque means the hub doesn't change.

**The camera in block units, not world units.** The 3D view stretches the
block's depth (`stretch`, `trueDepth`) and two people can have it set
differently. A camera at world (0, 0, 2) is outside one person's block and
inside another's. So the camera goes out as a fraction of the block on each
axis, and each viewer turns it back into its own world space. A follower
with a different stretch then looks at the same tissue from the same side,
just with the depth drawn differently.

**Size.** A camera is seven numbers. Measured in phase 3: a viewport is
about 181 bytes of JSON in 2D, 187 with the slice and 295 with a camera, so
ten people turning at ten a second is about 30 KB/s through the hub against
18 KB/s panning in 2D. (This draft first guessed 150 bytes; the numbers are
written out in full, which is where the rest goes.)

### Late joiners

The hub already keeps each participant's latest viewport and screen and
hands them to anyone joining. With `Z` and `Camera` on the viewport, someone
joining a Present in 3D lands in 3D, on the host's slice, at the host's
camera, with nothing extra.

## 5. Phases

Each one is usable on its own and ends with something measured.

1. **The slice, live.** `Viewport.Z`, Follow and Present on the host's
   slice, view boxes saying the slice. Hub and viewer together. This is
   [zstack.md](zstack.md#9-phases) phase 4.
2. **Who's in 3D.** `Screen.depth`, Present switching people into 3D and
   out, the block's settings following under Present. Viewer only.
3. **Cameras.** `Viewport.Camera` in block units, other people's cameras and
   2D boxes drawn in the block, Go there.
4. **Follow and Present in 3D.** Eased following, Present locking the
   controls, breaking away by turning.
5. **Look here in 3D.** The `look3d` request and its pulse, and open in 2D
   for everyone presented to.
6. **Markers.** The `marker3d` sketch, then the saved shape in
   annotation-store with history. The largest phase. Built as a slice range
   on annotations (5.6), which is the start of zstack.md's phase 5 rather
   than waiting for all of it.

### 5.1 Phase 1, built

`Viewport.Z` in the hub (`Messages.cs`, refused if negative) and the viewer
(`realtime.ts`). The map sends the slice with its viewport, and again on
every step. `followSlice` decides what following does about it, `sliceNote`
what a box says.

| Draft said | Built | Why |
| --- | --- | --- |
| Boxes on another slice dashed, slice in the label | As designed, on the map and the overview | |
| Follow and Present take the slice | As designed. Present already locked the Depth tab's slice controls and Page Up/Down | |
| Users tab and Active list show the slice | Active list only, and not your own row | The Users tab is app-wide presence, which has no viewports. Your own slice is in the Depth tab |
| - | "Look here" takes you to the host's slice too | It sends the viewport, so the slice came with it |

**Measured.** Two tabs on the liver volume through the real hub on
localhost, Alice hosting in Follow and Bob following, the hidden pane's
tabs both live. From Alice clicking Next or Previous to Bob's Depth tab
showing the new slice (a `MutationObserver` on it, both tabs on one
clock), 30 steps 400 ms apart: **median 14 ms, 95th percentile 19 ms,
worst 37 ms**, all 30 in order. A first run watched with
`requestAnimationFrame` read a median of 185 ms; that was the hidden pane
throttling frames to about 5 a second, not the slice.

**Checked by hand**, same two tabs: Bob's box on slice 6 dashed with
"Bob Hughes · slice 6" while Alice was on 8; the Active list saying each
person's slice; Follow moving Bob from 6 to 8 as it started; Bob stepping
himself breaking Follow and staying put while Alice moved, and Follow
putting him back; Present holding Bob on Alice's slice; and Go on a look
here taking Bob from slice 7 to Alice's 3.

**Tests.** Hub: three new (the slice relayed and given to late joiners, a
viewport with no `z` still taken, a negative one refused), 131 in all.
Viewer: `followSlice` and `sliceNote`, including a run of the map's effect
through several steps to show it settles without looping, and the Active
list's slice; 1062 in all.

### 5.2 Phase 2, built

`Screen.depth` carries 2D or 3D and the block's settings. `Screen` is opaque
to the hub, so the hub didn't change. `hostDepth` in `realtime.ts` says when
the host's are yours to take (Present, a volume, a viewer that sends them);
`NavigationContext` applies them, the view as changes only (like panels), the
settings like image adjustments, with yours put back after.

| Draft said | Built | Why |
| --- | --- | --- |
| 2D or 3D next to each name in Active, and on their chip | As designed: "in 3D" in the Active list, a 3D tag on the chip | |
| Present switches you into 3D and out with the host | As designed | |
| The block's settings follow under Present | As designed, and the Depth tab's switch and block settings are off while it lasts | The host's next change would only undo yours. Reset view stays on - the camera's still yours until phase 4 |
| Follow doesn't switch you | As designed | |
| - | Present ending leaves you in the view it left you in, with your own block settings back | Same as panels (left open) and adjustments (yours back) |

**Checked by hand**, Alice hosting and Bob in the session on the liver volume:
in Free, Alice going into 3D tagged her chip "3D" and her Active row "in 3D"
for Bob, who stayed in 2D; Follow left Bob in 2D; Present took Bob into 3D
with Alice's X cut and 60% opacity, his switch and settings off and Reset
view still on; Alice changing to a diagonal cut, then to 2D, took Bob with
her; Alice ending Present in 3D left Bob in 3D with his own 40% opacity and
no cut back, and his controls on again. No failed requests on either page.

**Tests.** `inThreeD`, `hostDepth` (only under Present, only on a volume,
nothing from a viewer that doesn't send it) and the Active list's 3D flag
across two tabs. Viewer: 1069 in all.

### 5.3 Phase 3, built

`Viewport.Camera` in the hub (position, target, field of view; three finite
numbers each and a field of view between 0 and 180, or it's refused) and the
viewer. The 3D view reports your camera in block units as you turn it, and
again when the block changes size; `SliceContext` keeps it out of React
state, so turning doesn't re-render the viewer, and the map sends it with
the viewport. The shapes are worked out in `depth/cameras.ts`.

| Draft said | Built | Why |
| --- | --- | --- |
| Others' cameras as a small pyramid in their colour, named | As designed, from their field of view, at a 16:10 screen | Screens differ; the shape only has to say which way they look |
| Faded when still for a while | After 30 s still, see-through, name dimmed | |
| Others' 2D view boxes on their slice | As designed, rotation and all | |
| Their cut as a thin outline | As designed, faint, any of X, Y, Z and the diagonal | |
| Past six cameras, only the host's and anyone who's moved in the last minute | As designed | |
| Go there from a camera or box | Click their name. A camera moves yours to theirs; a 2D box opens their slice and place in 2D | Someone in 2D has no camera to go to |

**Checked by hand**, two tabs on the liver volume plus simulated people:
the other tab's camera drawn as a pyramid to the side of the block, named;
Go there putting the camera exactly where theirs was; the other tab
stretching its block's depth to twice and its camera, unmoved, being drawn at
half the depth in the first tab's block - the same place against the tissue;
a diagonal cut drawn as a closed six-sided outline; a 2D tab drawn as a box
on its slice, and Go there on it opening slice 3 in 2D. (Halfway through,
the second tab's sign-in quietly renewed as the first person's - both tabs
share Keycloak's sign-in cookie - so some of this was one person in two
tabs. Two connections either way, which is what's drawn.)

**Measured**, with `simulate_session.py --three-d` putting simulated people in
3D, each on a slice and going round the block (see the
[scripts README](../scripts/README.md#simulated-people-in-a-session)): a
whole frame of the 3D view, drawn and read back so the GPU has to finish,
at 1351 x 1253:

| Others in the block | Median | 95th percentile |
| --- | --- | --- |
| 1 (a 2D box) | 1.1 ms | 1.5 ms |
| 5 cameras and the box | 1.1 ms | 1.5 ms |
| 20 cameras and the box | 1.1 ms | 1.5 ms |

The cameras are a few lines each against a ray-marched block, so they cost
nothing that shows. With 20 moving twice a second for ten seconds there was
no long task on the main thread besides the timing loop itself.

**Tests.** Hub: the camera relayed and given to late joiners, and five bad
ones refused (137 in all). Viewer: `cameras.ts` - block units both ways and
against different depths, the pyramid's shape, a 2D box on its slice, cut
outlines for every axis going round in order, who's drawn past six, fading
(18 tests; 1087 in all). Scripts: the orbiting camera and the 3D screen (179
in all).

### 5.4 Phase 4, built

Viewer only - the host's camera already went out in phase 3. While you
follow someone who's in 3D, `VolumeView` eases your camera to theirs a frame
at a time (`easeCamera` in `cameras.ts`: half the gap every 60 ms, then lands
exactly). Under Follow you also take their cut (`followedCut` in
`realtime.ts`); under Present you already took their whole block (phase 2),
and now your camera's controls are off as well.

| Draft said | Built | Why |
| --- | --- | --- |
| Follow: the host's camera, eased; their cut; the rest yours | As designed | |
| Present: the host's camera, and you can't turn your own | As designed. Reset view and Go there are off too, and the block doesn't look grabbable | Each would only be undone by the next update |
| Breaking away from Follow by turning or zooming | And by changing the cut yourself, Reset view, or Go there | Anything you do to where you're looking is your own move, like panning in 2D |
| - | Following someone who's in 2D leaves your 3D camera alone | They have no camera; the slice still follows (phase 1) |

**Checked by hand**, with `drive_host_3d.py` playing the host (Alice) from a
script, and Bob following in the browser - a second browser tab would have
been the same person, as phase 3 found:

- Follow: Bob's camera eased to each of 12 host moves and landed exactly on
  the last, scaled to his block.
- Turning the block (a real pointer drag) broke Follow - the chip went to
  "Alice Moore is leading · Follow" - and Bob's camera then stayed put for
  the next five seconds of host moves.
- Present: Bob's controls off, Reset view off, the block's cursor plain, the
  hint saying the presenter's turning it; Present ending turned them all back
  on.
- Follow with the host cut on X at 0.3: Bob's cut went to X at 0.3; changing
  it to Y himself broke Follow and stayed Y while the host kept sending X;
  Follow again put him back on X.

**Measured**, the same way, from the script's send time to Bob's camera
(both on this machine's clock; Bob's camera read every frame, the pane on
screen at 62 frames a second), 12 moves about 1.5 block-widths each:

| | Median | Range |
| --- | --- | --- |
| Starts moving | 35 ms | 22 to 56 ms |
| Lands exactly | 902 ms | 888 to 923 ms |
| Of which easing | 867 ms | 866 to 883 ms |

Landing is almost all easing, as designed: 60 ms x log2(1.5 / 0.0001) is
about 830 ms, and frames add a little. It's most of the way long before
that - 90% of a move is covered in 200 ms, 99% in 400 ms - so the number to
quote for "how long until a follower sees what the host sees" is the start
plus a few hundred ms, not the landing. The start includes the script's
long-polling send, which the viewer's WebSocket doesn't have.

With the browser pane hidden, animation frames stop entirely, so easing
(and this measurement) needs the pane on screen.

**Tests.** `easeCamera` (half the gap a half-life, the same wherever the
frames fall, landing exactly, no movement for no time) and `easeTime`;
`followedCut` (only under Follow while following, on a volume, from a host
that sends it). Viewer: 1096 in all. Scripts: `drive_host_3d.py`'s camera
path, view and screen.

### 5.5 Phase 5, built

Viewer only. A "look here" already sent the host's viewport, which since
phase 3 has their camera in it when they're in 3D - so rather than a new
`look3d` kind, the same `look` request carries an optional `point` too.
Viewers that don't know about it still get a 2D look from the same message.
`lookIn3d` in `realtime.ts` reads it (camera, point - the middle of their
view if they didn't pick one - and slice), and turns anything that isn't
numbers into an ordinary look.

| Draft said | Built | Why |
| --- | --- | --- |
| The host clicks a point on the block | Shift and click the tissue - a plain click still opens it in 2D. The Look here buttons, in 3D, point at the middle of the host's view | A plain click already had a job |
| A `look3d` request kind | The existing `look`, with `point` added | Older viewers still get a 2D look; one handler, not two |
| A pulse there for a few seconds | Two rings going out from the spot in the host's colour, for 4 s, for everyone in 3D - following or not | |
| Go there for anyone not following | Go takes you into 3D if you're in 2D, onto their slice, and eases your camera to theirs, pulsing again | A pulse that's gone by the time the block's loaded says nothing |
| Open in 2D for everyone presented to | Already there from phases 1 and 2: the host's view, slice and 2D viewport all go to whoever's presented to | |

**Checked by hand**, `drive_host_3d.py` as the host and Bob in the browser:
in 3D, a look brought "Alice Moore wants you to look at something in 3D"
with Go, and the pulse, within a couple of ms of being sent; Go landed Bob's
camera exactly on Alice's. From 2D, Go took Bob into 3D, onto Alice's slice
(3) and her camera, once the block had loaded. Following, the pulse came and
no toast. Presented to, Alice going to 2D on slice 5 took Bob to 2D, slice 5,
centred exactly where she was. Then as Alice in the browser with a simulated
person in the room: the hint said Shift and click points everyone; a real
Shift+click on the liver drew the pulse in Alice's colour on the spot clicked,
stayed in 3D, and a listener joined as Bob received the look with her camera,
slice 8 and the point.

The pulse is too short for the pane's screenshots, which take longer than
4 s to come back - a copy of it, kept on screen, shows the rings; its styles
were read while it was live.

**Tests.** `lookIn3d`: camera, point and slice; the middle of their view
without a point; nothing for 2D or a flat slide; nothing for a camera that
isn't numbers; a bad point or slice dropped and the rest kept. Viewer: 1101
in all. Scripts: `drive_host_3d.py`'s look and 2D view.

### 5.6 Phase 6, built

A marker is an ordinary annotation: a rectangle (its footprint on the
slide) with the slices it spans, `sliceFrom` and `sliceTo` (from 0,
inclusive). Both null is every slice - every annotation from before, and
every 2D one. The choice was between that and a separate Marker entity with
its own endpoints, ops and history; this one gets history, live ops, groups,
the Saved list, export and rollback for nothing, and is the first part of
zstack.md's "annotate at a depth".

**annotation-store.** Two nullable columns and a migration
(`AnnotationSliceRange`), no backfill. POST /annotations and the import
refuse a range that's half set, below 0, or backwards, with a 400 saying
which. PUT doesn't touch it - it's set when the annotation's made. Every
restore path (change set, item history, collection rollback) brings it back,
as they rebuild from the deleted row. Schema docs regenerated.

**The viewer.** `depth/markers.ts` holds the shapes.

| Draft said | Built | Why |
| --- | --- | --- |
| While it's drawn, a `marker3d` sketch others see grow | As designed - dashed, in its colour, in others' 3D views | |
| Once saved, an annotation with a slice range and a box | A rectangle annotation with `sliceFrom`/`sliceTo` | The box's footprint really is a rectangle, so 2D tools, filters and glyphs all just work |
| On the 2D map, its box on every slice it spans | As designed, and nowhere else. View on map from a slice it isn't on goes to its first | It's not drawn anywhere else, so viewing it from there showed nothing |
| - | Placing it: Mark a box in the Depth tab's 3D section, click two corners on the tissue, then name it and set its slices | Two clicks can reach different depths once the block's turned or cut, so the corners give a real range; the form lets it go deeper than clicks can reach |
| - | The Saved list says "3D · slices 4 to 9", and Slices in its details | |
| - | Export writes `sliceFrom`/`sliceTo` into each feature's properties, import reads them back - a range that doesn't make sense is dropped, the shape kept | So a marker survives a round trip through a file |

Escape or Cancel drops one half placed, and so does leaving 3D.

**Checked by hand**, as Alice in the browser on the liver volume: Mark a
box; the first click took, the box followed the pointer dashed; the second
click on the tissue at another depth gave slices 1 to 7 from the two
corners alone; named "Duct" and set to 4 to 9, it saved (`sliceFrom` 3,
`sliceTo` 8 read back from annotation-store) and drew solid in the block.
In 2D it was on slices 8 and 9 and not on 2 or 10; the Saved list read "3D ·
slices 4 to 9"; View on map from slice 10 went to slice 4. Then in the
session, `drive_host_3d.py --sketch-marker` placed one live: Alice's block
drew it dashed, one layer deeper and wider each step, and it went when the
script gave up on it. The test marker was deleted afterwards.

**Tests.** annotation-store: 20 new (the range round trip, one slice, none,
every bad POST and import, PUT leaving it alone, restore after delete,
item history, rollback, bulk delete then restore) - 359 in all, 11 skipped
as before, and the same 359 on Postgres. Viewer: `markers.ts` (corners to a
box, too small, GeoJSON and back, on which slices, the text, the box's
edges including across a gap) and export and import of the range - 1118 in
all. Scripts: the marker sketch.

## 6. How it's measured

- **Follower lag on the slice** (phase 1): from the host stepping a slice to
  the follower's map showing it. Timed the way
  [timing.md](timing.md) times calls, from the hub's server time on the
  update to the follower's render.
- **Follower lag on the camera** (phase 4): from the host's camera stopping
  to the follower's being within a small angle of it. The easing is part of
  this number, so it's reported with and without.
- **Frame rate with others drawn** (phase 3): the 3D view's frames a second
  while turning, with 0, 5 and 20 other cameras in the block. It shouldn't
  drop; the frustums are a few lines each.
- **Hub traffic** (phase 3): bytes a second through the hub with ten people
  turning, against the same ten panning in 2D.
- **A playback scene** per phase, with its features listed in
  `playback/lib/features.js`, like every other live feature.

## 7. Open questions

- **Follow in 2D while the host's in 3D.** This draft keeps the follower in
  2D on the host's slice. Should the follower's 2D map go to where the
  host's camera is pointing, so it's showing the same tissue?
- **Cut under Follow.** Taking the host's cut means a follower can't keep
  their own cut while following. Is that right, or is the cut closer to
  opacity (how it looks) than to the camera (where you look)?
- **How many cameras before it's noise.** Six is a guess; it wants trying
  with real people in the evaluation.
- **Markers and editing at once.** Settled for depth: a marker's slices
  change in the Saved edit form, saved through `PUT /annotations/{id}/slices`
  with the range it started from. Under first change wins a second person
  moving it from an old copy is turned down and told who moved which end;
  under last change wins it goes through. Its footprint on the slide still
  can't be changed after saving, as for every 2D shape.
- **Guests.** They can view, so they'd see cameras and follow. Their own
  camera, sent to everyone, is new information about them. Fine, as their
  2D viewport already goes out, but it's worth saying in
  [ethics.md](ethics.md).

## 8. Verification log

| Claim | How it was checked | State |
| --- | --- | --- |
| Viewports are throttled to 100 ms | `VIEWPORT_THROTTLE_MS = 100` in `RealtimeContext.tsx` | Checked |
| The slice isn't sent live today | `Viewport` in `realtime-hub/Slides/Messages.cs` has Center, Resolution, Rotation and Extent only; `SliceContext` has no realtime calls | Checked |
| The hub doesn't look inside Screen or Sketch data | `UpdateScreen` and `UpdateSketch` in `SlideHub.cs` only check the shape and size | Checked |
| Sketch tool names aren't a fixed list in the hub | `ValidateTool` checks it's there and its length only | Checked |
| The hub hands late joiners the latest viewport and screen | `JoinResult.Others` is a list of `Participant`, which carries `Viewport` and `Screen` (`Messages.cs`) | Checked |
| The 3D view's camera is a three.js `PerspectiveCamera` with `OrbitControls` | `VolumeView.tsx` | Checked |
| The 3D view draws your own slice as a frame | `sliceFrame` in the scene in `VolumeView.tsx` | Checked |
| The 2D map animates when sent somewhere | `view.animate` with a 600 ms duration in `MapNode.tsx` | Checked |
| A viewport is about 295 bytes with a camera, 181 in 2D | 200 of the simulator's viewports, sized as compact JSON | Checked - corrected from a guess of 150 |
| Phase 3: 20 other cameras don't slow the 3D view | A frame timed drawn and read back, 0, 5 and 20 simulated people in 3D (5.3) | Checked |
| Phase 3: a camera's in the same place against blocks stretched differently | Two tabs, one at twice the depth (5.3), and a unit test | Checked |
| Phase 1: a step reaches a follower in a median 14 ms on localhost | Two tabs, real hub, 30 steps timed with a `MutationObserver` (5.1) | Checked - localhost only, no real network |
| Phase 1: Follow, breaking away, Present and look here all take the slice | Two tabs on the liver volume, by hand (5.1) | Checked |
| Phase 2: Present takes followers into 3D with the host's block, and gives theirs back after | Two tabs on the liver volume, by hand (5.2) | Checked |
| Phase 4: a follower's camera starts moving a median 35 ms after the host's, lands in a median 902 ms | 12 moves from `drive_host_3d.py`, the follower's camera read every frame (5.4) | Checked - localhost, pane on screen |
| Phase 4: turning, cutting, Reset view or Go there breaks Follow; Present locks the camera | By hand, a real pointer drag and the Depth tab (5.4) | Checked |
| Phase 5: a look from 3D pulses for everyone in 3D and Go lands on the host's camera and slice, from 3D or 2D | `drive_host_3d.py --look` against Bob in the browser (5.5) | Checked |
| Phase 5: the host's Shift+click sends a look with the spot clicked | A listener joined as Bob received it (5.5) | Checked |
| Phase 6: a marker saves with its slices, draws in 3D and only on its slices in 2D | By hand in the browser, and read back from annotation-store (5.6) | Checked |
| Phase 6: someone placing a marker is seen live | `drive_host_3d.py --sketch-marker` against the browser (5.6) | Checked |
| Multi-user game editors show other users' cameras | Unreal Engine 5.9's Multi-User Editing Overview, Presence section, read in full: an avatar per user at their position and viewpoint, "Teleport to user's point of view", no follow mode (section 2) | Checked - one engine; the avatar may need `Concert.EnablePresence`, per the Reference page |
