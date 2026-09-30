using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using AnnotationStore.ImageAdjustments;
using DotNetEnv;
using Microsoft.EntityFrameworkCore;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Scalar.AspNetCore;

// Loads .env (if present - it's gitignored, so it won't exist on a fresh
// clone or in a hosted environment) into process environment variables,
// before CreateBuilder's own environment-variables config source reads
// them. Same ConnectionStrings__AnnotationStore key either way - locally
// it comes from .env, in a real hosting environment it'd be a real env var
// set by whatever's hosting this, no code change needed.
Env.Load();

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AnnotationDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("AnnotationStore")));

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
// running. Telemetry__Console=true prints them to the terminal as well (off by
// default, same as the tiler).
var consoleTelemetry = builder.Configuration.GetValue<bool>("Telemetry:Console");
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource.AddService("annotation-store"))
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

// Dev convenience so a fresh checkout (or a pulled schema change) doesn't
// need a manual `dotnet ef database update` first - creates the database
// and applies any pending migrations on startup.
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<AnnotationDbContext>().Database.Migrate();
}

// Collection endpoints - every Annotation/CellCount/ImageAdjustments row
// belongs to exactly one of these (see AnnotationStore.Collections.Collections).

// Eager-loads its Annotations/CellCounts/ImageAdjustments - a read
// convenience for seeing everything in a collection in one call (Scalar,
// curl, a future export). The three flat endpoints below are still what the
// frontend actually reads/writes through day to day - this doesn't replace
// them, and writes always go through those, never through this shape.
app.MapGet("/collections", async (string slideId, string userId, AnnotationDbContext db) =>
    Results.Ok(await db.Collections
        .Where(c => c.SlideId == slideId && c.UserId == userId)
        .Include(c => c.Annotations)
        .Include(c => c.CellCounts).ThenInclude(cc => cc.RegionOfInterest)
        .Include(c => c.ImageAdjustments)
        .ToListAsync()));

// Get-or-create: the flow the frontend actually calls on load. Plain POST
// below exists for completeness/manual use, but a user opening a slide
// should never fail just because their collection already exists from a
// previous visit.
app.MapPost("/collections/ensure", async (AnnotationStore.Collections.Collections request, AnnotationDbContext db) =>
{
    var existing = await db.Collections.FirstOrDefaultAsync(
        c => c.SlideId == request.SlideId && c.UserId == request.UserId);
    if (existing is not null) return Results.Ok(existing);

    var collection = new AnnotationStore.Collections.Collections
    {
        CollectionId = Guid.NewGuid(),
        SlideId = request.SlideId,
        UserId = request.UserId,
        CollectionName = string.IsNullOrWhiteSpace(request.CollectionName)
            ? $"Collection for {request.SlideId}"
            : request.CollectionName,
        Created = DateTimeOffset.UtcNow,
    };
    db.Collections.Add(collection);
    await db.SaveChangesAsync();
    return Results.Created($"/collections/{collection.CollectionId}", collection);
});

app.MapPost("/collections", async (AnnotationStore.Collections.Collections collection, AnnotationDbContext db) =>
{
    // Checked up front rather than caught off the unique index - avoids
    // coupling this handler to a specific provider's constraint-violation
    // exception shape (Postgres at runtime, Sqlite in tests). Racy in
    // theory (two near-simultaneous POSTs for the same slide+user), but
    // this is a single-instance dev service, not something worth a
    // retry-on-conflict dance for - /collections/ensure is the real
    // get-or-create path anyway.
    var exists = await db.Collections.AnyAsync(c => c.SlideId == collection.SlideId && c.UserId == collection.UserId);
    if (exists) return Results.Conflict("A collection already exists for this slide and user - use POST /collections/ensure instead.");

    if (collection.CollectionId == Guid.Empty) collection.CollectionId = Guid.NewGuid();
    collection.Created = DateTimeOffset.UtcNow;
    db.Collections.Add(collection);
    await db.SaveChangesAsync();
    return Results.Created($"/collections/{collection.CollectionId}", collection);
});

