# realtime-hub

.NET SignalR service for real-time collaboration. Everyone viewing the same
slide shares a room, and the hub relays annotation changes, viewports,
in-progress drawing and shared text edits between them, and runs comparison
cell counts. Kept separate from annotation-store so it can be ported and
reused (see [docs/libraries.md](../docs/libraries.md)).

This is step 1 of the plan - no auth or sessions yet, so users are whatever
id the client sends.

## Running

```bash
cd realtime-hub/
dotnet build && dotnet run --urls http://0.0.0.0:5180
```

Scalar is at http://localhost:5180/scalar in Development. Tests:

```bash
cd realtime-hub/Tests/
dotnet test
```

## Hub

Connect to `/hubs/slides`. Enums go over the wire as camelCase strings
(`"create"`, `"cellCount"`).

### Client → hub

| Method             | Args                                | Returns      | Notes                                                    |
| ------------------ | ----------------------------------- | ------------ | -------------------------------------------------------- |
| `JoinSlide`        | `slideId`, `userId`, `displayName`  | `JoinResult` | Leaves any slide you were already in, closing its docs   |
| `LeaveSlide`       | -                                   | -            | Closes any docs you had open                             |
| `UpdateViewport`   | `Viewport`                          | -            | Throttle to ~10/sec on the client                        |
| `UpdateSketch`     | `Sketch \| null`                    | -            | `null` clears it. `tool` and `data` are required         |
| `SendAnnotationOp` | `AnnotationOp`                      | `StampedOp`  | Relay only - still save to annotation-store as normal    |
| `OpenDoc`          | `docId`, `seed` (base64)            | `DocState`   | Seed only used if the doc isn't open yet. Safe to repeat |
| `SendDocUpdate`    | `docId`, `update` (base64)          | -            | Open the doc first. Max 64KB                             |
| `CloseDoc`         | `docId`                             | -            | No-op if it isn't open                                   |
| `StartComparison`  | `ComparisonSettings`                | `Comparison` | Invites everyone else. Fails if one is still running     |
| `JoinComparison`   | `comparisonId`                      | -            | Only from `invited`, before the reveal                   |
| `SubmitComparison` | `comparisonId`, `ComparisonDot[]`   | -            | Only while `counting`. Max 10,000 dots                   |
| `LeaveComparison`  | `comparisonId`                      | -            | Decline, give up, or close the results. No-op if not in it |

### Hub → client

| Event               | Payload          | When                                                  |
| ------------------- | ---------------- | ----------------------------------------------------- |
| `UserJoined`        | `Participant`    | Someone joins your slide                              |
| `UserLeft`          | `connectionId`   | Someone leaves, switches slide or drops               |
| `ViewportUpdated`   | `ViewportUpdate` | Someone else moves                                    |
| `SketchUpdated`     | `SketchUpdate`   | Someone else draws, or finishes (`sketch: null`)      |
| `AnnotationOp`      | `StampedOp`      | Someone else changes an annotation                    |
| `DocUpdated`        | `DocUpdate`      | Another editor of a doc you have open changes it      |
| `DocEditorsChanged` | `DocEditors`     | Someone opens, closes, leaves or drops a doc you have |
| `ComparisonChanged` | `Comparison \| null` | Anything about the slide's comparison changes, `null` once it's dropped |

Nothing is echoed back to the sender, apart from `ComparisonChanged`, which
goes to the whole slide so clients have one place to keep their copy.

### Shapes

