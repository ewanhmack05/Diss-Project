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

## CI and deploy

GitHub Actions in [.github/workflows](.github/workflows). Each folder has
its own workflow, run on a push to any branch that changes that folder (or
the workflow itself). They can also be run by hand from the Actions tab.

| Workflow | Runs |
| --- | --- |
| [annotation-store](.github/workflows/annotation-store.yml), [realtime-hub](.github/workflows/realtime-hub.yml) | `dotnet format` check, build with warnings as errors, xUnit tests, Docker build |
| [tiler](.github/workflows/tiler.yml) | the same, minus tests (none yet). Docker build without LFS, so slide 003 is pointer files |
| [image-viewer](.github/workflows/image-viewer.yml) | `npm ci`, oxlint, vitest, `tsc -b` + Vite build |
| [auth](.github/workflows/auth.yml) | shellcheck, compose check, realm has its clients, Keycloak starts and imports the realm |
| [dashboard](.github/workflows/dashboard.yml) | compose check, provisioning YAML and dashboard JSON parse |
| [scripts](.github/workflows/scripts.yml) | ruff, Python compiles |
| [stack](.github/workflows/stack.yml) | root `docker-compose.yml` is valid |

The three .NET workflows share their steps through
[dotnet.yml](.github/workflows/dotnet.yml), a reusable workflow that
never runs on its own, so it has no badge. Each Docker build
is build only. Pushing images is the deploy workflow's job.

[deploy-azure.yml](.github/workflows/deploy-azure.yml) is a skeleton for
Option A in [docs/azure.md](docs/azure.md): images to GHCR, Container Apps
for the backend, Static Web Apps for the viewer. Manual trigger only, with
what still needs filling in listed at the top.

[![image-viewer](https://github.com/ewanhmack05/Diss-Project/actions/workflows/image-viewer.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/image-viewer.yml)
[![tiler](https://github.com/ewanhmack05/Diss-Project/actions/workflows/tiler.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/tiler.yml)
[![annotation-store](https://github.com/ewanhmack05/Diss-Project/actions/workflows/annotation-store.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/annotation-store.yml)
[![realtime-hub](https://github.com/ewanhmack05/Diss-Project/actions/workflows/realtime-hub.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/realtime-hub.yml)
[![auth](https://github.com/ewanhmack05/Diss-Project/actions/workflows/auth.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/auth.yml)
[![dashboard](https://github.com/ewanhmack05/Diss-Project/actions/workflows/dashboard.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/dashboard.yml)
[![scripts](https://github.com/ewanhmack05/Diss-Project/actions/workflows/scripts.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/scripts.yml)
[![stack](https://github.com/ewanhmack05/Diss-Project/actions/workflows/stack.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/stack.yml)
[![deploy-azure](https://github.com/ewanhmack05/Diss-Project/actions/workflows/deploy-azure.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/deploy-azure.yml)

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

**Keycloak set up before the Users tab?** If your Keycloak was first started
before the `realtime-hub` client was added to the realm, run this once while
it's up, or the Users tab only shows who's online (it says "Couldn't load
everyone from Keycloak"):

```bash
./auth/add-realtime-hub-client.sh
```

A brand new Keycloak gets the client from the realm import and doesn't need
it. See [auth/README.md](auth/README.md#adding-the-realtime-hub-client).

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
| [Guests](docs/guests.md)                   | joining without an account - the token, what's never saved, the name filter      |
| [Rendering](docs/rendering.md)             | WebGPU question, what's on WebGL now, what the panning delay turned out to be     |
| [Timing](docs/timing.md)                  | what annotation-store's reads take, the 40ms the dev proxy adds, what would help  |
| [Breakdowns](docs/breakdown)               | how each service works, plus [version control](docs/breakdown/version-control.md) across all of them - change sets, putting things back, the History tab |

### Data
All example slide data has been sourced from https://openslide.cs.cmu.edu/download/openslide-testdata/Mirax/
## Playback videos
Most, if not all Pull requests will have videos showing what has been added

Per tab videos:

| Annotations                                                                                          | Cell Counter                                                                                          | Rotation                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [![Annotations](https://img.youtube.com/vi/yB8OqfuKgpo/hqdefault.jpg)](https://youtu.be/yB8OqfuKgpo) | [![Cell Counter](https://img.youtube.com/vi/1cxGNTCnqkg/hqdefault.jpg)](https://youtu.be/1cxGNTCnqkg) | [![Rotation](https://img.youtube.com/vi/FFpnNC7cnAU/hqdefault.jpg)](https://youtu.be/FFpnNC7cnAU) |
| [Watch](https://youtu.be/yB8OqfuKgpo)                                                                | [Watch](https://youtu.be/1cxGNTCnqkg)                                                                 | [Watch](https://youtu.be/FFpnNC7cnAU)                                                             |

| Ruler                                                                                          | Image Adjustments                                                                                          | Tab docking                                                                                          |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [![Ruler](https://img.youtube.com/vi/A7aCQ3hAo0c/hqdefault.jpg)](https://youtu.be/A7aCQ3hAo0c) | [![Image Adjustments](https://img.youtube.com/vi/ofGUGfLdAzM/hqdefault.jpg)](https://youtu.be/ofGUGfLdAzM) | [![Tab docking](https://img.youtube.com/vi/CwzYsNc_thQ/hqdefault.jpg)](https://youtu.be/CwzYsNc_thQ) |
| [Watch](https://youtu.be/A7aCQ3hAo0c)                                                          | [Watch](https://youtu.be/ofGUGfLdAzM)                                                                      | [Watch](https://youtu.be/CwzYsNc_thQ)                                                                |
