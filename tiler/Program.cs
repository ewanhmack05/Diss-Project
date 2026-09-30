using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Scalar.AspNetCore;
using SkiaSharp;
using Tiler.Slides;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<SlideCatalog>();
// Any origin, so the viewer works from other devices on the network too.
// Needs a real origin list once deployed.
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
});

builder.Services.AddOpenApi();

// Traces, metrics and logs go to Grafana (see dashboard/README.md) over
// OTLP on localhost:4317 - sent in the background in batches, so it
// adds nothing to a request, and nothing breaks if the dashboard isn't
// running. Telemetry__Console=true prints them to the terminal as well - off by
// default, since ~40 lines per tile request slows each pan by 30-60 ms.
var consoleTelemetry = builder.Configuration.GetValue<bool>("Telemetry:Console");
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource.AddService("tiler"))
    .WithTracing(tracing =>
    {
        tracing.AddAspNetCoreInstrumentation().AddOtlpExporter();
        if (consoleTelemetry) tracing.AddConsoleExporter();
    })
    .WithMetrics(metrics =>
    {
        // Every 5s rather than the default 60s, so the dashboard's charts
        // keep up while you're watching them.
        // System.Runtime is .NET's built-in meter - CPU, memory, GC and
        // thread pool, for the dashboard's machine row.
        metrics.AddAspNetCoreInstrumentation().AddMeter("System.Runtime").AddOtlpExporter((_, reader) =>
            reader.PeriodicExportingMetricReaderOptions.ExportIntervalMilliseconds = 5000);
        if (consoleTelemetry) metrics.AddConsoleExporter();
    })
    .WithLogging(logging => logging.AddOtlpExporter());

var app = builder.Build();
app.UseCors();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.MapGet("/slides", (SlideCatalog catalog) =>
{
    var slides = catalog.SlideIds
        .Select(catalog.GetInfo)
        .Where(info => info is not null);
    return Results.Ok(slides);
});

app.MapGet("/slides/{id}", (string id, SlideCatalog catalog) =>
{
    var info = catalog.GetInfo(id);
    return info is null ? Results.NotFound() : Results.Ok(info);
});

app.MapGet("/slides/{id}/TileGroup{group:int}/{z:int}-{x:int}-{y:int}.jpg", (string id, int z, int x, int y, SlideCatalog catalog) =>
{
    var pool = catalog.GetPool(id);
    var info = catalog.GetInfo(id);
    if (pool is null || info is null) return Results.NotFound();

    // Borrows one of the slide's handles for just the native calls, so a pan's
    // burst of requests reads in parallel on separate handles.
    var read = pool.Use(slide =>
    {
        var resolved = ZoomifyTiling.Resolve(slide, info.Width, info.Height, z, x, y);
        if (resolved is null) return null;

        // OpenSlide returns pre-multiplied BGRA; Skia's Bgra8888/Premul matches that layout exactly.
        var region = slide.ReadRegion(resolved.SlideLevel, resolved.X0, resolved.Y0, resolved.ReadWidth, resolved.ReadHeight);
        return new { Request = resolved, Raw = region };
    });
    if (read is null) return Results.NotFound();
    var (request, raw) = (read.Request, read.Raw);

    var sourceInfo = new SKImageInfo((int)request.ReadWidth, (int)request.ReadHeight, SKColorType.Bgra8888, SKAlphaType.Premul);
    using var sourceBitmap = new SKBitmap(sourceInfo);
    System.Runtime.InteropServices.Marshal.Copy(raw, 0, sourceBitmap.GetPixels(), raw.Length);

    var needsResize = sourceBitmap.Width != request.TargetWidth || sourceBitmap.Height != request.TargetHeight;
    using var resizedBitmap = needsResize
        ? sourceBitmap.Resize(
            new SKImageInfo(request.TargetWidth, request.TargetHeight, SKColorType.Bgra8888, SKAlphaType.Premul),
            new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.None))
        : null;
    var tileBitmap = resizedBitmap ?? sourceBitmap;

    using var image = SKImage.FromBitmap(tileBitmap);
    using var data = image.Encode(SKEncodedImageFormat.Jpeg, 85);
    return Results.Bytes(data.ToArray(), "image/jpeg");
});

app.Run();
