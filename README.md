# Diss Project

Dissertation project on real-time collaboration around whole-slide image
annotation. Proof of concept, one collaborator for now.

```
image-viewer/      React + TypeScript + OpenLayers frontend. See image-viewer/README.md
tiler/              .NET tile server for .mrxs whole-slide images. See tiler/README.md
annotation-store/   .NET + Postgres backend for persisted annotations. See annotation-store/README.md
dashboard/          Grafana (Docker) - load, timing and error stats for the services. See dashboard/README.md
scripts/            Dev scripts - stress-test data, SQL. See scripts/README.md
docs/               Planning notes - auth, Azure, real-time libraries, sessions, rendering
```

## Prerequisites

New machine? See [SETUP.md](SETUP.md) for installing .NET 10, Node.js,
PostgreSQL, Git LFS, and recommended VS Code extensions.

## Running everything - 3 terminals required

```bash
cd image-viewer/
npm run dev          # http://localhost:5173 - also reachable on your LAN IP, see below

cd tiler/
dotnet build && dotnet run --urls http://0.0.0.0:5095

cd annotation-store/
dotnet build && dotnet run --urls http://0.0.0.0:5252
```

Optional: `cd dashboard/ && docker compose up -d` for load, timing and
error stats from `tiler` and `annotation-store` at http://localhost:3000.
The services run the same without it.

Each service has its own README with more detail. `image-viewer` is wired
up to both `tiler` (loads a real slide by default) and `annotation-store`
(annotations persist to Postgres, scoped per slide).

Binding to `0.0.0.0` (rather than `localhost`) and running `npm run dev`
(which passes `--host` to Vite) makes all three reachable from another
device on the same network - open `http://<this machine's LAN IP>:5173`
from it. `image-viewer` talks to whichever host it was itself loaded from,
and `tiler`/`annotation-store` accept any private-LAN origin, so no extra
config is needed either way - opening it via `localhost` still works
exactly as before.

This is the base setup for the real-time collaboration - all of this is
rough work and to be taken as proof of concept.

## Planning - real-time collaboration

Todos and notes, split by area, in [docs/](docs):

| Area                                       | What's in it                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| [Auth](docs/auth.md)                       | ory / authentik / keycloak - leaning Keycloak, how it connects to collections     |
| [Azure](docs/azure.md)                     | separate apps vs one VM, price tables, what has to change first                   |
| [Libraries](docs/libraries.md)             | Yjs / Automerge / Loro, the WebSocket (SignalR) hub, CRDT vs server-authoritative |
| [Thought process](docs/thought-process.md) | how users connect, guest vs authenticated, host controls, navigation modes        |
| [Rendering](docs/rendering.md)             | WebGPU question, what's on WebGL now, what the panning delay turned out to be     |

## Playback videos

Per tab videos:

| Annotations                                                                                          | Cell Counter                                                                                          | Rotation                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [![Annotations](https://img.youtube.com/vi/yB8OqfuKgpo/hqdefault.jpg)](https://youtu.be/yB8OqfuKgpo) | [![Cell Counter](https://img.youtube.com/vi/1cxGNTCnqkg/hqdefault.jpg)](https://youtu.be/1cxGNTCnqkg) | [![Rotation](https://img.youtube.com/vi/FFpnNC7cnAU/hqdefault.jpg)](https://youtu.be/FFpnNC7cnAU) |
| [Watch](https://youtu.be/yB8OqfuKgpo)                                                                | [Watch](https://youtu.be/1cxGNTCnqkg)                                                                 | [Watch](https://youtu.be/FFpnNC7cnAU)                                                             |

| Ruler                                                                                          | Image Adjustments                                                                                          | Tab docking                                                                                          |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [![Ruler](https://img.youtube.com/vi/A7aCQ3hAo0c/hqdefault.jpg)](https://youtu.be/A7aCQ3hAo0c) | [![Image Adjustments](https://img.youtube.com/vi/ofGUGfLdAzM/hqdefault.jpg)](https://youtu.be/ofGUGfLdAzM) | [![Tab docking](https://img.youtube.com/vi/CwzYsNc_thQ/hqdefault.jpg)](https://youtu.be/CwzYsNc_thQ) |
| [Watch](https://youtu.be/A7aCQ3hAo0c)                                                          | [Watch](https://youtu.be/ofGUGfLdAzM)                                                                      | [Watch](https://youtu.be/CwzYsNc_thQ)                                                                |
