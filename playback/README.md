# playback

[![playback](https://github.com/ewanhmack05/Diss-Project/actions/workflows/playback.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/playback.yml)

Records the viewer being used and saves it as MP4s, showing everything it does,
so the videos can be remade with one command instead of by hand. It drives the
real app with a real mouse and keyboard through Playwright, in your installed
Chrome.

## Running it

Needs Chrome, ffmpeg (see [SETUP.md](../SETUP.md)) and everything running -
`python scripts/run_all.py` from the repo root.

```bash
cd playback
npm ci
npx playwright install ffmpeg      # once - the encoder Playwright captures with
node record.js                     # every scene, about half an hour
```

```bash
node record.js --only ruler rotation   # just these
node record.js --list                  # the scenes
node record.js --headed                # watch it happen
node record.js --out ../some/folder    # save somewhere else
node record.js --clean                 # remove the recording users and what they made
```

Videos go in `playback/videos/`, which git ignores - video files don't belong in
the repo. Upload them wherever the PR needs them.

## The videos

One person:

| Video | Shows |
| --- | --- |
| `signing-in.mp4` | Signing in, switching user, signing out |
| `map-navigation.mp4` | Pan, scroll, the zoom buttons, double click, shift-drag, Alt+Shift rotate, the scale bar, the overview map growing, jumping and folding away, fullscreen |
| `annotations.mp4` | All six shapes, thickness, dashes, palette and custom colours, redraw, moving a shape before saving, quick draw, and Saved - search, every filter, view on map, editing, deleting |
| `annotation-groups.mp4` | Box, lasso, shift and click picking, Esc, All and Clear, moving the map, bulk recolour and delete with undo, and groups - making, adding, taking out, hiding, renaming, notes, recolouring, merging, deleting |
| `cell-counter.mp4` | Dot size, colours mid-count, undo and redo by button and key, recount, a plain tally, a region of interest placed and cancelled, and saved counts - search, filter, on the map, timeline, editing, deleting |
| `rotation.mp4` | Quick buttons, the dial, a typed angle, reset |
| `ruler.mp4` | Measuring, measuring again, clearing |
| `image-adjustments.mp4` | All six sliders, reset, and presets - saving, applying, updating, deleting |
| `tab-docking.mp4` | Floating, bringing to the front, docking to all four edges, sharing an edge, undocking, closing |
| `collections.mp4` | Renaming, sharing, importing GeoJSON with its preview, exporting, paging a long list |
| `history.mp4` | The list, its order and filter, one change, putting back, one annotation's timeline and going back on it, putting the whole collection back |

Side by side, each person's screen:

| Video | Shows |
| --- | --- |
| `collaboration.mp4` | Everything live between two people - joining, chips, seeing where someone's looking, shapes as they're drawn, two people typing in one label, colour changes, a count staying private until saved, the ruler, look here, opening a tab, Follow me with rotation and stepping out, Present with panels, tabs, a live count and adjustments following, back to Free |
| `counting-together.mp4` | A comparison - invite, counting blind, waiting, results with rings, saving, declining - and a shared count - one tally, cells counted twice, undo, leaving, saving |
| `session-admin.mp4` | Viewing someone's shared collection, the editor cap, first change wins, renaming, link settings, inviting from Users, view only, changing roles, a collision and its choice, taking someone out, a quiet session reopened, leaving, ending, deleting |
| `guests.mp4` | Joining with just a name, what a guest can't do, being listed for the host, being asked to edit, leaving |

## What "everything" means

[`lib/coverage.js`](lib/coverage.js) lists every feature, from reading the
viewer's components. A scene calls `did('feature')` once it's done that feature,
nearly always straight after checking it worked. Between two people the check is
on the other person's screen. `LOOKED_AT` in the same file lists the few that are
only a look on a canvas, like a dashed line - those were checked by eye in the
frames, so look again after changing them. And:

- A test fails if a feature on the list has no scene, so a new feature can't be
  forgotten - add it to the list and the test says it needs showing.
- `videos/manifest.json` records what each saved video proved, and each run ends
  by printing how much of the list the saved videos cover.

Anything deliberately not shown is in `NOT_SHOWN` in the same file, with why.

## How it works

- **`scenes/`** is the walkthroughs - `solo.js` for one person, `together.js` for
  two. To add one, write the function and add it to `scenes/index.js`.
- **Scenes check what they show.** Each one asserts the app really did it - the
  saved count went up, the readout changed, the other person saw it. If the app
  breaks, that scene fails and says so rather than saving a video of it not
  working. A screenshot of where it stopped goes in `videos/failed/`, and the
  other scenes still run.
- **Clicks check what's under them.** If something's covering the control, or it
  moves as the pointer arrives, the mouse would hit the wrong thing without saying
  so. The recorder follows it, and fails if it's covered.
- **It has its own users.** `playback-sam` and `playback-jo` (password
  `password`), made through Keycloak's admin API the first time, using the dev
  admin from `auth/docker-compose.yml`. Nobody's real annotations are touched or
  shown.
- **Each scene starts empty.** Before recording it deletes the collections those
  two own on the slide, and the viewer makes a new one on load. The store soft
  deletes, so these rows stay in Postgres until `scripts/sql/reset_all.sql`.
- **Videos start once the app is ready.** Recording starts when the page opens,
  so the sign-in is cut off the front with ffmpeg.
- **A pointer and captions are drawn into the page** (`lib/overlay.js`), because
  capture doesn't include the mouse. They don't take pointer events, so the app
  behaves as normal, and captions sit low so the viewer's toasts stay in view.
  They're not part of the viewer.
- **Two person scenes** record one browser context each and put them side by
  side, each cut to the same moment. That's close enough to follow along, around
  a few hundred ms, but it isn't a measure of how long something took to reach the
  other person - [docs/timing.md](../docs/timing.md) is for that.
- **Finished videos are checked** with ffprobe for codec, size and length.
- **Checks read whole page screenshots** and cut out the area themselves
  (`lib/pixels.js`). A clipped screenshot makes the page flash grey on video.
- **Progress is kept.** The manifest is written after every scene, so a run that
  dies keeps what it finished, and it won't start a scene with under 4 GB of
  memory free.

The labels in the videos ("Example region", "Round area") are made up and the
dots don't mark real cells. The videos show the tools, not a diagnosis.

## If it fails

- **"Not running: ..."** - start the services. It checks their ports first.
- **A scene fails after a UI change** - look at `videos/failed/<scene>-sam.png`.
  Scenes find controls by the text and labels people see, so renaming a button
  means changing the scene too.
- **"Stopping before ... GB of memory free"** - close something and run the rest
  with `--only`.
- **Positions on the slide** are for slide 003, the viewer's default, in a
  1600x900 window, or 960x900 each side by side. Another slide means changing
  `TISSUE` in `scenes/helpers.js`.

## Tests

```bash
npm test
```

Gate tests for what doesn't need a browser: the coverage list against the scenes,
pointer paths, flags and scene picking, the manifest, ffmpeg's arguments, checking
a finished video, the import file, and that only the recording users and their own
collections can be removed. Runs in about a second. CI runs them; it can't record,
as that needs the whole stack and a slide.

The scenes are tested by running them. No LLM is involved, so there are no evals.
