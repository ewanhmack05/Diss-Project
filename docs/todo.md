### Todo list

Port Tiler to linux for azure
Finish off realtime functionality
  - Ruler, rotation, image adjustment all need real time functionality

Finish off session based functionality

### 1. Version control 

Nothing keeps earlier versions yet. Annotation and cell count edits are last write wins, and once one is overwritten it's gone. The Yjs history for a label/notes is dropped when the last person closes it.

- History log per annotation and cell count - who, when, before/after, and the hub's `seq`
- Viewing that history in the viewer
- Rolling back to an earlier version
- A clear policy for two people editing the same thing at once - the log at least makes last write wins visible
- Tie it back to games - netcode (authoritative server, rollback), Unreal Multi-User Editing, Perforce-style workflows
- Version control papers to use are in [background.md](background.md)

### 2. Evaluation 

- Latency - how long an op takes to reach everyone else
- Conflict scenarios - two people editing the same annotation/count at once
- Yjs (CRDT) vs last write wins, for the label/notes fields
- Canvas vs WebGL frame times - "not yet measured" in [rendering.md](rendering.md)
- Already there to build on: the hub's `/rooms/{roomId}/docs` endpoint (doc sizes), the Grafana dashboard ([dashboard/](../dashboard/README.md)), `scripts/seed_stress.py`

### 3. Unfinished features

- Rotation and image adjustments are only shared in Present - not live otherwise (ruler is done)
- Guest links - people without an account can't join a session (see [auth.md](auth.md))
- Sessions are one slide each - whether one should cover several (a case) is still open (see [thought-process.md](thought-process.md))
- Azure - two options costed in [azure.md](azure.md), nothing deployed yet. Tiler runs on linux now, so it isn't blocked

### Notes
<img width="1127" height="2048" alt="image" src="https://github.com/user-attachments/assets/ca21ef6a-17e0-40f9-bbef-d5d39dbe6c60" />
