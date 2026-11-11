# Evaluation

Measurements of the version control and collaboration work, for the write-up. Every
table here comes from the result files in [evaluation-data](evaluation-data), and how to
run them again is at the end.

Measured on 5 November 2026 on a Lenovo laptop (Intel Core Ultra 7 155H, 31GB, Intel
integrated graphics) with everything local: annotation-store and realtime-hub as Release
builds in Production mode, Postgres 17 in Docker, and a database made for this and
nothing else. Sign-in was real Keycloak. **There's no real network in any of this**, so
times are what the software adds, and a real connection adds to them.

## What it shows

1. **Last change wins silently loses a lot once people overlap.** Up to 73% of saves
   replaced someone else's change with nobody told. First change wins lost none across
   3,117 saves, at the cost of stopping people to choose, up to about 10 times per person
   per minute under this load. Neither is simply better - it's a trade between losing
   work and interrupting people, which is the case for picking per session.
2. **How fast people see changes matters as much as who's in the room.** Going from 0.5
   to 5 seconds' notice more than doubled collisions at 6 and 12 people, and more than
   that at 2. So keeping live updates quick reduces conflicts under either policy.
3. **Merging is what makes text safe.** With Yjs every letter survived and over 99.5% of
   words stayed in one piece, against 8-56% of words kept if each save replaced the box.
4. **Live updates are far quicker than people notice.** A median of 1-3ms to reach
   everyone, up to 50 people, with no ops lost. The hub isn't what limits collaboration
   at this size.
5. **Keeping the history is cheap, except for deletes.** An edit costs about 150 bytes,
   against 1,325 for the row, so edits can be kept for good. A delete keeps the whole row.
6. **Snapshots help modestly on time and a lot on size.** About three times quicker to
   work out a rollback at this size, at 820KB against 25MB for whole rows.
7. **WebGL is what makes the map usable at this load.** About 15 times quicker than canvas
   while moving at 25,000 annotations, though neither is smooth on integrated graphics.

## Two people changing the same thing

Simulated people recolour the same 3 annotations, each about every 4 seconds, for 60 seconds,
from a copy of its colour that only catches up with other people's changes after the notice
delay. Each combination ran 3 times with different seeds, 54 runs in all. Turned down under
first change wins, they put theirs over it half the time. From
[eval_conflicts.py](../scripts/eval_conflicts.py) and
[simulate_conflicts.py](../scripts/simulate_conflicts.py).

| Policy            | People | Notice | Saves | Collided          | Silently lost | Turned down | Asked per person per minute | Median save |
| ----------------- | ------ | ------ | ----- | ----------------- | ------------- | ----------- | --------------------------- | ----------- |
| First change wins | 2      | 0.5s   | 81    | 2 (2.4% ± 2.1)    | 0             | 2           | 0.33                        | 72ms        |
| First change wins | 2      | 2s     | 85    | 12 (14.1% ± 3.3)  | 0             | 12          | 2.00                        | 71ms        |
| First change wins | 2      | 5s     | 97    | 23 (23.7% ± 1.0)  | 0             | 23          | 3.83                        | 69ms        |
| First change wins | 6      | 0.5s   | 280   | 50 (17.9% ± 1.0)  | 0             | 50          | 2.78                        | 74ms        |
| First change wins | 6      | 2s     | 314   | 112 (35.7% ± 1.4) | 0             | 112         | 6.22                        | 64ms        |
| First change wins | 6      | 5s     | 338   | 159 (47.0% ± 0.2) | 0             | 159         | 8.83                        | 28ms        |
| First change wins | 12     | 0.5s   | 580   | 154 (26.5% ± 1.2) | 0             | 154         | 4.28                        | 68ms        |
| First change wins | 12     | 2s     | 651   | 308 (47.3% ± 2.4) | 0             | 308         | 8.56                        | 45ms        |
| First change wins | 12     | 5s     | 691   | 370 (53.5% ± 0.2) | 0             | 370         | 10.28                       | 32ms        |
| Last change wins  | 2      | 0.5s   | 81    | 4 (5.2% ± 6.1)    | 4             | 0           | 0.00                        | 74ms        |
| Last change wins  | 2      | 2s     | 81    | 11 (13.4% ± 7.2)  | 11            | 0           | 0.00                        | 72ms        |
| Last change wins  | 2      | 5s     | 83    | 23 (27.8% ± 8.0)  | 23            | 0           | 0.00                        | 73ms        |
| Last change wins  | 6      | 0.5s   | 252   | 44 (17.4% ± 3.4)  | 44            | 0           | 0.00                        | 70ms        |
| Last change wins  | 6      | 2s     | 251   | 128 (51.0% ± 0.4) | 128           | 0           | 0.00                        | 70ms        |
| Last change wins  | 6      | 5s     | 251   | 166 (66.1% ± 0.8) | 166           | 0           | 0.00                        | 70ms        |
| Last change wins  | 12     | 0.5s   | 503   | 167 (33.2% ± 2.0) | 167           | 0           | 0.00                        | 79ms        |
| Last change wins  | 12     | 2s     | 500   | 337 (67.4% ± 4.3) | 337           | 0           | 0.00                        | 78ms        |
| Last change wins  | 12     | 5s     | 503   | 367 (73.0% ± 4.9) | 367           | 0           | 0.00                        | 72ms        |

