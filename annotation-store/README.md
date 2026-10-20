# annotation-store

[![annotation-store](https://github.com/ewanhmack05/Diss-Project/actions/workflows/annotation-store.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/annotation-store.yml)

ASP.NET Core (.NET 10) + EF Core (Npgsql) backend for persisted annotations
and cell counts, one Postgres database shared by both via a single
`AnnotationDbContext`.

## Running

```bash
dotnet run --project annotation-store --urls http://localhost:5252
```

Localhost is enough even when sharing the viewer with other machines -
the viewer's dev server proxies to it (see the root README).

In `Development`, the app runs any pending EF Core migrations against the
configured database automatically on startup - no manual
`dotnet ef database update` needed for a normal day-to-day pull.
`Database__MigrateOnStartup=true` does the same in any environment - the
Docker image sets it.

### In Docker

```bash
docker build -t diss-annotation-store annotation-store
```

It needs a Postgres and Keycloak, so it's easiest through the root
`docker-compose.yml`, which sets everything it takes:
`ConnectionStrings__AnnotationStore`, `Auth__MetadataAddress` (Keycloak's
address inside Docker) and `OTEL_EXPORTER_OTLP_ENDPOINT`. Listens on 8080
in the container.

## Sign-in and collections

Every endpoint needs a Keycloak access token (see [auth/](../auth)), checked
in `Auth/KeycloakAuth.cs` - settings under `Auth` in `appsettings.json`. The
user always comes from the token's `sub`, never from the request. The only
exceptions are guests, below, and `GET /invites/{code}/guest`, which needs no
sign-in at all.

There are two kinds of collection:

- **Personal** - made automatically, one per person per slide
  (`POST /collections/ensure`). Only ever theirs.
- **Session** - started by someone (the host) to work with others, who join
  through an invite link. Ending one makes it read-only and stops its links,
  but keeps it so people can look back at it.

A personal collection can be **shared** by its owner. Anyone signed in then
sees it in their list for that slide and can read everything in it, as a
viewer, without being a member.

| Endpoint | Who | What |
| --- | --- | --- |
| `GET /collections?slideId=` | anyone | Collections on the slide you're in - your own, then sessions still going, then ended ones, then other people's shared ones - with your role, the members, how many annotations and cell counts each has, and when one was last added |
| `GET /collections/{id}` | members | Everything in it - annotations, cell counts, presets |
| `GET /collections/{id}/export` | members, or anyone if shared | Its annotations and cell counts (dots and ROI included), oldest first - what the viewer's GeoJSON export reads |
| `GET /collections/{id}/membership` | members | Your role, its kind and whether it's ended - what the realtime hub checks before letting you into a session's room |
| `POST /collections/ensure` | anyone | Get or create your own for `{ slideId }` |
| `POST /sessions` | anyone | Start a session on `{ slideId, collectionName? }`, hosted by you. One at a time per slide - with one not ended, it's a 409 with that one instead |
| `PUT /collections/{id}` | owner | Rename |
| `PUT /collections/{id}/sharing` | owner | Personal only - `{ shared }`. Lets anyone signed in view it, read-only |
| `POST /collections/{id}/import` | editor, owner | `{ annotations, cellCounts }` from a GeoJSON import, saved together and stamped as you |
| `DELETE /collections/{id}` | owner | Delete, with everything in it |
| `POST /collections/{id}/end` | host | End a session |
| `PUT /collections/{id}/members/{userId}` | host | Change someone's role - `{ displayName, role: "editor" \| "viewer" }` |
| `DELETE /collections/{id}/members/{userId}` | host, or that member | Take someone out, or leave |
| `POST /collections/{id}/invites` | host | New invite link - `{ role, hours }` (up to a week). Any earlier link stops |
| `GET /collections/{id}/invites` | host | The session's working link |
| `DELETE /collections/{id}/invites/{code}` | host | Stop a link |
| `GET /invites/{code}` | anyone with the code | What it's for - session, host, role, who's in it, and whether it's `open`, `expired`, `stopped` or `ended` |
| `POST /invites/{code}/accept` | anyone with the code | Join with the link's role. 410 if it's run out |
| `GET /invites/{code}/guest` | anyone, no sign-in | For joining as a guest - `{ collectionId, slideId, collectionName, hostName, status, expires }`. 404 for an unknown code |

Annotations, cell counts and image adjustments check the same membership:
any member can read, `editor` and `owner` can add, change and delete. Not
being a member gets a 404, so it doesn't give away whether it exists. Nothing
in an ended session can change (409).

### Guests

Someone without an account can open an invite link as a guest, view only.
realtime-hub gives them a guest token (contract in
[docs/guests.md](../docs/guests.md)), checked here in `Auth/GuestAuth.cs`:
HS256, signed with `GuestTokens:SigningKey` (base64, 32 bytes, the same value
as the hub's), issuer `realtime-hub`, audience `diss-guest`, and it has to be
in date. Its `sub` is a `guest-` id and `guest_session` is the one session
it's for. There's no name in it, so the name a guest types never reaches this
service.

A guest token only works on these, and is a 401 everywhere else:

- `GET /collections?slideId=` - just their session, with `myRole: viewer`,
  if it's on that slide. Otherwise `[]`
- `GET /collections/{id}/membership` - `role: viewer` for their session
- `GET /annotations`, `/annotations/total`, `/annotations/facets`
- `GET /cellcounts`, `/cellcounts/total`, `/cellcounts/facets`,
  `/cellcounts/{id}`
- `GET /annotationgroups`

On those a guest is a viewer of their own session (ended or not) and gets a
404 for anything else, a personal collection included, even a shared one.
Guests never get a row in `CollectionMembers` - nothing they can call writes
anything - so a session's member list is only ever people with accounts.

The key in `appsettings.json` is a dev key. Replace it before deploying
(`GuestTokens__SigningKey`), with the same value in realtime-hub.

## Pointing it at your database

Copy `.env.example` to `.env` and fill in your real connection string:

```bash
cp annotation-store/.env.example annotation-store/.env
```

```
ConnectionStrings__AnnotationStore=Host=localhost;Port=5432;Database=annotationtest;Username=postgres;Password=<yours>;
```

`.env` is gitignored - it never gets committed, `.env.example` (no real
values) is the tracked template. `Program.cs` loads it via `DotNetEnv`
before the host reads configuration, into the same
`ConnectionStrings__AnnotationStore` env var ASP.NET Core's built-in
environment-variables config source already understands (double
underscore = nested config key). That's deliberate: if this ever runs
somewhere hosted, the exact same env var - set by whatever's hosting it,
no `.env` file involved - works with zero code changes. `dotnet ef` (when
you run it directly, e.g. adding a new migration) doesn't go through
`Program.cs`'s startup code, so it won't see `.env` - export the same env
var in your shell first if you need to run an `ef` command against a
non-default database.

The target database (`annotationtest` above, or whatever name you use)
doesn't need to exist yet - `Database.Migrate()` on startup creates the
database itself (as long as the connecting user has that privilege - true
by default for Postgres' `postgres` superuser) as well as the schema.

## API

Everything is per collection - reading needs you in it, writing needs
editor or owner.

- `GET /annotations?collectionId=` - every annotation in the collection,
  newest first. What the map loads
- `GET /annotations?collectionId=&skip=&take=&search=` plus filters - one
  page of them, for the viewer's Saved list. All optional; `take` is 1-500.
  `search` matches label, notes or shape, ignoring case. The filters (see
  `SavedFilter` in `Paging/Paging.cs`):
  - `createdBy` - Keycloak user ids, repeat for more than one
  - `shape` - `rectangle`, `line`..., repeat for more than one
  - `colour` - hex, ignoring case, repeat for more than one
  - `otherThan` - any colour but these, alongside `colour` - the viewer's
    Custom sends its palette here
  - `hasNotes` - `true` or `false`
  - `group` - group ids, or `none` for ones not in a group, repeat for
    more than one
  - `from` / `to` - when it was saved, `from` included and `to` not
- `GET /annotations/total?collectionId=&search=` plus filters - how many
  there are, or how many match - for the page count
- `GET /annotations/facets?collectionId=` - what there is to filter by:
  `authors` (`{ id, name, count }` by name - rows from before sign-in aren't
  included) and `colours` (`{ colour, count }`, most used first)
- `POST /annotations` - create one (body: `Annotation` minus `id`/`created`,
  both are assigned server-side if omitted)
- `PUT /annotations/{id}` - update `label`/`notes`/`colour`
- `DELETE /annotations/{id}` - delete
- `PUT /annotations/bulk` - many at once, from the viewer's Select tab:
  `{ collectionId, ids, colour?, setGroup, groupId? }`. `colour` recolours
  them all; `setGroup` moves them all into `groupId`, or out of any group
  when it's null. Ids not in the collection are skipped - `{ count }` says
  how many changed. Up to 20,000 ids
- `POST /annotations/bulk-delete` - `{ collectionId, ids }`, same rules
- `GET /annotationgroups?collectionId=` - the collection's groups, by name,
  each with how many annotations are in it
- `POST /annotationgroups` - `{ collectionId, name, annotationIds? }` - a new
  group, with those annotations put straight in it
- `PUT /annotationgroups/{id}` - `{ name?, notes? }` - either or both
- `POST /annotationgroups/{id}/merge` - `{ intoId }` - moves everything into
  that group and deletes this one, in one transaction. Notes are joined
- `DELETE /annotationgroups/{id}` - delete it. Its annotations stay,
  ungrouped

A group (`Annotations/AnnotationGroup.cs`) is a named set of annotations in
one collection, one level deep - an annotation's `GroupId` is the one it's
in, if any, and always one in the same collection (a 400 otherwise). Groups
go out in a GeoJSON export by name, with their notes, and an import puts
annotations into the collection's group of that name, making it if there
isn't one and adding the file's notes for it.

- `GET /cellcounts?collectionId=&skip=&take=&search=` plus filters - same
  as annotations, but `withRoi` (`true`/`false`) instead of `shape` and
  `colour`; `search` matches label or notes. Without the dots (`dots` is null) - each
  count has `colourCounts` and `placedByCounts` instead, worked out when
  it's saved and kept on the row (`CellCounts/CellCountSummary.cs`). Counts
  from before that get them the first time they're listed
- `GET /cellcounts/total?collectionId=&search=` plus filters - same as annotations
- `GET /cellcounts/facets?collectionId=` - same as annotations, with
  `colours` always empty
- `GET /cellcounts/{id}` - one count, dots and ROI box included
- `POST /cellcounts` - create one (body: `CellCount` minus `id`/`created`,
  both are assigned server-side if omitted). Takes up to 80 MiB, room for a
  million dots - everything else has Kestrel's 30 MB default
- `PUT /cellcounts/{id}` - update `label`/`notes`/`withAnnotation`/`withRoi`/
  `count`/`dotSize`
- `DELETE /cellcounts/{id}` - delete

Bad `skip`/`take` is a 400. Paging is newest first with the id breaking
ties, so no row turns up on two pages.

## Schema

`Annotations/Annotation.cs`:

| field           | type          | notes                                                                                               |
| --------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `Id`            | uuid, PK      | client-generated (matches `image-viewer`'s `crypto.randomUUID()`) if provided, else server-assigned |
| `SlideId`       | text, indexed | which slide this annotation belongs to                                                              |
| `Label`         | text          |                                                                                                     |
| `Notes`         | text          |                                                                                                     |
| `Colour`        | text          |                                                                                                     |
| `Shape`         | text          | `line` / `freehand` / `polygon` / `arrow` / `rectangle` / `circle`                                  |
| `LineStyle`     | text          | `solid` / `dashed`                                                                                  |
| `LineThickness` | int           |                                                                                                     |
| `GeoJson`       | text          | the drawn feature, as written by `image-viewer`'s `featureToGeoJson`                                |
| `GroupId`       | uuid, null    | the `AnnotationGroup` it's in, if any - always one in the same collection                           |
| `Created`       | timestamptz   | server-assigned                                                                                     |

`CellCounts/CellCount.cs` - a user-placed dot marker for manually counting
cells (e.g. mitotic figures) within a region:

| field            | type          | notes                                                         |
| ---------------- | ------------- | ------------------------------------------------------------- |
| `Id`             | uuid, PK      | server-assigned if omitted, same convention as `Annotation`   |
| `SlideId`        | text, indexed | which slide this count belongs to                             |
| `Label`          | text          |                                                               |
| `Notes`          | text          |                                                               |
| `Dots`           | text          | JSON array of `{x, y, colour}`, one per dot placed - lets the viewer redraw the tally (and derive a colour breakdown for its saved-list swatch) instead of just zooming to it |
| `WithAnnotation` | bool          | tied to a specific drawn annotation, rather than freestanding |
| `WithRoi`        | bool          | scoped to a region of interest                                |
| `Count`          | int           | the running tally                                             |
| `DotSize`        | int           | marker size for the placed dots                               |
| `LocationX`      | double, null  | where the count was taken (slide pixel space), fixed at creation - null for a count with no recorded location |
| `LocationY`      | double, null  | see `LocationX`                                                |
| `Created`        | timestamptz   | server-assigned                                               |

`Annotations/AnnotationGroup.cs` - a named set of annotations in one
collection:

| field          | type     | notes                                             |
| -------------- | -------- | ------------------------------------------------- |
| `Id`           | uuid, PK | server-assigned                                   |
| `CollectionId` | uuid     | which collection it's in - deleting that deletes it |
| `Name`         | text     | up to 64 characters                               |
| `Notes`        | text     | up to 10,000 characters                           |
| `Created`      | timestamptz | server-assigned                                |
