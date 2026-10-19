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
| `simulate_session.py` | Fills a session with simulated people who move round live - see [below](#simulated-people-in-a-session) |
| `simulate_annotations.py` | Same, and the editors draw shapes live in what they're looking at - see [below](#drawing-and-counting) |
| `simulate_cell_counts.py` | Same, and the editors count cells live in what they're looking at - see [below](#drawing-and-counting) |
| `teardown_users.py` | Removes test users from Keycloak, and from the sessions they joined - see [below](#removing-test-users) |
| `keycloak_login.py` | Signs the Python scripts in - not run on its own                      |
| `keycloak_admin.py` | Keycloak's admin API for the two above - not run on its own          |

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
the sign-in form and the redirect), `seed_stress.py`'s dot limit,
including that the largest count it allows really fits under 80 MiB, and
`simulate_session.py`'s link parsing, made up people, viewport maths and
SignalR message framing, the shapes and dots the drawing and counting
scripts make (all inside the view, valid part way through), and who
`teardown_users.py` removes and protects.
CI runs them with ruff.

## Simulated people in a session

`simulate_session.py` fills a session with made up people, for trying out
large sessions, who joins as an editor and viewport boxes without a room full of
laptops. It needs Keycloak, annotation-store, realtime-hub and tiler
running.

1. In the viewer, start a session and make a link (Realtime > Session >
   Make a link). An edit link shows the first few joining as editors; a view only one lets
   everyone in view only.
2. Give the script the link, or just its code:

```bash
python scripts/simulate_session.py "https://localhost:5173/?invite=juyhsUFHC4gB"
python scripts/simulate_session.py juyhsUFHC4gB --people 12 --seconds 60
python scripts/simulate_session.py juyhsUFHC4gB --no-hub     # join, but don't show up live
python scripts/simulate_session.py juyhsUFHC4gB --leave      # take them out of the session again
```

Each one opens the link like a real person would, so annotation-store
decides their role - once the link has let its editors in, the rest come in view only.
It prints who got what:

```
Joining through the link (editor)
  Dana Price           editor
  ...
  Ivo Novak            viewer
9 people in it, 6 editing, 3 view only - a large session (an edit link lets in 6 editors)
```

Then they connect to realtime-hub and look round the slide until Ctrl+C
(or `--seconds`), so they show up as chips in the viewer with viewport
boxes that move. In a large session the boxes start off - click a chip to
see one. Stopping leaves them in the session; `--leave` takes them out.

The people are Keycloak users `sim1`, `sim2`, ... (password `password`),
up to 40. The script makes any that don't exist yet through Keycloak's
admin API, signed in as the dev admin from `auth/docker-compose.yml`
(`--admin-user` / `--admin-password` to change it). Their names are made
up. They talk to realtime-hub over SignalR long polling, since the
standard library has no WebSocket client and the hub takes either.

### Drawing and counting

Two more do the same as `simulate_session.py`, and also have the people who
can edit do something every so often - in what they're looking at, holding
their view still while they do, like a real person. View-only people just
watch.

| Script | Editors... | Everyone sees |
|--------|-----------|---------------|
| `simulate_annotations.py` | draw a shape (polygon, rectangle, circle, line, arrow or freehand) and save it | it grow as it's drawn, then saved |
| `simulate_cell_counts.py` | click dots a few a second, sometimes inside a region of interest box, and save the count | the dots and tally go up as they click, then saved |

Both send what the viewer sends - sketches while drawing or counting, then
an op to everyone and the save to annotation-store - so the viewer can't
tell them from real people.

```bash
python scripts/simulate_annotations.py juyhsUFHC4gB                    # a shape each every 8s or so
python scripts/simulate_annotations.py juyhsUFHC4gB --draw-every 3 --seconds 120
python scripts/simulate_cell_counts.py juyhsUFHC4gB                    # a count each every 20s or so
python scripts/simulate_cell_counts.py juyhsUFHC4gB --dots 50 150 --clicks-per-second 5 --roi 1

python scripts/simulate_annotations.py juyhsUFHC4gB --clean            # remove what they drew
python scripts/simulate_cell_counts.py juyhsUFHC4gB --clean            # remove their counts
```

Everything they make has its notes set to `sim-session`. `--clean` finds
those in the session, deletes them as one of the sim editors, and tells
anyone watching so it goes from their map too. It needs a sim person who
can still edit the session, so run it before `--leave`. Saved annotations
only show in the viewer with the Annotations panel open, like any others.

## Removing test users

`teardown_users.py` removes users from Keycloak - the sim users, or anyone
else added while testing. Before removing each one it signs in as them and
takes them out of every session they joined, on every slide, so they don't
stay behind in People lists.

**alice, bob and carol are never removed**, and nor are Keycloak's service
accounts (realtime-hub signs in with one). `--keep` protects more.

```bash
python scripts/teardown_users.py                     # who would go - changes nothing
python scripts/teardown_users.py --yes               # remove everyone but the protected ones
python scripts/teardown_users.py --sim-only --yes    # just sim1, sim2, ...
python scripts/teardown_users.py --keep dave --yes   # everyone but the protected ones and dave
```

Without `--yes` it only lists who would go. Signing in as them uses
`--password` (the test users' `password` by default) - anyone it can't sign
in as is still removed from Keycloak, and the output says they're still
listed in their sessions. Collections and sessions they own are left alone
and listed, since other people's work can be in them; `--delete-owned`
deletes those too. `--keycloak-only` skips the sessions and just removes
the accounts. Needs Keycloak, and annotation-store and tiler for leaving
sessions.

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
