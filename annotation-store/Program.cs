using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using AnnotationStore.Annotations;
using AnnotationStore.Auth;
using AnnotationStore.CellCounts;
using AnnotationStore.ChangeSets;
using AnnotationStore.Collections;
using AnnotationStore.ImageAdjustments;
using AnnotationStore.Paging;
using DotNetEnv;
using Microsoft.AspNetCore.Mvc;
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
// Needs a real origin list once deployed. Change-Set-Id is let through so
// the viewer can read which change set a write went in.
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader().WithExposedHeaders(ChangeSetEndpoints.Header));
});

builder.Services.AddOpenApi();

// Sign-in via Keycloak on every endpoint - see Auth/KeycloakAuth.cs.
builder.AddKeycloakAuth();

// Guest tokens from realtime-hub, view only on a few reads - see Auth/GuestAuth.cs.
builder.AddGuestAuth();

// Roles go over the wire as "owner" rather than 2.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));

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
app.UseAuthentication();
app.UseAuthorization();

// The API reference stays open - it's only the data that needs signing in.
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
    app.MapScalarApiReference().AllowAnonymous();
}

// Dev convenience so a fresh checkout (or a pulled schema change) doesn't
// need a manual `dotnet ef database update` first - creates the database
// and applies any pending migrations on startup. Database:MigrateOnStartup
// does the same outside Development, for the container (see Dockerfile).
if (app.Environment.IsDevelopment() || app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<AnnotationDbContext>().Database.Migrate();
}

app.MapCollectionEndpoints();
app.MapAnnotationGroupEndpoints();
app.MapChangeSetEndpoints();

// Annotation endpoints

// Newest first. Without skip/take/search/filters it's every annotation in
// the collection - what the map loads. The Saved list asks for a page at a
// time (see Paging/Paging.cs), with /total giving the count for the same
// search and filters, and /facets the people and colours to filter by.
// Anyone in the collection can read. Adding, changing and deleting need
// editor or owner - see Collections/CollectionAccess.cs. Every write goes
// in a change set, and a delete only hides the row - see ChangeSets/.
app.MapGet("/annotations", async (Guid collectionId, int? skip, int? take, string? search, [AsParameters] SavedFilter filter, ClaimsPrincipal user, AnnotationDbContext db) =>
    SavedPaging.Invalid(skip, take)
    ?? await db.RequireAsync(collectionId, user, CollectionRole.Viewer)
    ?? Results.Ok(await db.Annotations
        .Where(a => a.CollectionId == collectionId)
        .Matching(search)
        .Filtered(filter)
        .NewestFirst()
        .Page(skip, take)
        .ToListAsync())).AllowGuests();

app.MapGet("/annotations/total", async (Guid collectionId, string? search, [AsParameters] SavedFilter filter, ClaimsPrincipal user, AnnotationDbContext db) =>
    await db.RequireAsync(collectionId, user, CollectionRole.Viewer)
    ?? Results.Ok(await db.Annotations
        .Where(a => a.CollectionId == collectionId)
        .Matching(search)
        .Filtered(filter)
        .CountAsync())).AllowGuests();

app.MapGet("/annotations/facets", async (Guid collectionId, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    if (await db.RequireAsync(collectionId, user, CollectionRole.Viewer) is { } denied) return denied;
    var inCollection = db.Annotations.Where(a => a.CollectionId == collectionId);
    var authors = await inCollection
        .Where(a => a.CreatedById != "")
        .GroupBy(a => new { a.CreatedById, a.CreatedByName })
        .Select(g => new SavedAuthor(g.Key.CreatedById, g.Key.CreatedByName, g.Count()))
        .ToListAsync();
    var colours = await inCollection
        .GroupBy(a => a.Colour)
        .Select(g => new SavedColour(g.Key, g.Count()))
        .ToListAsync();
    return Results.Ok(new SavedFacets(SavedPaging.Authors(authors), SavedPaging.Colours(colours)));
}).AllowGuests();