The ± is the standard deviation between the 3 runs.

- **Collided** means a save would have replaced a change the person hadn't seen. Under last
  change wins, every one of those is a silent loss, so those two columns match.
- **Nothing was lost silently under first change wins.** Of 1,190 turned down, 595 kept the
  other person's and 589 put theirs over it, knowing it was there. The other 6 were turned
  down again on the way, by someone getting in first.
- **The store's history agrees.** In all 54 runs the number of changes in the history is
  exactly what the script counted: every save and the 3 annotations added, less anything
  turned down. So these counts aren't only the script's own view.
- **First change wins' save times aren't comparable.** A refused save returns quickly and
  they're counted in the median, which is why it drops as low as 28ms where most are refused.
  Accepted saves took about 70ms either way, which is the most it delays other people seeing
  a change, since first change wins sends it once it's saved.

**How far to trust this:** it's a stress test. Nobody recolours the same 3 things every 4 seconds
for a minute, so real sessions will collide far less. The notice delay is a stand-in for
attention, and a person turned down doesn't choose at random. The pattern is the finding - how
loss grows with overlap, and what each policy does about it - not the exact percentages.

## Text: Yjs against last save wins

The same simulated typing goes through two things: the real Yjs library as the viewer uses it,
moving the caret with a copy of the viewer's `transformIndex`, and a plain box where each save
replaces the last. 120 seconds of typing, 5 seeds each. From
[eval_text_merge.mjs](../scripts/eval_text_merge.mjs).

| People | Notice | Words typed | Yjs: letters kept | Yjs: words intact | Last save: letters kept | Last save: words intact |
| ------ | ------ | ----------- | ----------------- | ----------------- | ----------------------- | ----------------------- |
| 2      | 0.5s   | 47          | 100.0%            | 100.0%            | 55.8%                   | 55.9%                   |
| 2      | 2s     | 47          | 100.0%            | 99.6%             | 52.0%                   | 51.9%                   |
| 2      | 5s     | 47          | 100.0%            | 100.0%            | 51.6%                   | 51.5%                   |
| 6      | 0.5s   | 140         | 100.0%            | 99.9%             | 26.8%                   | 26.8%                   |
| 6      | 2s     | 140         | 100.0%            | 99.7%             | 19.2%                   | 19.2%                   |
| 6      | 5s     | 140         | 100.0%            | 100.0%            | 16.6%                   | 16.6%                   |
| 12     | 0.5s   | 278         | 100.0%            | 99.9%             | 15.2%                   | 15.2%                   |
| 12     | 2s     | 278         | 100.0%            | 99.9%             | 10.5%                   | 10.5%                   |
| 12     | 5s     | 278         | 100.0%            | 100.0%            | 8.5%                    | 8.4%                    |

- **Yjs never lost a letter, and everyone ended with the same text**, in every run.
- **A plain box loses most of it** past two people, since someone with unsaved typing saves over
  whatever's happened since. It's nearly half even with two.
- **Relayed text costs about 12 bytes a letter**, which is what the hub holds per letter while a
  box is open. Saved in Yjs' own form it's about 1.4 bytes.

**How far to trust this:** typing is simulated and constant, so everyone typing in one box for
two minutes is far heavier than real use. This doesn't go through the viewer or the hub, and
last save wins here is a model, since the app has always merged these fields. It says what the
merge is worth, not how often people do this.

