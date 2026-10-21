using System.Security.Claims;
using AnnotationStore.Auth;
using AnnotationStore.ChangeSets;
using AnnotationStore.Collections;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.Annotations;

public record GroupView(Guid Id, Guid CollectionId, string Name, string Notes, DateTimeOffset Created, int Count);

// AnnotationIds, if given, go straight into the new group - "group these".
public record NewGroupRequest(Guid CollectionId, string Name, List<Guid>? AnnotationIds = null);

// Either or both - whatever's left out stays as it is.
public record GroupUpdateRequest(string? Name = null, string? Notes = null);

public record GroupMergeRequest(Guid IntoId);

// Several annotations at once, from the viewer's Select tab. Colour changes
// all their colours. SetGroup moves them all into GroupId, or out of any
// group when GroupId is null.
public record BulkUpdateRequest(Guid CollectionId, List<Guid> Ids, string? Colour = null, bool SetGroup = false, Guid? GroupId = null);

public record BulkDeleteRequest(Guid CollectionId, List<Guid> Ids);

public record BulkResult(int Count);

// Groups, and changing or deleting many annotations in one go. Same rules
// as single annotations - anyone in the collection reads, editors and the
// owner change things. Each request goes in a change set - a bulk change
// sent in batches sends the same Change-Set-Id with each, so it's one.
public static class AnnotationGroupEndpoints
{
    public const int MaxNameLength = 64;
    public const int MaxNotesLength = 10_000;
    public const int MaxBulkIds = 20_000;

    public static void MapAnnotationGroupEndpoints(this WebApplication app)
    {
        app.MapGet("/annotationgroups", async (Guid collectionId, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(collectionId, user, CollectionRole.Viewer) is { } denied) return denied;
            return Results.Ok(await GroupViews(db, collectionId).ToListAsync());
        }).AllowGuests();

