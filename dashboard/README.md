# dashboard

Grafana, run in Docker, showing statistics for `tiler` and
`annotation-store`: load, request timing, errors, busiest endpoints and
machine usage. Uses the all-in-one
[`grafana/otel-lgtm`](https://github.com/grafana/docker-otel-lgtm) image,
which has Prometheus (metrics), Tempo (traces) and Loki (logs) built in.

## Running

Needs Docker Desktop running.

```bash
cd dashboard/
docker compose up -d     # http://localhost:3000
docker compose down      # stop it
```

No login - it opens straight onto the **Services** dashboard.

Start it before or after the services, either works. They send to
`localhost:4317` in the background, and just drop the data if nothing is
listening, so the services run the same with or without it.

## The Services dashboard

Pick one or both services at the top. Refreshes every 5 seconds.

| Row       | Shows                                                                 |
|-----------|-----------------------------------------------------------------------|
| Load      | requests / sec, requests in flight, slowest-5% time, server error %   |
| Timing    | request time - median, slowest 5% (p95), slowest 1% (p99)             |
| Endpoints | table of every route - request count, rate, median and p95 time       |
| Errors    | 4xx and 5xx per minute, by status code                                |
| Machine   | CPU (% of all cores), memory, thread pool threads, GC pause time      |

Hover the (i) next to a panel's title for what it means.

Some tiler 404s are normal - tiles past the slide's edge.

"In flight" is sampled every 5 seconds, so short bursts (like a single pan)
can fall between samples - the requests / sec chart is the better load
signal.

## Editing the dashboard

The dashboard is `grafana/dashboards/services.json`, loaded on startup.
Edits made in the Grafana UI are lost when the container is recreated -
to keep a change, use the dashboard's **Export > Export as JSON**, save
over `services.json`, then `docker compose restart`.

## What the services send

| Service            | Metrics                                         | Traces                 | Logs |
|--------------------|-------------------------------------------------|------------------------|------|
| `tiler`            | ASP.NET requests, Kestrel, .NET runtime (CPU, memory, GC, threads) | every incoming request | yes  |
| `annotation-store` | same                                            | every incoming request | yes  |

Metrics are sent every 5 seconds. Traces and logs are in Grafana's
**Explore** page (Tempo and Loki). Database queries aren't traced yet.

## Printing to the terminal as well

Set `Telemetry__Console=true` when starting a service to also print
everything to its terminal. It's off by default because a terminal drawing
~40 lines per tile request slows the tiler by 30-60 ms per pan.

```bash
Telemetry__Console=true dotnet run --urls http://0.0.0.0:5095
```

## Ports

| Port | What                                        |
|------|---------------------------------------------|
| 3000 | Grafana                                     |
| 4317 | OTLP over gRPC - what the services send to  |
| 4318 | OTLP over HTTP - for browser tracing later  |

Data lives inside the container. `docker compose down` then `up` starts
it empty.
