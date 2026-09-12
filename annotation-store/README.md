# annotation-store

ASP.NET Core (.NET 10) + EF Core (Npgsql) backend for persisted annotations
and cell counts, one Postgres database shared by both via a single
`AnnotationDbContext`.

## Running

```bash
dotnet run --project annotation-store --urls http://localhost:5252
```

In `Development`, the app runs any pending EF Core migrations against the
configured database automatically on startup - no manual
`dotnet ef database update` needed for a normal day-to-day pull.

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

- `GET /annotations?slideId=000` - all annotations for a slide
- `POST /annotations` - create one (body: `Annotation` minus `id`/`created`,
  both are assigned server-side if omitted)
- `PUT /annotations/{id}` - update `label`/`notes`/`colour`
- `DELETE /annotations/{id}` - delete

- `GET /cellcounts?slideId=000` - all cell counts for a slide
- `POST /cellcounts` - create one (body: `CellCount` minus `id`/`created`,
  both are assigned server-side if omitted)
- `PUT /cellcounts/{id}` - update `label`/`notes`/`withAnnotation`/`withRoi`/
  `count`/`dotSize`
- `DELETE /cellcounts/{id}` - delete

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