## How long a change takes to reach everyone

One person sends an annotation op 5 times a second, 300 in all, through the real hub over WebSockets,
and everyone else in the room times it arriving. From
[eval_latency.py](../scripts/eval_latency.py) and [eval_latency.mjs](../scripts/eval_latency.mjs).

| People | Viewports moving | Median to each person | 95%   | 99%   | Median to whole room | 95% whole room | Ops missing |
| ------ | ---------------- | --------------------- | ----- | ----- | -------------------- | -------------- | ----------- |
| 2      | None             | 1.3ms                 | 2.8ms | 4.6ms | 1.3ms                | 2.8ms          | 0           |
| 6      | None             | 1.4ms                 | 2.9ms | 5.7ms | 1.5ms                | 3.3ms          | 0           |
| 12     | None             | 1.5ms                 | 3.1ms | 7.8ms | 1.8ms                | 3.5ms          | 0           |
| 25     | None             | 1.8ms                 | 3.7ms | 7.9ms | 2.4ms                | 4.4ms          | 0           |
| 50     | None             | 2.5ms                 | 6.7ms | 9.4ms | 3.5ms                | 9.0ms          | 0           |
| 2      | 2/s each         | 1.2ms                 | 2.8ms | 4.7ms | 1.2ms                | 2.8ms          | 0           |
| 6      | 2/s each         | 1.3ms                 | 2.8ms | 5.4ms | 1.4ms                | 3.3ms          | 0           |
| 12     | 2/s each         | 1.3ms                 | 3.0ms | 9.5ms | 1.6ms                | 3.6ms          | 0           |
| 25     | 2/s each         | 1.8ms                 | 5.7ms | 9.5ms | 2.3ms                | 7.4ms          | 0           |
| 50     | 2/s each         | 2.0ms                 | 5.7ms | 8.8ms | 2.7ms                | 8.6ms          | 0           |

- **It barely grows with the room.** Going from 2 to 50 people adds about a millisecond to the median.
- **No op was lost** in any run: all 54,000 deliveries expected arrived.
- **Viewports moving made no real difference.** That looked wrong at first, so it was checked by counting:
  at 50 people, 4,450 viewport updates went in and
  218,050 came out, exactly 49 each, with no errors, and the median was
  still 1.9ms.
- **Live updates and saves are different speeds.** About 2ms to relay against about 70ms to save, so the
  order the viewer does things in hardly shows.

**How far to trust this:** one machine, so a shared clock but no network, and a real connection adds its own
delay. Everyone's in one Node process, so at 50 people some of the time is that process keeping up, which
makes these worse rather than better than the hub alone.

## What keeping the history costs

Average sizes from Postgres, across about 600,000 entries:

| Thing                            | Size                        |                                              |
| -------------------------------- | --------------------------- | -------------------------------------------- |
| An annotation, live              | 1,325 bytes                 | A 120-point freehand line                    |
| An entry for an edit             | 150 bytes                   | Only the columns that changed                |
| An entry for a create            | 98 bytes                    | Nothing but which row                        |
| An entry for a delete            | 1,630 bytes                 | The whole row, so it can come back           |
| A snapshot of 20,000 annotations | 820KB stored, 2.2MB of JSON | What can change, against 25MB for whole rows |

So a thousand edits cost about 150KB, and a thousand deletes about the same as the rows did. Nothing's purged
yet, so it only grows, and indexes add about 10% on top.

### Rolling back

A collection of 20,000 annotations, working out a rollback to a point 140,000 entries ago, with a snapshot 20,000 entries after that point. Median of 5:

| Worked out from  | Entries undone | Median |
| ---------------- | -------------- | ------ |
| What's there now | 140,000        | 953ms  |
| A snapshot       | 20,000         | 331ms  |

Actually doing one, 5 runs of each, from [time_rollback.py](../scripts/time_rollback.py):

| Rows changed | Change undone   | Median  | Fastest | Slowest |
| ------------ | --------------- | ------- | ------- | ------- |
| 1            | Recolour undone | 301ms   | 275ms   | 486ms   |
| 1            | Delete undone   | 329ms   | 241ms   | 453ms   |
| 1,000        | Recolour undone | 575ms   | 436ms   | 772ms   |
| 1,000        | Delete undone   | 564ms   | 528ms   | 820ms   |
| 20,000       | Recolour undone | 1,591ms | 1,460ms | 3,032ms |
| 20,000       | Delete undone   | 7,215ms | 6,788ms | 7,865ms |