```ts
type Participant = {
  connectionId: string; slideId: string; userId: string; displayName: string;
  colour: string; joined: string; viewport: Viewport | null; sketch: Sketch | null;
};
// extent is the view box before rotation (centre ± half the screen size, in
// map units) - turn it by rotation round the centre to get what's on screen.
type Viewport = { center: [number, number]; resolution: number; rotation: number; extent: [number, number, number, number] };
type ViewportUpdate = { connectionId: string; viewport: Viewport };
type Sketch = { tool: string; data: unknown };  // tool: 'annotation' for now, later 'ruler', 'cellCount'
type SketchUpdate = { connectionId: string; sketch: Sketch | null };
type AnnotationOp = { kind: 'create' | 'update' | 'delete'; entity: 'annotation' | 'cellCount'; id: string; data?: unknown };
type StampedOp = { seq: number; serverTime: string; connectionId: string; userId: string; op: AnnotationOp };
type JoinResult = { me: Participant; others: Participant[]; seq: number; comparison: Comparison | null };
// matchRadius is in map units - dots closer than this are the same cell.
type ComparisonSettings = { roiGeoJson: string; dotSize: number; matchRadius: number };
type ComparisonDot = { x: number; y: number };
type Counter = {
  connectionId: string; displayName: string; colour: string;
  state: 'invited' | 'counting' | 'submitted'; dots: ComparisonDot[] | null;
};
type Comparison = {
  id: string; hostConnectionId: string; settings: ComparisonSettings;
  started: string; revealed: boolean; counters: Counter[];
};
// Byte arrays (seed, update, updates) are base64 strings both ways.
// editors are connection ids, in the order they opened the doc.
type DocState = { docId: string; instanceId: string; seeded: boolean; updates: string[]; editors: string[] };
type DocUpdate = { docId: string; connectionId: string; update: string };
type DocEditors = { docId: string; editors: string[] };
```

- **Participants are per connection** - one user in two tabs is two
  participants.
- **Colour** - each participant gets one from a fixed palette, unique in the
  room until it runs out.
- **`seq`** - per room, only goes up. Lets clients spot a missed op or order
  two edits to the same thing (last write wins). Resets once a room empties.
- **`data`** - passed through untouched, so the hub doesn't care about
  annotation-store's schema.
- **Sketches** - ephemeral, never saved. Kept on the participant like the
  viewport so a late joiner sees what people are part way through drawing.
- **Docs** - for co-editing an annotation's name and notes with Yjs. The hub
  keeps each doc's raw Yjs updates in memory without reading them, so a late
  opener can catch up from `updates`. Docs are per slide, keyed by `docId`.
- **Seeding** - the first opener's `seed` becomes the doc's first update and
  they get `seeded: true`; later openers' seeds are ignored. `instanceId`
  changes every time a doc is recreated, so a client can tell whether its
  local history matches the hub's.
- **Dropping** - once the last editor closes, leaves the slide or drops, the
  doc is gone and the next opener seeds it again. No compaction, since a doc
  only lives for one editing session and the fields are short.
- **Comparison counts** - one per slide. Everyone counts the host's ROI on
  their own, then the dots are compared. `dots` is `null` on everyone until
  it's revealed, so nobody can copy.
  - Starting invites everyone in the slide, and anyone who joins the slide
    before the reveal. The host is `counting` straight away.
  - It's revealed once nobody is still `counting` and at least two have
    submitted. Anyone still `invited` then is dropped from it.
  - It's dropped if it can never get to two (nobody left counting or
    invited), or once everyone has left a revealed one. A revealed one is
    also replaced if someone starts a new one.
  - Disconnecting or switching slide counts as leaving it.
- **Message size** - the hub accepts messages up to 1MB (SignalR's default
  of 32KB dropped long freehand annotations).

## HTTP

| Endpoint                   | Returns                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `GET /rooms`               | slide id → number of people connected                            |
| `GET /rooms/{slideId}`     | participants in that slide                                       |
| `GET /rooms/{slideId}/docs`| open docs: `docId`, `instanceId`, `editors`, `updates`, `bytes`  |
| `GET /rooms/{slideId}/comparison` | the running comparison (no dots until revealed), 204 if none |

## Notes

- `/docs` counts are for watching doc growth while testing.
- State is in memory, so only one copy can run - more than one needs a
  Redis backplane or Azure SignalR Service.
- Telemetry goes to the dashboard the same way as the other services,
  including SignalR hub calls and open connection counts.
