# Azure hosting

Something to discuss in future.

- Most likely set up in a container stack on a VM - saves having to think too much about the architecture of it, also saves pricing wise
- May be better setting up separate services
  - Web app for the actual viewer
  - App service for each different service - 2 so far, 3 if the real-time API is added (see [libraries.md](libraries.md))
- Will need 1 db (annotation store). Only 1 image will be properly used, so the tiler can get a hard coded image and path. Users will theoretically be handled by the auth and/or Azure (see [auth.md](auth.md))

## Option A - separate apps

Rough price idea:

| Piece | Azure service | Settings | Rough cost/month |
|---|---|---|---|
| image-viewer | **Static Web Apps** | free tier, HTTPS and CDN included | £0 |
| tiler | **Container Apps** | scales to zero, slide 003 built into the image (~3.2 GB), cold start ~1–3 min | ~£0–5 |
| annotation-store | **Container Apps** | scales to zero | ~£0–10 |
| Keycloak | **Container Apps** | **always 1 copy running** (Java, 512 MB–1 GB), optimised image, realm imported from JSON | ~£15–30 |
| Real-time hub (later) | **Container Apps** | exactly 1 copy, WebSockets | ~£0–10 |
| Postgres | **Azure Database for PostgreSQL Flexible**, B1ms | two databases: `annotationstore` and `keycloak`, backups included | ~£12–15 |
| Container images | **GitHub Container Registry** (free) or **Azure Container Registry Basic** | stores the built images | £0 or ~£4 |

Roughly **£30-70/month**. Estimates - check against the Azure pricing calculator.

## Option B - one VM

Every service as a container on one Linux VM, so the cost is the VM rather
than per service:

| Piece | How it runs | Memory (rough) | Cost |
|---|---|---|---|
| Caddy | reverse proxy, automatic HTTPS, one domain routed by path | ~50 MB | included |
| image-viewer | static files served by Caddy | – | included |
| tiler | container, slide 003 on the VM disk - no cold start | ~0.5 GB | included |
| annotation-store | container | ~150 MB | included |
| Keycloak | container, always on | 0.7–1 GB | included |
| Real-time hub (later) | container | ~150 MB | included |
| Postgres | container + volume, two databases | 0.3–0.5 GB | included |
| Stats | Grafana `otel-lgtm`, reached over an SSH tunnel only | 1–2 GB | included |
| **VM** | **B2ms** - 2 vCPU, 8 GB (~3.5–5 GB used) | | **~£50–55** |
| OS disk | Standard SSD, 64 GB | | ~£4–5 |
| Static public IP | for the domain | | ~£3 |
| Backups | nightly `pg_dump` to Blob Storage | | ~£1 |

Roughly **£58-65/month** running 24/7, **~£30-35** with overnight
auto-shutdown. Dropping Grafana for Application Insights could fit a B2s
(4 GB, ~£25-28 for the VM), but it's tight with Keycloak.

## Side by side

| | Separate apps | One VM |
|---|---|---|
| Monthly cost | ~£30–70 | ~£58–65 (24/7), ~£30–35 (overnight shutdown) |
| Tiler cold start | 1–3 min | none |
| Stats | Application Insights | Grafana, same as local |
| CORS | needed - each service on its own domain | none - single domain |
| Upkeep | none | OS updates, Docker, backups |
| Portability | tied to Azure | runs anywhere |

## Decisions so far

- Tiler scales to zero - slow first start is fine to save cost
- Only slide 003 goes into the tiler image
- Keycloak for auth, not Entra

## To handle either way

1. **Tiler only runs on Windows today** - `OpenSlideSharp.runtime.win` bundles Windows OpenSlide only. Try it in a Linux container with `apt install libopenslide0` first (~half a day). This decides a lot.
2. Dockerfiles for tiler and annotation-store, plus one local compose file - ~1 day
3. Configurable service URLs in the viewer, instead of "same host, fixed port" - ~2 hours
4. "Tile server is starting" state in the viewer instead of the connection error, for the cold start - ~1 hour
5. Container Apps ephemeral storage limit - check a ~3.2 GB image fits. Fallback: mount the slide from Azure Files.

## Before anything is public

- CORS currently accepts any private-LAN origin
- Grafana is anonymous admin - put it behind a login or SSH tunnel
- Port 4317 (telemetry) must stay internal
- Scalar/OpenAPI stay Development-only
