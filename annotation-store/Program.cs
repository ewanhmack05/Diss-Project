using AnnotationStore.Annotations;
using DotNetEnv;
using Microsoft.EntityFrameworkCore;

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
        policy.WithOrigins("http://localhost:5173").AllowAnyMethod().AllowAnyHeader());
});

var app = builder.Build();
app.UseCors();

// Dev convenience so a fresh checkout (or a pulled schema change) doesn't
// need a manual `dotnet ef database update` first - creates the database
// and applies any pending migrations on startup.
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<AnnotationDbContext>().Database.Migrate();
}

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

app.Run();
