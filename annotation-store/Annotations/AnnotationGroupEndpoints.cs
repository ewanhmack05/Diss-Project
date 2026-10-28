using System.Security.Claims;
using AnnotationStore.Auth;
using AnnotationStore.Collections;
using AnnotationStore.Conflicts;
using AnnotationStore.History;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.Annotations;

public record GroupView(Guid Id, Guid CollectionId, string Name, string Notes, DateTimeOffset Created, int Count);

// AnnotationIds, if given, go straight into the new group - "group these".
public record NewGroupRequest(Guid CollectionId, string Name, List<Guid>? AnnotationIds = null);

// Either or both - whatever's left out stays as it is. WasName and WasNotes
// are what the save started from, checked in a FirstComeWins session - see
// Conflicts/EditConflicts.cs.
public record GroupUpdateRequest(string? Name = null, string? Notes = null, string? WasName = null, string? WasNotes = null);

public record GroupMergeRequest(Guid IntoId);

// Several annotations at once, from the viewer's Select tab. Colour changes
// all their colours. SetGroup moves them all into GroupId, or out of any
// group when GroupId is null. WasColours and WasGroups are each one's colour
// and group as the viewer had them, checked in a FirstComeWins session.
public record BulkUpdateRequest(
    Guid CollectionId, List<Guid> Ids, string? Colour = null, bool SetGroup = false, Guid? GroupId = null,
    Dictionary<Guid, string>? WasColours = null, Dictionary<Guid, Guid?>? WasGroups = null);

public record BulkDeleteRequest(Guid CollectionId, List<Guid> Ids);

