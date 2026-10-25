# API timings

What annotation-store's reads take, where the time goes, and what would
make the slow ones faster. Measured on 21 Oct 2026 on the dev laptop, with
the stack running locally: annotation-store on 5252 against Postgres 18,
the viewer's Vite dev server on 5173 (HTTPS). Signed in as alice, whose
collection on slide 003 has 5,000 stress-test annotations and a 50,000-dot
cell count; the session timed is "History test" from `seed_history.py`.

Measured with [scripts/time_api.py](../scripts/time_api.py) - 2 warm-up
calls, then 10 timed, over one kept-alive connection. Run it again to
compare after a change:

```bash
python scripts/time_api.py --json before.json
python scripts/time_api.py --via https://localhost:5173/store
```

## The store itself is quick, apart from big answers

Straight to the store (`time_api.py`, no `--via`). Everything not listed was
under 10ms.

| Endpoint | Median | p95 | Answer |
|----------|--------|-----|--------|
| Export, own collection | 232ms | 327ms | 13.3 MB |
| All annotations - the map's load | 220ms | 333ms | 9.8 MB |
| Biggest cell count, with its dots | 49ms | 70ms | 2.9 MB |
| Collections list | 18ms | 21ms | 2.6 KB |
| Annotations facets, own | 18ms | 22ms | 369 B |
| History - what a change did | 10-16ms | 13-29ms | under 1 KB |
| Saved annotations, one page of 50 | 15ms | 16ms | 91 KB |
| History page of 50 | 7ms | 9ms | 5.2 KB |

So the store's time follows how much it sends. The three slow ones are
megabytes each; everything else is a few milliseconds.

## Through the viewer, every call costs about 40ms more

The viewer doesn't call the store directly - it goes through the Vite dev
server's `/store` proxy on 5173, so other machines on the VPN only need that
one port. The same calls through it (`--via https://localhost:5173/store`):

| Endpoint | Direct | Through 5173 |
|----------|--------|--------------|
| Export | 232ms | 393ms |
| All annotations - the map | 220ms | 350ms |
| Biggest cell count | 49ms | 103ms |
| Collections list | 18ms | 45ms |
| History page | 7ms | 47ms |
| Cell counts newest | 6ms | 45ms |
| Anything that was 4-7ms | 4-7ms | about 45ms |

A flat 40ms on every small call is what makes the many small reads - the
History tab, the Saved lists, opening a change - feel slower than they are.

Where it goes, one thing changed at a time on a throwaway server (5176),
never the real one:

| Tried | Proxy adds |
|-------|-----------|
| Vite's proxy over HTTPS, as 5173 is | about 40ms |
| Vite's proxy over plain HTTP | about 15ms |
| ...pointed at `127.0.0.1` rather than `localhost` | no better |
| ...with a keep-alive agent to the store | no better |
| A bare Node proxy, nothing else in it | about 4ms |

So it isn't the hop to the store, name lookup or connections - it's Vite's
own request handling, and HTTPS on top. That's the dev server only: a built
viewer wouldn't go through Vite.

## What would help, most first

1. **In development, the proxy.** `npm run dev:http` (5174) takes the HTTPS
   part off - roughly halving the overhead - but only works on localhost,
   since sign-in needs HTTPS or localhost. Going straight to the store from
   the viewer when it's on localhost would take all of it off; CORS already
   allows it. Neither changes a deployed build, which won't have Vite.
2. **Send less GeoJSON - done 25 Oct.** It was 80% of the map's load (8.2
   of 10.2 MB), with full-double coordinates - `88734.88763302466`. Rounded
   to a tenth of a slide pixel, alice's 5,000 go from 8.21 to 3.98 MB of
   GeoJSON, and the whole answer from 10.24 to 6.01 MB (59%) - re-measured
   25 Oct - with no CPU cost and no visible difference. The viewer's `featureToGeoJson` now saves to a tenth,
   the store rounds anything else on save (an import, a script), and
   `dotnet run --project annotation-store -- round-geojson` rounds what was
   saved before. Re-run `time_api.py` after that to get the new sizes.
3. **Compression, for the VPN.** gzip takes the three big answers to about a
   third (map 10.2 -> 3.75 MB, export 14.0 -> 4.5 MB, a count's dots
   3.1 -> 0.6 MB) but costs about 230ms of CPU on the map at the fastest
   level - slower than not compressing on localhost, much faster over a
   slow link. Worth it once anyone uses it remotely, at the fastest level,
   and only above a size.
4. **Load the map by what's in view** - the zoomed-out half is done (see
   [rendering.md](rendering.md#less-detail-zoomed-out---2026-10-25)); loading
   by extent is still open, and in
   [image-viewer.md's known gaps](breakdown/image-viewer.md#16-known-gaps)
   and [rendering.md](rendering.md#what-would-move-the-limits). The biggest
   change of all at 25k+ annotations, and the most work.

## What this didn't measure

- **The viewer's own time** - parsing 10 MB of JSON and turning 5,000
  annotations into map features happens after the answer arrives, and can
  be more than the request. The browser's Performance panel, or timing
  around `response.json()` and the feature build in `AnnotationStoreContext`
  and `MapNode`, would show it.
- **Writes** - saves, bulk changes and restore. The 20,000-row bulk timings
  are in [annotation-store.md section 11](breakdown/annotation-store.md#11-history-and-change-sets).
- **Over the VPN** - everything here was localhost.