        app.MapPost("/annotationgroups", async (NewGroupRequest request, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(request.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if (InvalidName(request.Name) is { } invalid) return invalid;
            if (request.AnnotationIds is { Count: > MaxBulkIds }) return Results.BadRequest($"At most {MaxBulkIds} at a time");
            if ((await db.ChangeSetAsync(http, request.CollectionId, user, "add group")).Problem is { } problem) return problem;

            var group = new AnnotationGroup
            {
                Id = Guid.NewGuid(),
                CollectionId = request.CollectionId,
                Name = request.Name.Trim(),
                Created = DateTimeOffset.UtcNow,
            };
            db.AnnotationGroups.Add(group);
            await db.SaveChangesAsync();
            if (request.AnnotationIds is { Count: > 0 } ids)
                await InCollection(db, request.CollectionId, ids).ExecuteUpdateAsync(s => s.SetProperty(a => a.GroupId, group.Id));

            return Results.Created($"/annotationgroups/{group.Id}",
                await GroupViews(db, request.CollectionId, group.Id).FirstAsync());
        });

        app.MapPut("/annotationgroups/{id:guid}", async (Guid id, GroupUpdateRequest request, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var group = await db.AnnotationGroups.FirstOrDefaultAsync(g => g.Id == id);
            if (group is null) return Results.NotFound();
            if (await db.RequireAsync(group.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if (request.Name is not null && InvalidName(request.Name) is { } invalid) return invalid;
            if (request.Notes is { Length: > MaxNotesLength }) return Results.BadRequest($"Notes are up to {MaxNotesLength} characters");
            if ((await db.ChangeSetAsync(http, group.CollectionId, user, "change group")).Problem is { } problem) return problem;
            if (request.Name is not null) group.Name = request.Name.Trim();
            if (request.Notes is not null) group.Notes = request.Notes;
            await db.SaveChangesAsync();
            return Results.Ok(await GroupViews(db, group.CollectionId, id).FirstAsync());
        });

        // Everything in this group moves into IntoId, and this one goes.
        // Notes are kept - joined if both have some. Answers with the group
        // it went into. Deleted annotations move too, so restoring one never
        // puts it in a group that's gone.
        app.MapPost("/annotationgroups/{id:guid}/merge", async (Guid id, GroupMergeRequest request, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var group = await db.AnnotationGroups.FirstOrDefaultAsync(g => g.Id == id);
            if (group is null) return Results.NotFound();
            if (await db.RequireAsync(group.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if (request.IntoId == id) return Results.BadRequest("A group can't merge into itself");
            var into = await db.AnnotationGroups.FirstOrDefaultAsync(g => g.Id == request.IntoId && g.CollectionId == group.CollectionId);
            if (into is null) return Results.BadRequest("That group isn't in this collection");
            var (changeSet, problem) = await db.ChangeSetAsync(http, group.CollectionId, user, "merge groups");
            if (problem is not null) return problem;

            await using var transaction = await db.Database.BeginTransactionAsync();
            await db.Annotations.IgnoreQueryFilters().Where(a => a.GroupId == id).ExecuteUpdateAsync(s => s.SetProperty(a => a.GroupId, into.Id));
            into.Notes = JoinNotes(into.Notes, group.Notes);
            group.SoftDelete(changeSet!);
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.Ok(await GroupViews(db, into.CollectionId, into.Id).FirstAsync());
        });

        // Ungroups what was in it - the annotations stay. Deleted ones too,
        // so restoring one never puts it in a group that's gone.
        app.MapDelete("/annotationgroups/{id:guid}", async (Guid id, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var group = await db.AnnotationGroups.FirstOrDefaultAsync(g => g.Id == id);
            if (group is null) return Results.NotFound();
            if (await db.RequireAsync(group.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            var (changeSet, problem) = await db.ChangeSetAsync(http, group.CollectionId, user, "delete group");
            if (problem is not null) return problem;

            await using var transaction = await db.Database.BeginTransactionAsync();
            await db.Annotations.IgnoreQueryFilters().Where(a => a.GroupId == id).ExecuteUpdateAsync(s => s.SetProperty(a => a.GroupId, (Guid?)null));
            group.SoftDelete(changeSet!);
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Results.NoContent();
        });

        // Only touches ids that are in the collection - anything else is
        // ignored, and Count says how many changed.
        app.MapPut("/annotations/bulk", async (BulkUpdateRequest request, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(request.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if (request.Ids.Count > MaxBulkIds) return Results.BadRequest($"At most {MaxBulkIds} at a time");
            if (request.Colour is null && !request.SetGroup) return Results.BadRequest("Nothing to change");
            if (request.SetGroup && !await db.GroupIsInAsync(request.GroupId, request.CollectionId))
                return Results.BadRequest("That group isn't in this collection");
            if ((await db.ChangeSetAsync(http, request.CollectionId, user, "change annotations")).Problem is { } problem) return problem;

            var matching = InCollection(db, request.CollectionId, request.Ids);
            var count = request switch
            {
                { Colour: { } colour, SetGroup: true } => await matching.ExecuteUpdateAsync(s => s
                    .SetProperty(a => a.Colour, colour)
                    .SetProperty(a => a.GroupId, request.GroupId)),
                { Colour: { } colour } => await matching.ExecuteUpdateAsync(s => s.SetProperty(a => a.Colour, colour)),
                _ => await matching.ExecuteUpdateAsync(s => s.SetProperty(a => a.GroupId, request.GroupId)),
            };
            return Results.Ok(new BulkResult(count));
        });

        // POST rather than DELETE, so the ids can go in the body. Put back
        // with POST /changesets/{id}/restore.
        app.MapPost("/annotations/bulk-delete", async (BulkDeleteRequest request, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(request.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if (request.Ids.Count > MaxBulkIds) return Results.BadRequest($"At most {MaxBulkIds} at a time");
            var (changeSet, problem) = await db.ChangeSetAsync(http, request.CollectionId, user, "delete annotations");
            if (problem is not null) return problem;
            var count = await InCollection(db, request.CollectionId, request.Ids).SoftDeleteAsync(changeSet!);
            return Results.Ok(new BulkResult(count));
        });
    }

    // A group has to be one in the same collection. No group is fine.
    public static async Task<bool> GroupIsInAsync(this AnnotationDbContext db, Guid? groupId, Guid collectionId) =>
        groupId is not { } id || await db.AnnotationGroups.AnyAsync(g => g.Id == id && g.CollectionId == collectionId);

    private static IQueryable<Annotation> InCollection(AnnotationDbContext db, Guid collectionId, List<Guid> ids) =>
        db.Annotations.Where(a => a.CollectionId == collectionId && ids.Contains(a.Id));

    // Just the one, given an id.
    private static IQueryable<GroupView> GroupViews(AnnotationDbContext db, Guid collectionId, Guid? id = null) =>
        db.AnnotationGroups
            .Where(g => g.CollectionId == collectionId && (id == null || g.Id == id))
            .OrderBy(g => g.Name)
            .Select(g => new GroupView(g.Id, g.CollectionId, g.Name, g.Notes, g.Created, db.Annotations.Count(a => a.GroupId == g.Id)));

    // Blank ones drop out, so merging into a group with no notes just takes
    // the other's.
    public static string JoinNotes(string first, string second) =>
        string.Join("\n\n", new[] { first.Trim(), second.Trim() }.Where(n => n != ""));

    private static IResult? InvalidName(string? name) =>
        string.IsNullOrWhiteSpace(name) ? Results.BadRequest("A name is needed")
        : name.Trim().Length > MaxNameLength ? Results.BadRequest($"Names are up to {MaxNameLength} characters")
        : null;
}
