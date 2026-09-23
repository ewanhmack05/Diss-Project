# Real-time libraries

The main setup for real-time collaboration will be a WebSocket layer
running constantly alongside the annotation store.

Libraries to look into:

- Yjs
- Automerge
- Loro

A WebSocket layer broadcasts operations between everyone viewing that
slide. Periodically (or on save), CRDT state gets flattened and persisted
into the existing .NET annotation store schema, so downstream
querying/reporting doesn't need to change.

## Real-time API

New API to deal with real-time processing, sitting between annotation store
and viewer?

- Connect tiler in, keep this new service as the centralised processing for
  all of the existing services and keep the WebSocket handling there, rather
  than in each service
- Also easier to port
- Look into events too

## Where it's at

- **Webhooks vs WebSockets** - webhooks are one-off server-to-server calls;
  what's needed here is WebSockets. On .NET that's **SignalR** (rooms via
  `Groups`, reconnection, JS client).
- **Separate service** - kept separate from annotation-store, so it can be
  ported and reused elsewhere.
- **Tiler stays out of it** - tiles are stateless and cacheable; the viewer
  keeps calling the tiler directly.
- **CRDT stays on the list** to look at further down the line. The simpler
  alternative is server-authoritative ops per annotation (create/update/
  delete, last write wins), since two people editing the same polygon at
  once is rare. Comparing the two could be an evaluation chapter.
- If CRDT: **Yjs** is the most mature, and its awareness protocol covers
  cursors/presence. The catch is its tooling centres on Node - on .NET it's
  `yrs` bindings (YDotNet) or treating updates as opaque blobs.
- **One hub copy** - with more than one, users on different copies won't
  see each other, unless Azure SignalR Service (or a Redis backplane) is
  added.
- **Events** - Postgres `LISTEN/NOTIFY` or an in-process event bus is
  plenty at this scale.

## Suggested order

1. SignalR hub, one room per slide, fake users; broadcast annotation ops + presence/viewport
2. Remote cursors, viewports and in-progress strokes
3. Sessions, invite links, host/editor/viewer roles (see [thought-process.md](thought-process.md))
4. Evaluation - latency, conflict scenarios, CRDT comparison if chosen
