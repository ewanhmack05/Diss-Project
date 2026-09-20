# flywire-bot

A simulated second collaborator for the whole-slide viewer's real-time
collaboration work. It replays real public data from the [FlyWire](https://codex.flywire.ai)
fruit fly brain connectome into `annotation-store` as a steady stream of
annotations and cell counts, landing in the same collection a real browser
session uses - so opening `image-viewer` shows a slide that another
"person" appears to be actively drawing on and counting cells on, live.

The data itself is scientifically meaningless in this context (a fly
neuron's position has nothing to do with a pathology slide's pixel grid) -
what matters is that it's real, varied, and effectively inexhaustible,
which is exactly what a liveness demo needs and synthetic/random data
doesn't convincingly provide.

## Setup

```bash
npm install
npm run prepare-data   # downloads ~880MB, parses it, writes data/seed.json - see below
npm start               # runs the bot against a locally running tiler + annotation-store
```

`npm start` reads `data/seed.json` (already generated and committed - most
people never need to run `prepare-data` again) and posts to whatever
`tiler`/`annotation-store` are configured via env vars, defaulting to the
usual local ports:

| env var                 | default                 |
| ------------------------ | ------------------------ |
| `ANNOTATION_STORE_URL`   | `http://localhost:5252`  |
| `TILER_URL`               | `http://localhost:5095`  |
| `SLIDE_ID`                 | `000`                    |
| `BOT_USER_ID`              | `001` (see below)        |
| `BOT_INTERVAL_MS`          | `8000`                   |
| `SEED_PATH`                | `data/seed.json`         |
| `BOT_LIVE_PORT`            | `5300`                   |

`BOT_USER_ID` defaults to `001` - the same placeholder every real browser
session resolves to today (`image-viewer/src/context/CollectionContext.tsx`
has no real auth yet). That's deliberate: the bot writes into the one
collection that actually gets displayed, rather than an isolated collection
nothing in the UI can show alongside it yet (multi-collection overlay is
real-time-collaboration work the root README already lists as unbuilt).

Stop it with Ctrl+C.

## Where the data comes from

Two public FlyWire release files, both citable, neither requiring a CAVE
token or FlyWire account:

- **`Supplemental_file1_neuron_annotations.tsv`** (32MB) -
  [github.com/flyconnectome/flywire_annotations](https://github.com/flyconnectome/flywire_annotations) -
  neuron id, cell type, super_class, side, neurotransmitter, and real 3D
  soma coordinates for ~139k neurons.
- **`proofread_connections_783.feather`** (~850MB, LZ4-compressed Arrow IPC) -
  [zenodo.org/records/10676866](https://zenodo.org/records/10676866) -
  ~16.8M real pre/post synaptic connection rows (per neuropil).

**Citation** (required by the source repo's README - keep this if the seed
data or this approach gets reused elsewhere):

> Dorkenwald et al. (2024) Neuronal wiring diagram of an adult brain.
> Nature. Schlegel et al. (2024) Whole-brain annotation and
> multi-connectome cell typing quantifies circuit stereotypy in
> Drosophila. Nature.

## What `prepare-data` actually does

`scripts/prepare-seed-data.ts`:

1. Parses the neuron TSV, keeping only rows with a root id and a usable
   coordinate (soma position, falling back to FlyWire's own seed point for
   neurons with no in-volume soma).
2. Samples down to ~1200 neurons, capped per `super_class` so the result
   stays visually varied instead of whatever the source file's row order
   happens to cluster - deterministic (stride sampling by sorted id, not
   `Math.random()`), so re-running produces the same seed file.
3. Normalizes x/y/z coordinates independently to `[0, 1]` - the seed file
   stays slide-agnostic; the 2D bot projects x/y into whichever slide's real
   pixel dimensions it's pointed at, at run time (z is unused there but kept
   for the live 3D connectome view - see below).
4. Parses the (large, LZ4-compressed) connections file with `apache-arrow`
   - see `src/data/connections.ts` for why two decompressor packages
     (`lz4js`, `fzstd`) are registered rather than one: the exact codec a
     given `.feather` release used isn't declared anywhere outside the file
     itself, so both get registered and whichever the file actually needs
     just works.
5. Keeps only connections where **both** ends are in the sampled neuron
   set, aggregates synapse counts across neuropils for the same directed
   pair, and caps the result at 3000 (sorted by synapse count).
6. Writes `data/seed.json` (~500KB - small enough to commit directly, no
   Git LFS needed).

The raw downloads live in `data/raw/` (gitignored - see the root
`.gitignore`) and are never committed; only the small derived `seed.json`
is.

## How the bot behaves

Each tick (`src/runTick.ts`) cycles through three action kinds (`src/scheduler.ts`):

1. **annotation** - a point marker (GeoJSON `Point`) for the tick-indexed
   neuron (wrapping around the sampled list indefinitely).
2. **cellCount** - one counted dot for the same neuron.
3. **pathway** - the synaptic connection itself: a directed line (GeoJSON
   `LineString`, drawn as image-viewer's `arrow` shape so it renders with a
   head at the postsynaptic end) from one sampled neuron to another they
   actually connect to, cycling through the sampled connection list the
   same way. This is what actually shows the wiring, not just isolated
   cells - `1` and `2` on their own only ever look like scattered points.

Neuron-based annotations/counts:

- are labelled `FlyWire - <cell type>` so they're immediately
  distinguishable from anything drawn by hand in the same collection,
- are coloured by the neuron's FlyWire `super_class` (`src/annotationStore/payloads.ts`'s
  `SUPER_CLASS_PALETTE` - a different palette from image-viewer's own
  `PreDefinedColours`, on purpose),
- carry the neuron's root id, side, neurotransmitter, and (if any) how many
  of the sampled connections touch it, in `notes`.

Pathway lines:

- are labelled `FlyWire - <pre> → <post>`,
- are coloured by the connection's own neurotransmitter (`NEUROTRANSMITTER_PALETTE`
  - a connection can join two different `super_class`es, so it gets its own
  palette rather than either endpoint's),
- get thicker with more synapses between that pair (`lineThicknessForSynapses`,
  clamped 1-6) - a real, if rough, visual proxy for connection strength,
- are posted as an `Annotation` (`POST /annotations`, `shape: "arrow"`), not
  a cell count - a pathway isn't something you'd tally.

The bot is a plain client of `annotation-store`'s existing public REST
contract (`POST /annotations`, `POST /cellcounts`, `POST /collections/ensure`)
- exactly what `image-viewer` itself calls. No `annotation-store` schema or
API changes were needed.

Coordinates are projected to match `image-viewer`'s own map projection
exactly (`src/annotationStore/payloads.ts`'s `projectToMapCoordinates` -
see the comment there and `image-viewer/src/components/open-layers/OpenLayers.ts`'s
`getExtent` for why Y gets flipped): verified live in the browser, not just
by unit test - see "Verification" below.

## Live feed for the 3D connectome view

On startup the bot also runs a small HTTP+WebSocket server (`src/liveServer.ts`,
default port `5300`, separate from `annotation-store` entirely) so a live 3D
visualization of the network itself (a new panel in `image-viewer`, built
alongside this) doesn't have to wait on annotation-store's own polling
cadence:

- **`GET /seed`** (CORS enabled) - the full `seed.json`, including the real
  `z` coordinate the 2D slide overlay doesn't use.
- **`ws://` on the same port** - one JSON message per tick, the instant
  `runTick` finishes posting it to `annotation-store` (`src/runTick.ts`'s
  `onEvent` callback - same tick, same subject, so the live feed and the
  persisted annotation can never disagree about what happened):
  ```ts
  type BotEvent =
    | { type: 'annotation'; tick: number; neuronId: string; timestamp: string }
    | { type: 'cellCount';  tick: number; neuronId: string; timestamp: string }
    | { type: 'pathway';    tick: number; preId: string; postId: string; timestamp: string };
  ```

Verified directly (not just by unit test): started the bot, `curl`'d
`GET /seed` (200, correct CORS header, real neuron/connection counts and a
real `z` value), and connected a plain `ws` client that received live
`annotation`/`cellCount`/`pathway` events matching the bot's own console log
in real time.

## Remote control

The same server also exposes `GET`/`POST /control` (`src/control.ts`) so a
human watching `image-viewer` can steer what the bot is doing, live:

```ts
interface BotControlState {
  annotationsEnabled: boolean; // default true
  cellCountEnabled: boolean;   // default true
  region: { x: number; y: number; width: number; height: number } | null; // default null (full slide)
}
```

`POST /control` takes a **patch**, not a full replacement - send only the
field(s) you're changing (e.g. `{"annotationsEnabled": false}`), and get
back the full resulting state. `region` is normalized `[0,1]` in the same
image-space (top-left origin, y-down) `seed.json`'s own neuron `x`/`y`
already use - `payloads.ts`'s `projectToMapCoordinates` remaps every
neuron/connection placement into that sub-rectangle instead of the full
slide when one is set (`{"region": null}` clears it back to full-slide).
`annotationsEnabled`/`cellCountEnabled` gate exactly those two tick kinds
(`runTick.ts` skips the post entirely, logging `skipped (disabled)`) -
`pathway` ticks are never gated, since they're what drives the live 3D
view regardless of whether the 2D slide overlay is currently switched on.

Verified directly: `POST`ed `{"annotationsEnabled": false}`, watched the
bot's own log immediately start printing `[tick N] annotation - skipped
(disabled)` while cell-count and pathway ticks kept going; `POST`ed a
region and confirmed a subsequent `GET /control` reflected it; a
malformed patch (`{"annotationsEnabled": "nope"}`) correctly 400s and
leaves the real state untouched.

## Verification

Ran end to end against real local `tiler`/`annotation-store`/`image-viewer`
instances on slide `000`:

- Bot wrote 5 annotations + 5 cell counts; both showed up in the
  Annotations and Cell Count panels' Saved lists with the expected
  `FlyWire - <label>` names, at plausible scattered positions on the slide,
  each in its `super_class` colour.
- Ran the bot a second time with the browser tab already open and
  untouched: the new items appeared in the Saved lists without a page
  reload, confirming `image-viewer`'s new 5-second polling (a separate,
  parallel change to `AnnotationStoreContext`/`CellCountStoreContext`)
  actually picks up externally-written rows.

## Tests

```bash
npm test        # vitest - 126 tests across every pure function (sampling,
                 # 3-axis coordinate normalization, connection aggregation,
                 # the scheduler, the HTTP client, tick execution, the live
                 # server's HTTP+WebSocket+control behaviour, control-state
                 # patching/validation) plus a small arrow-table extraction
                 # test
npm run typecheck
npm run lint
```

Everything except the thin I/O boundaries (`scripts/prepare-seed-data.ts`'s
orchestration, `src/bot.ts`'s wiring) is a pure, unit-tested function -
`runTick` itself is tested with the real `postAnnotation`/`postCellCount`
mocked out, so the tick-selection and payload-building logic is verified
without a live server.

## Upgrading to real CAVE-authenticated data

This uses only FlyWire's public, no-login release files. If real-time
proofreading data (live edits other researchers are making right now, not
just this fixed v783 snapshot) is ever wanted instead:

1. Sign up for FlyWire access at [flywire.ai](https://flywire.ai) and get it
   approved (community agreement).
2. Generate a CAVE API token at
   `https://global.daf-apis.com/auth/api/v1/user/token`.
3. Swap `scripts/prepare-seed-data.ts`'s file-based reads for `caveclient`
   (Python) or direct CAVE REST calls, authenticated with that token.

Nothing else in this service (the bot, the payload builders, the
projection math, the tests) would need to change - only where
`SeedFile`'s `neurons`/`connections` arrays come from.
