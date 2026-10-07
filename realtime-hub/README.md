# realtime-hub

.NET SignalR service for real-time collaboration. Everyone viewing the same
slide shares a room, and the hub relays annotation changes, viewports,
in-progress drawing and shared text edits between them, and runs comparison
and shared cell counts. Kept separate from annotation-store so it can be ported and
reused (see [docs/libraries.md](../docs/libraries.md)).

A room is one **session** - a collection people work in together, joined
through invite links (see annotation-store's README). Working alone, the
viewer doesn't connect at all.

Everyone signs in with Keycloak (see [auth/](../auth)). The hub checks the
access token when a connection opens - browsers send it as
`?access_token=`, since a WebSocket can't carry the usual header - and who
someone is (`userId`, `displayName`) comes from the token.

## Running

```bash
cd realtime-hub/
dotnet build && dotnet run --urls http://localhost:5180
```

In Docker - easiest through the root `docker-compose.yml`, which points it
at annotation-store and Keycloak (`AnnotationStore__BaseUrl`,
`Auth__MetadataAddress`). Only ever run one copy - rooms live in memory.

```bash
docker build -t diss-realtime-hub realtime-hub
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
| `JoinSession`      | `roomId` (the session's collection id) | `JoinResult` | Only if annotation-store says you're in the session and it hasn't ended. Leaves any room you were already in, closing its docs. You're whoever the token says |
| `LeaveSession`     | -                                   | -            | Closes any docs you had open                             |
| `UpdateViewport`   | `Viewport`                          | -            | Throttle to ~10/sec on the client                        |
| `UpdateSketch`     | `Sketch`                            | -            | One per tool - replaces that tool's last one. `tool` and `data` are required. Max 8 tools at once |
| `ClearSketch`      | `tool`                              | -            | Done or given up with that tool. Other tools' sketches stay |
| `UpdateScreen`     | `Screen`                            | -            | What's on screen besides the map, for Present. Any object, max 4KB |
| `SendRequest`      | `to` (connection ids, or `null` for everyone), `kind`, `data` | - | Host only. Asks people to do something, e.g. `look` (data: `Viewport`) or `openPanel` (data: `{ panel }`) |
| `RefreshRole`      | -                                   | -            | After the host changes your role. Checked with annotation-store; going view only takes you out of any count |
| `SetNavigation`    | `'free' \| 'follow' \| 'present'`   | -            | Host only. Goes to everyone, host included               |
| `SendAnnotationOp` | `AnnotationOp`                      | `StampedOp`  | Relay only - still save to annotation-store as normal    |
| `OpenDoc`          | `docId`, `seed` (base64)            | `DocState`   | Seed only used if the doc isn't open yet. Safe to repeat |
| `SendDocUpdate`    | `docId`, `update` (base64)          | -            | Open the doc first. Max 64KB                             |
| `CloseDoc`         | `docId`                             | -            | No-op if it isn't open                                   |
| `StartComparison`  | `ComparisonSettings`                | `Comparison` | Invites everyone else who can edit. View only can't start one. Fails if one is still running |
| `JoinComparison`   | `comparisonId`                      | -            | Only from `invited`, before the reveal                   |
| `SubmitComparison` | `comparisonId`, `ComparisonDot[]`   | -            | Only while `counting`. Max 10,000 dots                   |
| `LeaveComparison`  | `comparisonId`                      | -            | Decline, give up, or close the results. No-op if not in it |
| `StartSharedCount` | `SharedCountSettings`               | `SharedCount` | Invites everyone else who can edit. View only can't start one. Fails if one is already running |
| `JoinSharedCount`  | `sharedCountId`                     | -            | From an invite, or back in after leaving                 |
| `AddSharedDot`     | `sharedCountId`, `SharedDot`        | -            | Joined only. Client picks the id. Max 10,000 dots        |
| `RemoveSharedDot`  | `sharedCountId`, `dotId`            | -            | Your own dots only (undo)                                |
| `LeaveSharedCount` | `sharedCountId`                     | -            | Decline or stop counting. Your dots stay                 |
| `FinishSharedCount`| `sharedCountId`                     | -            | Host only. Ends it for everyone                          |

### Hub → client

| Event               | Payload          | When                                                  |
| ------------------- | ---------------- | ----------------------------------------------------- |
| `UserJoined`        | `Participant`    | Someone joins your slide                              |
| `UserLeft`          | `connectionId`   | Someone leaves, switches slide or drops               |
| `ViewportUpdated`   | `ViewportUpdate` | Someone else moves                                    |
| `SketchUpdated`     | `SketchUpdate`   | Someone else draws, or finishes with a tool (`sketch: null`) |
| `ScreenUpdated`     | `ScreenUpdate`   | Someone else opens a panel, changes tab or adjusts the image |
| `NavigationChanged` | `NavigationMode` | The host switches between Free, Follow me and Present |
| `RequestReceived`  | `HostRequest`    | The host asks you to do something - you can say no    |
| `ParticipantUpdated` | `Participant`   | Your role was checked again (`RefreshRole`) - only to you and the host |
| `AnnotationOp`      | `StampedOp`      | Someone else changes an annotation                    |
| `DocUpdated`        | `DocUpdate`      | Another editor of a doc you have open changes it      |
| `DocEditorsChanged` | `DocEditors`     | Someone opens, closes, leaves or drops a doc you have |
| `ComparisonChanged` | `Comparison \| null` | Anything about the slide's comparison changes, `null` once it's dropped |
| `SharedCountChanged` | `SharedCount \| null` | Someone starts, joins or leaves the shared count, or the host hands over. `null` once it's finished or dropped |
| `SharedDotAdded`    | `SharedDotAdded`   | Someone else adds a dot to the shared count           |
| `SharedDotRemoved`  | `SharedDotRemoved` | Someone else takes one of their dots back             |

Nothing is echoed back to the sender, apart from `ComparisonChanged`,
`SharedCountChanged` and `NavigationChanged`, which go to the whole slide so clients have one place
to keep their copy. Shared dots aren't echoed - the sender has already drawn
theirs.

### Shapes

```ts
type Participant = {
  connectionId: string; roomId: string; userId: string; displayName: string;
  colour: string; joined: string; host: boolean; canEdit: boolean; viewport: Viewport | null;
  sketches: Record<string, Sketch> | null;  // by tool
  screen: Screen | null;
};
type NavigationMode = 'free' | 'follow' | 'present';
// The hub doesn't look inside - this is what the viewer sends.
type Screen = {
  panels: string[]; tabs: Record<string, string>; adjustments: Record<string, number> | null;
  viewedCellCountId: string | null; editingAnnotationId: string | null; editingCellCountId: string | null;
};
type ScreenUpdate = { connectionId: string; screen: Screen };
// extent is the view box before rotation (centre ± half the screen size, in
// map units) - turn it by rotation round the centre to get what's on screen.
type Viewport = { center: [number, number]; resolution: number; rotation: number; extent: [number, number, number, number] };
type ViewportUpdate = { connectionId: string; viewport: Viewport };
type Sketch = { tool: string; data: unknown };  // tool: 'annotation', 'ruler' (stays up once done, until cleared) or 'cellCount' (the host's count while presenting)
type SketchUpdate = { connectionId: string; tool: string; sketch: Sketch | null };
// entity 'collection' is a nudge that the session changed (someone's role,
// someone taken out, it ended), so everyone fetches it again.
type AnnotationOp = { kind: 'create' | 'update' | 'delete'; entity: 'annotation' | 'cellCount' | 'collection'; id: string; data?: unknown };
type StampedOp = { seq: number; serverTime: string; connectionId: string; userId: string; op: AnnotationOp };
type JoinResult = { me: Participant; others: Participant[]; seq: number; comparison: Comparison | null; sharedCount: SharedCount | null; navigation: NavigationMode };
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
// roiGeoJson null means the whole slide.
type SharedCountSettings = { roiGeoJson: string | null; dotSize: number; matchRadius: number };
// connectionId is filled in by the hub, whatever the client sends.
type SharedDot = { id: string; x: number; y: number; colour: string; connectionId: string };
type Contributor = { connectionId: string; userId: string; displayName: string; colour: string; state: 'invited' | 'joined' | 'left' };
type SharedCount = {
  id: string; hostConnectionId: string; settings: SharedCountSettings;
  started: string; contributors: Contributor[]; dots: SharedDot[];
};
type SharedDotAdded = { sharedCountId: string; dot: SharedDot };
type SharedDotRemoved = { sharedCountId: string; dotId: string };
// Byte arrays (seed, update, updates) are base64 strings both ways.
// editors are connection ids, in the order they opened the doc.
type DocState = { docId: string; instanceId: string; seeded: boolean; updates: string[]; editors: string[] };
type DocUpdate = { docId: string; connectionId: string; update: string };
type DocEditors = { docId: string; editors: string[] };
```

- **Who can join** - `JoinSession` asks annotation-store
  (`GET /collections/{id}/membership`, with the user's own token) whether
  they're in the session and it's still going. Its address is
  `AnnotationStore:BaseUrl` in `appsettings.json`.
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
  opener can catch up from `updates`. Docs are per room, keyed by `docId`.
- **Seeding** - the first opener's `seed` becomes the doc's first update and
  they get `seeded: true`; later openers' seeds are ignored. `instanceId`
  changes every time a doc is recreated, so a client can tell whether its
  local history matches the hub's.
- **Dropping** - once the last editor closes, leaves the slide or drops, the
  doc is gone and the next opener seeds it again. No compaction, since a doc
  only lives for one editing session and the fields are short.
- **Comparison counts** - one per room. Everyone counts the host's ROI on
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
- **Shared counts** - one per room. Everyone adds to one count, usually
  each in their own part of the slide, and sees every dot as it lands.
  - Starting invites everyone in the slide, and anyone who joins it later.
  - Leaving keeps your dots. You stay in `contributors` as `left` if you'd
    placed any, so they still have a name.
  - If the host leaves, hosting passes to whoever joined first. Once nobody
    is `joined` it's dropped.
  - `FinishSharedCount` ends it for everyone - the host saves it to
    annotation-store as a normal cell count from their own copy.
- **Message size** - the hub accepts messages up to 1MB (SignalR's default
  of 32KB dropped long freehand annotations).

## HTTP

| Endpoint                   | Returns                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `GET /rooms`               | slide id → number of people connected                            |
| `GET /rooms/{roomId}`     | participants in that room                                        |
| `GET /rooms/{roomId}/docs`| open docs: `docId`, `instanceId`, `editors`, `updates`, `bytes`  |
| `GET /rooms/{roomId}/comparison` | the running comparison (no dots until revealed), 204 if none |
| `GET /rooms/{roomId}/sharedcount` | the running shared count, dots included, 204 if none |

## Notes

- `/docs` counts are for watching doc growth while testing.
- State is in memory, so only one copy can run - more than one needs a
  Redis backplane or Azure SignalR Service.
- Telemetry goes to the dashboard the same way as the other services,
  including SignalR hub calls and open connection counts.
