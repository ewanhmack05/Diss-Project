using System.Net;
using System.Net.Sockets;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.ImageAdjustments;
using DotNetEnv;
using Microsoft.EntityFrameworkCore;
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

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.SetIsOriginAllowed(IsAllowedOrigin).AllowAnyMethod().AllowAnyHeader());
});

builder.Services.AddOpenApi();

// Console exporter - no collector to stand up for a dev/dissertation setup.
// Swap AddConsoleExporter() for AddOtlpExporter() if this ever needs to feed
// a real backend (Jaeger, Aspire dashboard, etc).
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource.AddService("annotation-store"))
    .WithTracing(tracing => tracing.AddAspNetCoreInstrumentation().AddConsoleExporter())
    .WithMetrics(metrics => metrics.AddAspNetCoreInstrumentation().AddConsoleExporter());

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

// Annotation endpoints

app.MapGet("/annotations", async (string slideId, AnnotationDbContext db) =>
    Results.Ok(await db.Annotations.Where(a => a.SlideId == slideId).ToListAsync()));

app.MapPost("/annotations", async (Annotation annotation, AnnotationDbContext db) =>
{
    if (annotation.Id == Guid.Empty) annotation.Id = Guid.NewGuid();
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

app.MapGet("/cellcounts", async (string slideId, AnnotationDbContext db) =>
    Results.Ok(await db.CellCounts
        .Where(c => c.SlideId == slideId)
        .Include(c => c.RegionOfInterest)
        .ToListAsync()));

app.MapPost("/cellcounts", async (CellCount cellCount, AnnotationDbContext db) =>
{
    if (cellCount.Id == Guid.Empty) cellCount.Id = Guid.NewGuid();
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

app.MapGet("/imageadjustments", async (string slideId, AnnotationDbContext db) =>
    Results.Ok(await db.ImageAdjustments.Where(a => a.SlideId == slideId).ToListAsync()));

app.MapPost("/imageadjustments", async (AnnotationStore.ImageAdjustments.ImageAdjustments adjustment, AnnotationDbContext db) =>
{
    if (adjustment.ImageAdjustmentId == Guid.Empty) adjustment.ImageAdjustmentId = Guid.NewGuid();
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

// Allows localhost (the normal case) plus any origin on a private LAN
// (RFC 1918) address, so image-viewer can be opened from another device on
// the same network (a phone, another laptop) - without hardcoding this
// machine's actual IP here, which changes across networks and DHCP
// renewals.
static bool IsAllowedOrigin(string origin)
{
    if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return false;
    if (uri.Host is "localhost" or "127.0.0.1") return true;
    return IPAddress.TryParse(uri.Host, out var ip) && IsPrivateNetworkAddress(ip);
}

static bool IsPrivateNetworkAddress(IPAddress ip)
{
    if (ip.AddressFamily != AddressFamily.InterNetwork) return false;
    var bytes = ip.GetAddressBytes();
    return bytes[0] switch
    {
        10 => true, // 10.0.0.0/8 - also covers ZeroTier's default range
        172 => bytes[1] is >= 16 and <= 31, // 172.16.0.0/12
        192 => bytes[1] == 168, // 192.168.0.0/16
        _ => false,
    };
}

// Lets the test project point WebApplicationFactory<Program> at this app.
public partial class Program;
