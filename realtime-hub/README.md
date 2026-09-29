# realtime-hub

.NET SignalR service for real-time collaboration. Everyone viewing the same
slide shares a room, and the hub relays annotation changes and viewports
between them. Kept separate from annotation-store so it can be ported and
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
| `JoinSlide`        | `slideId`, `userId`, `displayName`  | `JoinResult` | Leaves any slide you were already in                     |
| `LeaveSlide`       | -                                   | -            |                                                          |
| `UpdateViewport`   | `Viewport`                          | -            | Throttle to ~10/sec on the client                        |
| `SendAnnotationOp` | `AnnotationOp`                      | `StampedOp`  | Relay only - still save to annotation-store as normal    |

### Hub → client

| Event             | Payload          | When                                     |
| ----------------- | ---------------- | ---------------------------------------- |
| `UserJoined`      | `Participant`    | Someone joins your slide                 |
| `UserLeft`        | `connectionId`   | Someone leaves, switches slide or drops  |
| `ViewportUpdated` | `ViewportUpdate` | Someone else moves                       |
| `AnnotationOp`    | `StampedOp`      | Someone else changes an annotation       |

Nothing is echoed back to the sender.

### Shapes

```ts
type Participant = {
  connectionId: string; slideId: string; userId: string; displayName: string;
  colour: string; joined: string; viewport: Viewport | null;
};
type Viewport = { center: [number, number]; resolution: number; rotation: number; extent: [number, number, number, number] };
type ViewportUpdate = { connectionId: string; viewport: Viewport };
type AnnotationOp = { kind: 'create' | 'update' | 'delete'; entity: 'annotation' | 'cellCount'; id: string; data?: unknown };
type StampedOp = { seq: number; serverTime: string; connectionId: string; userId: string; op: AnnotationOp };
type JoinResult = { me: Participant; others: Participant[]; seq: number };
```

- **Participants are per connection** - one user in two tabs is two
  participants.
- **Colour** - each participant gets one from a fixed palette, unique in the
  room until it runs out.
- **`seq`** - per room, only goes up. Lets clients spot a missed op or order
  two edits to the same thing (last write wins). Resets once a room empties.
- **`data`** - passed through untouched, so the hub doesn't care about
  annotation-store's schema.

## HTTP

| Endpoint              | Returns                               |
| --------------------- | ------------------------------------- |
| `GET /rooms`          | slide id → number of people connected |
| `GET /rooms/{slideId}`| participants in that slide            |

## Notes

- State is in memory, so only one copy can run - more than one needs a
  Redis backplane or Azure SignalR Service.
- Telemetry goes to the dashboard the same way as the other services,
  including SignalR hub calls and open connection counts.