// Conflicts are the ones a FirstComeWins session left alone, as they are now.
// Overwrote is how many replaced someone else's change, in a LastWriteWins one.
public record BulkResult(int Count, List<BulkConflict>? Conflicts = null, int Overwrote = 0);

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
            await using var transaction = await HistoryLog.BeginAsync(db);
            db.AnnotationGroups.Add(group);
            await db.SaveChangesAsync();
            if (request.AnnotationIds is { Count: > 0 } ids)
                await AnnotationBulk.UpdateAsync(db, InCollection(db, request.CollectionId, ids), setGroup: true, groupId: group.Id);
            if (transaction is not null) await transaction.CommitAsync();

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

            await using var transaction = await HistoryLog.BeginAsync(db);
            await EditConflicts.LockGroupAsync(db, id);
            await db.Entry(group).ReloadAsync();
            if (db.Entry(group).State == EntityState.Detached) return Results.NotFound();
            // One the same as its was isn't being changed, so it's left as it is now.
            var name = request.WasName is not null && request.Name?.Trim() == request.WasName ? null : request.Name?.Trim();
            var notes = request.WasNotes is not null && request.Notes == request.WasNotes ? null : request.Notes;
            var inWay = new List<string>();
            if (name is not null && EditConflicts.InWay(request.WasName is not null, request.WasName, group.Name, name))
                inWay.Add(nameof(AnnotationGroup.Name));
            if (notes is not null && EditConflicts.InWay(request.WasNotes is not null, request.WasNotes, group.Notes, notes))
                inWay.Add(nameof(AnnotationGroup.Notes));
            if (inWay.Count > 0)
            {
                var policy = await EditConflicts.PolicyAsync(db, group.CollectionId);
                EditConflicts.Count(policy, HistoryLog.Group);
                if (policy == EditPolicy.FirstComeWins)
                    return await EditConflicts.ConflictAsync(db, HistoryLog.Group, id, await GroupViews(db, group.CollectionId, id).FirstAsync(), inWay);
                http.Response.Headers[EditConflicts.OverwroteHeader] = "1";
            }
            if ((await db.ChangeSetAsync(http, group.CollectionId, user, "change group")).Problem is { } problem) return problem;
            if (name is not null) group.Name = name;
            if (notes is not null) group.Notes = notes;
            await db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            return Results.Ok(await GroupViews(db, group.CollectionId, id).FirstAsync());
        });

        // Everything in this group moves into IntoId, and this one goes.
        // Notes are kept - joined if both have some. Answers with the group
        // it went into. Its delete says where it went, so an annotation put
        // back later that was in it lands in IntoId instead.
        app.MapPost("/annotationgroups/{id:guid}/merge", async (Guid id, GroupMergeRequest request, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var group = await db.AnnotationGroups.FirstOrDefaultAsync(g => g.Id == id);
            if (group is null) return Results.NotFound();
            if (await db.RequireAsync(group.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if (request.IntoId == id) return Results.BadRequest("A group can't merge into itself");
            var into = await db.AnnotationGroups.FirstOrDefaultAsync(g => g.Id == request.IntoId && g.CollectionId == group.CollectionId);
            if (into is null) return Results.BadRequest("That group isn't in this collection");
            if ((await db.ChangeSetAsync(http, group.CollectionId, user, "merge groups")).Problem is { } problem) return problem;

            await using var transaction = await HistoryLog.BeginAsync(db);
            await AnnotationBulk.UpdateAsync(db, db.Annotations.Where(a => a.GroupId == id), setGroup: true, groupId: into.Id);
            into.Notes = JoinNotes(into.Notes, group.Notes);
            db.AnnotationGroups.Remove(group);
            db.DeleteNotes[group] = new { MergedInto = into.Id };
            await db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            return Results.Ok(await GroupViews(db, into.CollectionId, into.Id).FirstAsync());
        });

        // Ungroups what was in it - the annotations stay. Putting it back
        // puts them back in it.
        app.MapDelete("/annotationgroups/{id:guid}", async (Guid id, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var group = await db.AnnotationGroups.FirstOrDefaultAsync(g => g.Id == id);
            if (group is null) return Results.NotFound();
            if (await db.RequireAsync(group.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if ((await db.ChangeSetAsync(http, group.CollectionId, user, "delete group")).Problem is { } problem) return problem;

            await using var transaction = await HistoryLog.BeginAsync(db);
            await AnnotationBulk.UpdateAsync(db, db.Annotations.Where(a => a.GroupId == id), setGroup: true, groupId: null);
            db.AnnotationGroups.Remove(group);
            await db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            return Results.NoContent();
        });

        // Only touches ids that are in the collection - anything else is
        // ignored, and Count says how many changed. In a FirstComeWins
        // session, ones someone else has recoloured or regrouped since the
        // viewer read them are left alone and listed in Conflicts.
        app.MapPut("/annotations/bulk", async (BulkUpdateRequest request, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(request.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if (request.Ids.Count > MaxBulkIds) return Results.BadRequest($"At most {MaxBulkIds} at a time");
            if (request.Colour is null && !request.SetGroup) return Results.BadRequest("Nothing to change");
            if (request.SetGroup && !await db.GroupIsInAsync(request.GroupId, request.CollectionId))
                return Results.BadRequest("That group isn't in this collection");

            var rows = InCollection(db, request.CollectionId, request.Ids);
            if (request.WasColours is null && request.WasGroups is null)
            {
                if ((await db.ChangeSetAsync(http, request.CollectionId, user, "change annotations")).Problem is { } notChecked) return notChecked;
                return Results.Ok(new BulkResult(await AnnotationBulk.UpdateAsync(db, rows, request.Colour, request.SetGroup, request.GroupId)));
            }

            await using var transaction = await HistoryLog.BeginAsync(db);
            await EditConflicts.LockAnnotationsAsync(db, request.Ids);
            var now = await rows.AsNoTracking().Select(a => new { a.Id, a.Colour, a.GroupId }).ToListAsync();
            var inWay = now.Where(a =>
                    (request.Colour is not null && request.WasColours is not null && request.WasColours.TryGetValue(a.Id, out var colour)
                        && EditConflicts.InWay(true, colour, a.Colour, request.Colour))
                    || (request.SetGroup && request.WasGroups is not null && request.WasGroups.TryGetValue(a.Id, out var group)
                        && EditConflicts.InWay(true, group, a.GroupId, request.GroupId)))
                .ToList();
            List<BulkConflict>? conflicts = null;
            var overwrote = 0;
            if (inWay.Count > 0)
            {
                var policy = await EditConflicts.PolicyAsync(db, request.CollectionId);
                EditConflicts.Count(policy, HistoryLog.Annotation, inWay.Count);
                if (policy == EditPolicy.FirstComeWins)
                {
                    var skipped = inWay.Select(a => a.Id).ToList();
                    rows = rows.Where(a => !skipped.Contains(a.Id));
                    var last = await EditConflicts.LastChangesAsync(db, HistoryLog.Annotation, skipped, EditConflicts.AnnotationFields);
                    conflicts = inWay.Select(a => new BulkConflict(a.Id, a.Colour, a.GroupId,
                        last.GetValueOrDefault(a.Id)?.By, last.GetValueOrDefault(a.Id)?.At)).ToList();
                    // All of it turned down - nothing changes, so no change set.
                    if (conflicts.Count == now.Count) return Results.Ok(new BulkResult(0, conflicts));
                }
                else overwrote = inWay.Count;
            }
            if ((await db.ChangeSetAsync(http, request.CollectionId, user, "change annotations")).Problem is { } problem) return problem;
            var count = await AnnotationBulk.UpdateAsync(db, rows, request.Colour, request.SetGroup, request.GroupId);
            if (transaction is not null) await transaction.CommitAsync();
            return Results.Ok(new BulkResult(count, conflicts, overwrote));
        });

        // POST rather than DELETE, so the ids can go in the body. Put back
        // with POST /changesets/{id}/restore.
        app.MapPost("/annotations/bulk-delete", async (BulkDeleteRequest request, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(request.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if (request.Ids.Count > MaxBulkIds) return Results.BadRequest($"At most {MaxBulkIds} at a time");
            if ((await db.ChangeSetAsync(http, request.CollectionId, user, "delete annotations")).Problem is { } problem) return problem;
            return Results.Ok(new BulkResult(await AnnotationBulk.DeleteAsync(db, InCollection(db, request.CollectionId, request.Ids))));
        });
    }

    // A group has to be one in the same collection. No group is fine.
    public static async Task<bool> GroupIsInAsync(this AnnotationDbContext db, Guid? groupId, Guid collectionId) =>
        groupId is not { } id || await db.AnnotationGroups.AnyAsync(g => g.Id == id && g.CollectionId == collectionId);

    private static IQueryable<Annotation> InCollection(AnnotationDbContext db, Guid collectionId, List<Guid> ids) =>
        db.Annotations.Where(a => a.CollectionId == collectionId && ids.Contains(a.Id));

    // Just the one, given an id, or just these, given ids.
    internal static IQueryable<GroupView> GroupViews(AnnotationDbContext db, Guid collectionId, Guid? id = null, List<Guid>? ids = null) =>
        db.AnnotationGroups
            .Where(g => g.CollectionId == collectionId && (id == null || g.Id == id) && (ids == null || ids.Contains(g.Id)))
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
