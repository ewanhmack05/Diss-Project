# Diss Project

Dissertation project on real-time collaboration around whole-slide image
annotation. Proof of concept, one collaborator for now.

```
image-viewer/      React + TypeScript + OpenLayers frontend. See image-viewer/README.md
tiler/              .NET tile server for .mrxs whole-slide images. See tiler/README.md
annotation-store/   .NET + Postgres backend for persisted annotations. See annotation-store/README.md
dashboard/          Grafana (Docker) - load, timing and error stats for the services. See dashboard/README.md
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

This is the base setup for the real time collaberation, all of this is rough work and to be taken as proof of concept

Todos for real time collaberation:

- Set up auth, look into:
  - ory
  - authentik
  - keycloak

- Azure hosting? Something to discuss in future
  - Most likely set up in a container stack on a VM, saves me having to think too much about the architecture of it, also saves pricing wise
  - May be better setting up separate services
  - Will need 1 db (annotation store), Only 1 image will be properly used for this so the tiler can get a hard coded image and path. Users will theoretically be handled by the auth and or azure

  - Web app for the actual viewer
  - app service for each different service, 2 so far, 3 if i add the webhook api [1]

- Main setup for real time collap will be mutiple webooks running constant with the annotation store
  Libraries to look into:
- Yjs
- Automerge
- Loro
- A WebSocket layer broadcasts operations between everyone viewing that slide
  Periodically (or on save), CRDT state gets flattened and persisted into the existing .NET annotation store schema, so downstream querying/reporting doesn't need to change
- Figure out connections, how will 2 users start the connection with eachother
- Options:
  - Url given out for session?
  - Session string given out, e.g. 4 digit connection code fed into a panel?
  - List of users currently online and a `request to connect` system?
  - My thoughts:
    - 2 types of user, authenticated and unauthenticated
    - to invite authenticated we can use a basic user list (this can be supplied by either a self built user management or keycloak (probably just first name and last name, keep emails hidden))
    - to invite unauthenticated we can share a short lifetime url
    - host will have control over view only and ability to draw
    - host can kick/remove users
    - Navigations? Will owners navigation be the law or will each user navigate on their own. Is this something the owner can control? As a streaming rather than collaberation

- [1] New api to deal with real time processing, sitting between annotation store and viewer?
  - connect tiler in, keep this new service as a centeralised processing for all of the existing services and keep webhooks there rather than their own services
  - Also easier to port

  - Look into events too

- Webgpu for openLayers?
  - Taking into account we could have 2 or more users drawing for an unknown amount of time, the load on openLayers could expand, so delegating the devices gpu to the rendering would save browser power and deal with the load

Playback video:
[![Watch the video](https://img.youtube.com/vi/6oge35ZzH3w/maxresdefault.jpg)](https://youtu.be/6oge35ZzH3w)
