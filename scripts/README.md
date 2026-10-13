# scripts

[![scripts](https://github.com/ewanhmack05/Diss-Project/actions/workflows/scripts.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/scripts.yml)

One-off and dev scripts that sit outside the services - test data, database
maintenance and the like. Python scripts use the standard library only, so
there's nothing to install. Run them from the repo root.

## Stress-test data

For testing how the viewer copes with a heavy load - mainly the WebGL
layers for annotations and cell-count dots.

| Script              | Does                                                                  |
|---------------------|-----------------------------------------------------------------------|
| `seed_stress.py`    | Adds lots of annotations and cell counts to a slide's collection      |
| `clean_stress.py`   | Removes exactly what `seed_stress.py` added, and nothing else         |
| `map_bench.js`      | Measures the viewer's frame rate while panning and zooming            |
| `keycloak_login.py` | Signs the two Python scripts in - not run on its own                  |

Both Python scripts need `annotation-store` and Keycloak (`auth/`) running.
`seed_stress.py` also needs `tiler`, to look up the slide's size so shapes
land on the slide.

They sign in as a test user from the realm - `alice` by default - and work
on that user's own collection for the slide, the one the viewer shows when
signed in as them. The image-viewer client doesn't allow a plain password
grant, so `keycloak_login.py` goes through the same sign-in page a browser
does.

```bash
python scripts/seed_stress.py      # 2000 annotations + counts of 1k, 10k and 50k dots
python scripts/clean_stress.py     # remove them again
```

Everything added has its notes set to `stress-test` - that's how
`clean_stress.py` tells it apart from real annotations. Labels start with
"Stress".

### Options

Both default to slide `003`, signed in as `alice` / `password`.

```bash
# bigger load
python scripts/seed_stress.py --annotations 5000 --dots 1000 10000 100000

# annotations only, no cell counts
python scripts/seed_stress.py --dots

# another slide
python scripts/seed_stress.py --slide 002
python scripts/clean_stress.py --slide 002

# as another test user (sign in to the viewer as them to see it)
python scripts/seed_stress.py --username bob

# all options
python scripts/seed_stress.py --help
```

`seed_stress.py` uses a fixed random seed, so the same options give the same
shapes every run - handy for comparing before/after numbers. Change it with
`--seed`.

What gets added:

- **Annotations** - a mix of polygons, rectangles, circles (50-sided, like
  the circle tool), lines, arrows and freehand traces (120 points), in the
  viewer's colours. About a third are dashed.
- **Cell counts** - one per `--dots` value, with the dots clustered in
  blobs like cells. Every second one also gets an ROI box. View one from
  Cell Count > Saved > View on map - only one saved count is shown at a
  time. One count can have at most 1,000,000 dots, because annotation-store
  takes a new count of up to 80 MiB. `seed_stress.py` refuses anything
  bigger before it adds anything. For more dots, use several counts:
  `--dots 1000000 1000000`.

Annotations only show while the Annotations panel is open.

### Measuring the map

`map_bench.js` is pasted into the browser's devtools console on the viewer,
then run with `await mapBench()`. It pans and zooms the map with synthetic
mouse events and prints frame rate, worst frames and long tasks for each
step, plus the redraw cost when the view settles (dev server only). The
browser tab has to be visible - hidden tabs don't draw frames. Details and
options are at the top of the file.

Results so far, and what breaks first, are in
[docs/rendering.md](../docs/rendering.md#where-the-map-breaks---measured-2026-10-13).

### Tests

```bash
python -m unittest discover -s scripts
```

Covers the parts of `keycloak_login.py` that don't need Keycloak (reading
the sign-in form and the redirect) and `seed_stress.py`'s dot limit,
including that the largest count it allows really fits under 80 MiB. CI
runs them with ruff.

## SQL

For the annotation-store database (`annotationtest` by default - see
`annotation-store/.env`). Plain Postgres SQL, so they run from `psql`,
pgAdmin's query tool, or VS Code's database extension.

| Script                             | Does                                                                   |
|------------------------------------|------------------------------------------------------------------------|
| `counts.sql`                       | Row counts per table, then per slide. Read-only                        |
| `delete_all_annotations.sql`       | Deletes every annotation                                               |
| `delete_all_cell_counts.sql`       | Deletes every cell count, and their ROI boxes                          |
| `delete_all_image_adjustments.sql` | Deletes every saved adjustment preset                                  |
| `delete_slide_data.sql`            | Deletes annotations, counts and presets for one slide - edit the id    |
| `delete_stress_test.sql`           | Deletes what `seed_stress.py` added. No need for annotation-store      |
| `reset_all.sql`                    | Empties everything, collections included. Tables and migrations stay   |

The deletes cover every slide and every user unless the script says
otherwise. Each runs in a single transaction, so it either fully happens or
doesn't happen at all. Run `counts.sql` first to see what's there.

Collections are only removed by `reset_all.sql`. annotation-store recreates
a collection the next time its slide is opened, so the viewer copes with
any of these while it's running - reload the page to see the change.

### Running with psql

`psql` isn't on the PATH by default on Windows - use the full path, and
it'll ask for the postgres password (the one in `annotation-store/.env`):

```bash
"/c/Program Files/PostgreSQL/18/bin/psql.exe" -h localhost -U postgres -d annotationtest -f scripts/sql/counts.sql
```