app.MapPut("/collections/{id:guid}", async (Guid id, AnnotationStore.Collections.Collections update, AnnotationDbContext db) =>
{
    var existing = await db.Collections.FindAsync(id);
    if (existing is null) return Results.NotFound();
    existing.CollectionName = update.CollectionName;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

app.MapDelete("/collections/{id:guid}", async (Guid id, AnnotationDbContext db) =>
{
    var existing = await db.Collections.FindAsync(id);
    if (existing is null) return Results.NotFound();
    db.Collections.Remove(existing);
    await db.SaveChangesAsync();
    return Results.NoContent();
});

// Annotation endpoints

// Newest first. Sorted after loading rather than in SQL - the tests run on
// SQLite, which can't order by DateTimeOffset, and one collection's list is small.
app.MapGet("/annotations", async (Guid collectionId, AnnotationDbContext db) =>
    Results.Ok((await db.Annotations.Where(a => a.CollectionId == collectionId).ToListAsync())
        .OrderByDescending(a => a.Created)));

app.MapPost("/annotations", async (Annotation annotation, AnnotationDbContext db) =>
{
    var collection = await db.Collections.FindAsync(annotation.CollectionId);
    if (collection is null) return Results.NotFound($"No collection {annotation.CollectionId}");

    if (annotation.Id == Guid.Empty) annotation.Id = Guid.NewGuid();
    // Derived from the collection, not trusted from the client - keeps this
    // denormalized copy from ever drifting away from the real relationship.
    annotation.SlideId = collection.SlideId;
    annotation.Created = DateTimeOffset.UtcNow;
    db.Annotations.Add(annotation);
    await db.SaveChangesAsync();
    return Results.Created($"/annotations/{annotation.Id}", annotation);
});

app.MapPut("/annotations/{id:guid}", async (Guid id, Annotation update, AnnotationDbContext db) =>
{
    var existing = await db.Annotations.FindAsync(id);
    if (existing is null) return Results.NotFound();
    existing.Label = update.Label;
    existing.Notes = update.Notes;
    existing.Colour = update.Colour;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

app.MapDelete("/annotations/{id:guid}", async (Guid id, AnnotationDbContext db) =>
{
    var existing = await db.Annotations.FindAsync(id);
    if (existing is null) return Results.NotFound();
    db.Annotations.Remove(existing);
    await db.SaveChangesAsync();
    return Results.NoContent();
});

// Cell count endpoints

// Newest first, same as annotations.
app.MapGet("/cellcounts", async (Guid collectionId, AnnotationDbContext db) =>
    Results.Ok((await db.CellCounts
        .Where(c => c.CollectionId == collectionId)
        .Include(c => c.RegionOfInterest)
        .ToListAsync())
        .OrderByDescending(c => c.Created)));

app.MapPost("/cellcounts", async (CellCount cellCount, AnnotationDbContext db) =>
{
    var collection = await db.Collections.FindAsync(cellCount.CollectionId);
    if (collection is null) return Results.NotFound($"No collection {cellCount.CollectionId}");

    if (cellCount.Id == Guid.Empty) cellCount.Id = Guid.NewGuid();
    cellCount.SlideId = collection.SlideId;
    cellCount.Created = DateTimeOffset.UtcNow;
    if (cellCount.RegionOfInterest is not null)
    {
        if (cellCount.RegionOfInterest.Id == Guid.Empty) cellCount.RegionOfInterest.Id = Guid.NewGuid();
        cellCount.RegionOfInterest.CellCountId = cellCount.Id;
        cellCount.RegionOfInterest.Created = cellCount.Created;
    }
    db.CellCounts.Add(cellCount);
    await db.SaveChangesAsync();
    return Results.Created($"/cellcounts/{cellCount.Id}", cellCount);
});

app.MapPut("/cellcounts/{id:guid}", async (Guid id, CellCount update, AnnotationDbContext db) =>
{
    var existing = await db.CellCounts.FindAsync(id);
    if (existing is null) return Results.NotFound();
    existing.Label = update.Label;
    existing.Notes = update.Notes;
    existing.WithAnnotation = update.WithAnnotation;
    existing.WithRoi = update.WithRoi;
    existing.Count = update.Count;
    existing.DotSize = update.DotSize;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

app.MapDelete("/cellcounts/{id:guid}", async (Guid id, AnnotationDbContext db) =>
{
    var existing = await db.CellCounts.FindAsync(id);
    if (existing is null) return Results.NotFound();
    db.CellCounts.Remove(existing);
    await db.SaveChangesAsync();
    return Results.NoContent();
});

// Image adjustment endpoints

app.MapGet("/imageadjustments", async (Guid collectionId, AnnotationDbContext db) =>
    Results.Ok(await db.ImageAdjustments.Where(a => a.CollectionId == collectionId).ToListAsync()));

app.MapPost("/imageadjustments", async (AnnotationStore.ImageAdjustments.ImageAdjustments adjustment, AnnotationDbContext db) =>
{
    var collection = await db.Collections.FindAsync(adjustment.CollectionId);
    if (collection is null) return Results.NotFound($"No collection {adjustment.CollectionId}");

    if (adjustment.ImageAdjustmentId == Guid.Empty) adjustment.ImageAdjustmentId = Guid.NewGuid();
    adjustment.SlideId = collection.SlideId;
    adjustment.Created = DateTimeOffset.UtcNow;
    db.ImageAdjustments.Add(adjustment);
    await db.SaveChangesAsync();
    return Results.Created($"/imageadjustments/{adjustment.ImageAdjustmentId}", adjustment);
});

app.MapPut("/imageadjustments/{id:guid}", async (Guid id, AnnotationStore.ImageAdjustments.ImageAdjustments update, AnnotationDbContext db) =>
{
    var existing = await db.ImageAdjustments.FindAsync(id);
    if (existing is null) return Results.NotFound();
    existing.AdjustmentName = update.AdjustmentName;
    existing.Adjustments = update.Adjustments;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

app.MapDelete("/imageadjustments/{id:guid}", async (Guid id, AnnotationDbContext db) =>
{
    var existing = await db.ImageAdjustments.FindAsync(id);
    if (existing is null) return Results.NotFound();
    db.ImageAdjustments.Remove(existing);
    await db.SaveChangesAsync();
    return Results.NoContent();
});

app.Run();

// Lets the test project point WebApplicationFactory<Program> at this app.
public partial class Program;
