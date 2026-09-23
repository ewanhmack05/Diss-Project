# scripts

One-off and dev scripts that sit outside the services - test data, database
maintenance and the like. Python scripts use the standard library only, so
there's nothing to install. Run them from the repo root.

## Stress-test data

For testing how the viewer copes with a heavy load - mainly the WebGL
layers for annotations and cell-count dots.

| Script            | Does                                                                  |
|-------------------|-----------------------------------------------------------------------|
| `seed_stress.py`  | Adds lots of annotations and cell counts to a slide's collection      |
| `clean_stress.py` | Removes exactly what `seed_stress.py` added, and nothing else         |

Both need `annotation-store` running. `seed_stress.py` also needs `tiler`,
to look up the slide's size so shapes land on the slide.

```bash
python scripts/seed_stress.py      # 2000 annotations + counts of 1k, 10k and 50k dots
python scripts/clean_stress.py     # remove them again
```

Everything added has its notes set to `stress-test` - that's how
`clean_stress.py` tells it apart from real annotations. Labels start with
"Stress".

### Options

Both default to slide `003` and user `001` (the viewer's placeholder user).

```bash
# bigger load
python scripts/seed_stress.py --annotations 5000 --dots 1000 10000 100000

# annotations only, no cell counts
python scripts/seed_stress.py --dots

# another slide
python scripts/seed_stress.py --slide 002
python scripts/clean_stress.py --slide 002

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
  Cell Count > Saved > View - only one saved count is shown at a time.

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
