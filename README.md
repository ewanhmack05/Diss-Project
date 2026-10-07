# Diss Project

Dissertation project on real-time collaboration around whole-slide image
annotation. Proof of concept, one collaborator for now.

```
image-viewer/      React + TypeScript + OpenLayers frontend. See image-viewer/README.md
tiler/              .NET tile server for .mrxs whole-slide images. See tiler/README.md
annotation-store/   .NET + Postgres backend for persisted annotations. See annotation-store/README.md
realtime-hub/       .NET SignalR hub - rooms per slide, live annotation ops and viewports. See realtime-hub/README.md
auth/               Keycloak (Docker) - sign-in, with a realm and test users. See auth/README.md
dashboard/          Grafana (Docker) - load, timing and error stats for the services. See dashboard/README.md
scripts/            Dev scripts - stress-test data, SQL. See scripts/README.md
docs/               Planning notes - auth, Azure, real-time libraries, sessions, rendering
```

## Prerequisites

New machine? See [SETUP.md](SETUP.md) for installing .NET 10, Node.js,
PostgreSQL, Git LFS, and recommended VS Code extensions.

## Running everything - 3 terminals required

```bash
cd auth/             # once - Keycloak keeps running in Docker after this
docker compose up -d

cd image-viewer/
npm run dev          # https://localhost:5173 - also reachable from other machines, see below

cd tiler/
dotnet build && dotnet run --urls http://localhost:5095

cd annotation-store/
dotnet build && dotnet run --urls http://localhost:5252

cd realtime-hub/     # optional - the viewer works without it, just not live
dotnet build && dotnet run --urls http://localhost:5180
```

### Or with Docker - 2 terminals

Everything behind the viewer runs in containers from the root
`docker-compose.yml` - Keycloak, the tiler (slide 003 only), annotation-store
with its own Postgres, and the realtime hub - on the same ports as above, so
the viewer doesn't know the difference:

```bash
docker compose -f auth/docker-compose.yml down   # if the auth/ stack is up - this one includes it
docker compose up -d --build                     # first build takes a few minutes, mostly the slide

cd image-viewer/
npm run dev
```

`docker compose down` stops it. Its Keycloak and annotation-store keep their
data in their own Docker volumes, separate from the `auth/` stack and your
local Postgres - so annotations from one don't show in the other.

Optional: `cd dashboard/ && docker compose up -d` for load, timing and
error stats from `tiler` and `annotation-store` at http://localhost:3000.
The services run the same without it.

Each service has its own README with more detail. `image-viewer` is wired
up to both `tiler` (loads a real slide by default) and `annotation-store`
(annotations persist to Postgres, scoped per slide).

Sign in with one of the test users in [auth/README.md](auth/README.md)
(`alice`, `bob` or `carol`, password `password`). The viewer uses a
self-signed certificate, so the browser warns once - sign-in needs https
anywhere but localhost.

To share it with another machine (LAN or VPN), they open
`https://<this machine's IP>:5173`. Only port 5173 needs to be reachable -
the Vite server proxies `/tiler`, `/store`, `/hub` and `/auth` through to the
services on localhost (see `image-viewer/vite.config.ts`), so they stay off
the network and no firewall rules are needed for them. `npm run dev` passes
`--host`, so Vite already listens on every interface. `vite preview` uses
the same proxy.

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
| [Breakdowns](docs/breakdown)               | per-service walkthroughs of how each one works - [realtime-hub](docs/breakdown/realtime-hub.md) so far |

### Data
All example slide data has been sourced from https://openslide.cs.cmu.edu/download/openslide-testdata/Mirax/
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