app.MapPost("/annotations", async (Annotation annotation, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    if (await db.RequireAsync(annotation.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    if (!await db.GroupIsInAsync(annotation.GroupId, annotation.CollectionId)) return Results.BadRequest("That group isn't in this collection");
    if ((await db.ChangeSetAsync(http, annotation.CollectionId, user, "add annotation")).Problem is { } problem) return problem;
    var collection = await db.Collections.FirstAsync(c => c.CollectionId == annotation.CollectionId);

    if (annotation.Id == Guid.Empty) annotation.Id = Guid.NewGuid();
    // Derived from the collection, not trusted from the client - keeps this
    // denormalized copy from ever drifting away from the real relationship.
    annotation.SlideId = collection.SlideId;
    annotation.Created = DateTimeOffset.UtcNow;
    annotation.CreatedById = user.UserId();
    annotation.CreatedByName = user.DisplayName();
    db.Annotations.Add(annotation);
    await db.SaveChangesAsync();
    return Results.Created($"/annotations/{annotation.Id}", annotation);
});

app.MapPut("/annotations/{id:guid}", async (Guid id, Annotation update, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    var existing = await db.Annotations.FirstOrDefaultAsync(r => r.Id == id);
    if (existing is null) return Results.NotFound();
    if (await db.RequireAsync(existing.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    if ((await db.ChangeSetAsync(http, existing.CollectionId, user, "change annotation")).Problem is { } problem) return problem;
    existing.Label = update.Label;
    existing.Notes = update.Notes;
    existing.Colour = update.Colour;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

app.MapDelete("/annotations/{id:guid}", async (Guid id, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    var existing = await db.Annotations.FirstOrDefaultAsync(r => r.Id == id);
    if (existing is null) return Results.NotFound();
    if (await db.RequireAsync(existing.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    var (changeSet, problem) = await db.ChangeSetAsync(http, existing.CollectionId, user, "delete annotation");
    if (problem is not null) return problem;
    existing.SoftDelete(changeSet!);
    await db.SaveChangesAsync();
    return Results.NoContent();
});

// Cell count endpoints

// Newest first, paged, searched and filtered the same way as annotations. Without
// the dots - each list item has their colour and placed-by counts instead
// (CellCounts/CellCountSummary.cs), and GET /cellcounts/{id} has the dots
// for the one the viewer actually draws.
app.MapGet("/cellcounts", async (Guid collectionId, int? skip, int? take, string? search, [AsParameters] SavedFilter filter, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    if (SavedPaging.Invalid(skip, take) is { } invalid) return invalid;
    if (await db.RequireAsync(collectionId, user, CollectionRole.Viewer) is { } denied) return denied;

    return Results.Ok(await db.CellCounts
        .Where(c => c.CollectionId == collectionId)
        .Matching(search)
        .Filtered(filter)
        .NewestFirst()
        .Page(skip, take)
        .ListItemsAsync(db));
}).AllowGuests();

app.MapGet("/cellcounts/total", async (Guid collectionId, string? search, [AsParameters] SavedFilter filter, ClaimsPrincipal user, AnnotationDbContext db) =>
    await db.RequireAsync(collectionId, user, CollectionRole.Viewer)
    ?? Results.Ok(await db.CellCounts
        .Where(c => c.CollectionId == collectionId)
        .Matching(search)
        .Filtered(filter)
        .CountAsync())).AllowGuests();

app.MapGet("/cellcounts/facets", async (Guid collectionId, ClaimsPrincipal user, AnnotationDbContext db) =>
    await db.RequireAsync(collectionId, user, CollectionRole.Viewer)
    ?? Results.Ok(new SavedFacets(
        SavedPaging.Authors(await db.CellCounts
            .Where(c => c.CollectionId == collectionId && c.CreatedById != "")
            .GroupBy(c => new { c.CreatedById, c.CreatedByName })
            .Select(g => new SavedAuthor(g.Key.CreatedById, g.Key.CreatedByName, g.Count()))
            .ToListAsync()),
        []))).AllowGuests();

// One count on its own - for when the viewer needs a count that isn't on
// the page it has loaded, e.g. the one a session's host is editing.
app.MapGet("/cellcounts/{id:guid}", async (Guid id, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    var cellCount = await db.CellCounts.Include(c => c.RegionOfInterest).FirstOrDefaultAsync(c => c.Id == id);
    if (cellCount is null) return Results.NotFound();
    return await db.RequireAsync(cellCount.CollectionId, user, CollectionRole.Viewer) ?? Results.Ok(cellCount);
}).AllowGuests();

// Every dot goes in the one request, at about 60 bytes a dot, so the 30 MB
// default only took counts up to ~495k. This takes a million with room spare.
app.MapPost("/cellcounts", [RequestSizeLimit(CellCountLimits.MaxRequestBytes)] async (CellCount cellCount, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    if (await db.RequireAsync(cellCount.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    if ((await db.ChangeSetAsync(http, cellCount.CollectionId, user, "add cell count")).Problem is { } problem) return problem;
    var collection = await db.Collections.FirstAsync(c => c.CollectionId == cellCount.CollectionId);

    if (cellCount.Id == Guid.Empty) cellCount.Id = Guid.NewGuid();
    cellCount.SlideId = collection.SlideId;
    cellCount.Created = DateTimeOffset.UtcNow;
    CellCountSummary.Stamp(cellCount);
    cellCount.CreatedById = user.UserId();
    cellCount.CreatedByName = user.DisplayName();
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

app.MapPut("/cellcounts/{id:guid}", async (Guid id, CellCount update, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    var existing = await db.CellCounts.FirstOrDefaultAsync(r => r.Id == id);
    if (existing is null) return Results.NotFound();
    if (await db.RequireAsync(existing.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    if ((await db.ChangeSetAsync(http, existing.CollectionId, user, "change cell count")).Problem is { } problem) return problem;
    existing.Label = update.Label;
    existing.Notes = update.Notes;
    existing.WithAnnotation = update.WithAnnotation;
    existing.WithRoi = update.WithRoi;
    existing.Count = update.Count;
    existing.DotSize = update.DotSize;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

// Its region of interest is left as it is, so it comes back with it.
app.MapDelete("/cellcounts/{id:guid}", async (Guid id, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    var existing = await db.CellCounts.FirstOrDefaultAsync(r => r.Id == id);
    if (existing is null) return Results.NotFound();
    if (await db.RequireAsync(existing.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    var (changeSet, problem) = await db.ChangeSetAsync(http, existing.CollectionId, user, "delete cell count");
    if (problem is not null) return problem;
    existing.SoftDelete(changeSet!);
    await db.SaveChangesAsync();
    return Results.NoContent();
});

// Image adjustment endpoints

// Presets are personal - the viewer keeps them in the user's own collection.
app.MapGet("/imageadjustments", async (Guid collectionId, ClaimsPrincipal user, AnnotationDbContext db) =>
    await db.RequireAsync(collectionId, user, CollectionRole.Viewer)
    ?? Results.Ok(await db.ImageAdjustments.Where(a => a.CollectionId == collectionId).ToListAsync()));

app.MapPost("/imageadjustments", async (AnnotationStore.ImageAdjustments.ImageAdjustments adjustment, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    if (await db.RequireAsync(adjustment.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    if ((await db.ChangeSetAsync(http, adjustment.CollectionId, user, "add image adjustment")).Problem is { } problem) return problem;
    var collection = await db.Collections.FirstAsync(c => c.CollectionId == adjustment.CollectionId);
    adjustment.UserId = user.UserId();

    if (adjustment.ImageAdjustmentId == Guid.Empty) adjustment.ImageAdjustmentId = Guid.NewGuid();
    adjustment.SlideId = collection.SlideId;
    adjustment.Created = DateTimeOffset.UtcNow;
    db.ImageAdjustments.Add(adjustment);
    await db.SaveChangesAsync();
    return Results.Created($"/imageadjustments/{adjustment.ImageAdjustmentId}", adjustment);
});

app.MapPut("/imageadjustments/{id:guid}", async (Guid id, AnnotationStore.ImageAdjustments.ImageAdjustments update, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    var existing = await db.ImageAdjustments.FirstOrDefaultAsync(r => r.ImageAdjustmentId == id);
    if (existing is null) return Results.NotFound();
    if (await db.RequireAsync(existing.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    if ((await db.ChangeSetAsync(http, existing.CollectionId, user, "change image adjustment")).Problem is { } problem) return problem;
    existing.AdjustmentName = update.AdjustmentName;
    existing.Adjustments = update.Adjustments;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

app.MapDelete("/imageadjustments/{id:guid}", async (Guid id, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    var existing = await db.ImageAdjustments.FirstOrDefaultAsync(r => r.ImageAdjustmentId == id);
    if (existing is null) return Results.NotFound();
    if (await db.RequireAsync(existing.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    var (changeSet, problem) = await db.ChangeSetAsync(http, existing.CollectionId, user, "delete image adjustment");
    if (problem is not null) return problem;
    existing.SoftDelete(changeSet!);
    await db.SaveChangesAsync();
    return Results.NoContent();
});

app.Run();

// Lets the test project point WebApplicationFactory<Program> at this app.
public partial class Program;