- **Most of a small rollback is working it out**, which reads the whole collection however little changed. It's
  about 300ms for one row in 20,000.
- **Bringing back 20,000 deleted rows is the slow one**, about 7 seconds, since the whole rows go back in.
- **An earlier result was noise.** A single run had undoing 1,000 recolours slower than 20,000. Over 5 runs it's
  575ms, as expected. It's why these are repeated.

**How far to trust this:** one collection, and Postgres wasn't tuned or vacuumed between runs. The rollbacks leave
dead rows behind, so times could drift over a much longer run.

## Canvas against WebGL

Saved annotations drawn by OpenLayers' WebGL layer against its canvas layer, with `?renderer=canvas` and
[map_bench.js](../scripts/map_bench.js), which drives pans and zooms and times every frame. 25,000 annotations, on this
laptop's integrated graphics, in a 762x726 window. Each ran 3 times, the first as a warm-up,
so each cell is the 2 runs after that (fps) or their mean (frame times).

| Step                   | WebGL fps     | Canvas fps  | WebGL median frame | Canvas median frame |
| ---------------------- | ------------- | ----------- | ------------------ | ------------------- |
| Idle                   | 60 and 60     | 0.8 and 0.6 | 17ms               | 2,983ms             |
| Pan                    | 6.8 and 10    | 0.7 and 0.5 | 83ms               | 1,975ms             |
| Zoom in                | 12.9 and 7.1  | 0.3 and 0.9 | 50ms               | 2,183ms             |
| Pan zoomed in          | 15.1 and 15.1 | 0.7 and 0.9 | 58ms               | 1,833ms             |
| Zoom out               | 6.7 and 10.9  | 0.7 and 0.8 | 108ms              | 1,991ms             |
| Pan back out           | 14.3 and 0.7  | 0.5 and 0.6 | 1,016ms            | 2,474ms             |
| A redraw once it stops | -             | -           | 529ms              | 874ms               |

- **WebGL is about 15 times quicker while moving**, averaging 10fps to canvas's 0.7fps. Neither is smooth here, but WebGL
  can be used and canvas can't.
- **Sitting still is the clearest difference.** WebGL holds 60fps doing nothing, and canvas stays around 1fps.
- **The redraw once the view stops is much closer**, since WebGL rebuilds its buffers then. That's the hitch at the end of every gesture.

**How far to trust this:** one size, 2 counted runs each, and they vary a lot, with single WebGL runs anywhere from 1 to 15fps on the same
step, so the gap is the finding rather than the exact numbers. The canvas layer redraws while moving so it does the same work as WebGL.
By default it waits until the view stops, which would look far quicker without drawing anything new. Arrowheads are on canvas both ways.
This is a laptop's integrated graphics, and [rendering.md](rendering.md)'s numbers are from a desktop graphics card, so don't compare the two.

**A mistake worth keeping.** The first runs came back identical at 60fps, because the annotation layer is off unless the Annotations tool
is open, so they only timed the slide. A redraw of 0.4ms against an earlier 64ms gave it away, and those runs were thrown out. `map_bench.js`
now says which layers are drawing, and warns if the annotations aren't.

## Running these again

Point them at a throwaway database, since they leave sessions and collections behind. They need Keycloak, the tiler,
annotation-store and realtime-hub running.

```bash
python scripts/eval_conflicts.py --store http://localhost:5253 --hub http://localhost:5181/hubs/slides --out conflicts.json
```

```bash
node scripts/eval_text_merge.mjs --json text.json
```

```bash
python scripts/eval_latency.py --store http://localhost:5253 --hub http://localhost:5181/hubs/slides --out latency.json
```

```bash
python scripts/time_rollback.py --store http://localhost:5253 --rows 20000 --sizes 1 1000 20000 --repeats 5 --json rollback.json
```

The conflict grid takes over an hour, and the rest a few minutes each. The simulated people are the Keycloak test users
`sim1` and up, made the first time they're needed, and `scripts/teardown_users.py` removes them.

Still not measured: real people. Everything here is simulated, so a session with real users, if [ethics](ethics.md) allow it, is what
would say how often this happens in practice.
