using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using AnnotationStore.Annotations;
using AnnotationStore.Auth;
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

// Sign-in via Keycloak on every endpoint - see Auth/KeycloakAuth.cs.
builder.AddKeycloakAuth();

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
// and applies any pending migrations on startup.
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<AnnotationDbContext>().Database.Migrate();
}

app.MapCollectionEndpoints();

// Annotation endpoints

// Newest first. Sorted after loading rather than in SQL - the tests run on
// SQLite, which can't order by DateTimeOffset, and one collection's list is small.
// Anyone in the collection can read. Adding, changing and deleting need
// editor or owner - see Collections/CollectionAccess.cs.
app.MapGet("/annotations", async (Guid collectionId, ClaimsPrincipal user, AnnotationDbContext db) =>
    await db.RequireAsync(collectionId, user, CollectionRole.Viewer)
    ?? Results.Ok((await db.Annotations.Where(a => a.CollectionId == collectionId).ToListAsync())
        .OrderByDescending(a => a.Created)));

app.MapPost("/annotations", async (Annotation annotation, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    if (await db.RequireAsync(annotation.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
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

app.MapPut("/annotations/{id:guid}", async (Guid id, Annotation update, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    var existing = await db.Annotations.FindAsync(id);
    if (existing is null) return Results.NotFound();
    if (await db.RequireAsync(existing.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    existing.Label = update.Label;
    existing.Notes = update.Notes;
    existing.Colour = update.Colour;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

app.MapDelete("/annotations/{id:guid}", async (Guid id, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    var existing = await db.Annotations.FindAsync(id);
    if (existing is null) return Results.NotFound();
    if (await db.RequireAsync(existing.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    db.Annotations.Remove(existing);
    await db.SaveChangesAsync();
    return Results.NoContent();
});

// Cell count endpoints

// Newest first, same as annotations.
app.MapGet("/cellcounts", async (Guid collectionId, ClaimsPrincipal user, AnnotationDbContext db) =>
    await db.RequireAsync(collectionId, user, CollectionRole.Viewer)
    ?? Results.Ok((await db.CellCounts
        .Where(c => c.CollectionId == collectionId)
        .Include(c => c.RegionOfInterest)
        .ToListAsync())
        .OrderByDescending(c => c.Created)));

app.MapPost("/cellcounts", async (CellCount cellCount, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    if (await db.RequireAsync(cellCount.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    var collection = await db.Collections.FirstAsync(c => c.CollectionId == cellCount.CollectionId);

    if (cellCount.Id == Guid.Empty) cellCount.Id = Guid.NewGuid();
    cellCount.SlideId = collection.SlideId;
    cellCount.Created = DateTimeOffset.UtcNow;
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

app.MapPut("/cellcounts/{id:guid}", async (Guid id, CellCount update, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    var existing = await db.CellCounts.FindAsync(id);
    if (existing is null) return Results.NotFound();
    if (await db.RequireAsync(existing.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    existing.Label = update.Label;
    existing.Notes = update.Notes;
    existing.WithAnnotation = update.WithAnnotation;
    existing.WithRoi = update.WithRoi;
    existing.Count = update.Count;
    existing.DotSize = update.DotSize;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

app.MapDelete("/cellcounts/{id:guid}", async (Guid id, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    var existing = await db.CellCounts.FindAsync(id);
    if (existing is null) return Results.NotFound();
    if (await db.RequireAsync(existing.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    db.CellCounts.Remove(existing);
    await db.SaveChangesAsync();
    return Results.NoContent();
});

// Image adjustment endpoints

// Presets are personal - the viewer keeps them in the user's own collection.
app.MapGet("/imageadjustments", async (Guid collectionId, ClaimsPrincipal user, AnnotationDbContext db) =>
    await db.RequireAsync(collectionId, user, CollectionRole.Viewer)
    ?? Results.Ok(await db.ImageAdjustments.Where(a => a.CollectionId == collectionId).ToListAsync()));

app.MapPost("/imageadjustments", async (AnnotationStore.ImageAdjustments.ImageAdjustments adjustment, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    if (await db.RequireAsync(adjustment.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    var collection = await db.Collections.FirstAsync(c => c.CollectionId == adjustment.CollectionId);
    adjustment.UserId = user.UserId();

    if (adjustment.ImageAdjustmentId == Guid.Empty) adjustment.ImageAdjustmentId = Guid.NewGuid();
    adjustment.SlideId = collection.SlideId;
    adjustment.Created = DateTimeOffset.UtcNow;
    db.ImageAdjustments.Add(adjustment);
    await db.SaveChangesAsync();
    return Results.Created($"/imageadjustments/{adjustment.ImageAdjustmentId}", adjustment);
});

app.MapPut("/imageadjustments/{id:guid}", async (Guid id, AnnotationStore.ImageAdjustments.ImageAdjustments update, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    var existing = await db.ImageAdjustments.FindAsync(id);
    if (existing is null) return Results.NotFound();
    if (await db.RequireAsync(existing.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    existing.AdjustmentName = update.AdjustmentName;
    existing.Adjustments = update.Adjustments;
    await db.SaveChangesAsync();
    return Results.Ok(existing);
});

app.MapDelete("/imageadjustments/{id:guid}", async (Guid id, ClaimsPrincipal user, AnnotationDbContext db) =>
{
    var existing = await db.ImageAdjustments.FindAsync(id);
    if (existing is null) return Results.NotFound();
    if (await db.RequireAsync(existing.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
    db.ImageAdjustments.Remove(existing);
    await db.SaveChangesAsync();
    return Results.NoContent();
});

app.Run();

// Lets the test project point WebApplicationFactory<Program> at this app.
public partial class Program;
