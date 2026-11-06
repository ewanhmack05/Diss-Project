using System.Security.Claims;
using AnnotationStore.Annotations;
using AnnotationStore.Auth;
using AnnotationStore.Collections;
using AnnotationStore.Conflicts;
using AnnotationStore.History;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.CellCounts;

public record CountGroupView(Guid Id, Guid CollectionId, string Name, string Notes, DateTimeOffset Created, int Count);

// CellCountIds, if given, go straight into the new group.
public record NewCountGroupRequest(Guid CollectionId, string Name, List<Guid>? CellCountIds = null);

// Either or both - whatever's left out stays as it is. WasName and WasNotes are
// what the save started from, checked in a FirstComeWins session - see
// Conflicts/EditConflicts.cs.
public record CountGroupUpdateRequest(string? Name = null, string? Notes = null, string? WasName = null, string? WasNotes = null);

// Puts them all in GroupId, or out of any group when it's null. WasGroups is
// each one's group as the viewer had it, checked in a FirstComeWins session.
public record CountGroupMoveRequest(Guid CollectionId, List<Guid> Ids, Guid? GroupId = null, Dictionary<Guid, Guid?>? WasGroups = null);

// The same rules as annotation groups - anyone in the collection reads, editors
// and the owner change things, and each request goes in a change set.
public static class CellCountGroupEndpoints
{
    public static void MapCellCountGroupEndpoints(this WebApplication app)
    {
        app.MapGet("/cellcountgroups", async (Guid collectionId, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(collectionId, user, CollectionRole.Viewer) is { } denied) return denied;
            return Results.Ok(await Views(db, collectionId).ToListAsync());
        }).AllowGuests();

        app.MapPost("/cellcountgroups", async (NewCountGroupRequest request, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(request.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if (InvalidName(request.Name) is { } invalid) return invalid;
            if (request.CellCountIds is { Count: > AnnotationGroupEndpoints.MaxBulkIds }) return Results.BadRequest($"At most {AnnotationGroupEndpoints.MaxBulkIds} at a time");
            if ((await db.ChangeSetAsync(http, request.CollectionId, user, "add cell count group")).Problem is { } problem) return problem;

            var group = new CellCountGroup
            {
                Id = Guid.NewGuid(),
                CollectionId = request.CollectionId,
                Name = request.Name.Trim(),
                Created = DateTimeOffset.UtcNow,
            };
            await using var transaction = await HistoryLog.BeginAsync(db);
            db.CellCountGroups.Add(group);
            await db.SaveChangesAsync();
            if (request.CellCountIds is { Count: > 0 } ids)
                await MoveAsync(db, InCollection(db, request.CollectionId, ids), group.Id);
            if (transaction is not null) await transaction.CommitAsync();
            return Results.Created($"/cellcountgroups/{group.Id}", await Views(db, request.CollectionId, group.Id).FirstAsync());
        });

        app.MapPut("/cellcountgroups/{id:guid}", async (Guid id, CountGroupUpdateRequest request, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var group = await db.CellCountGroups.FirstOrDefaultAsync(g => g.Id == id);
            if (group is null) return Results.NotFound();
            if (await db.RequireAsync(group.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if (request.Name is not null && InvalidName(request.Name) is { } invalid) return invalid;
            if (request.Notes is { Length: > AnnotationGroupEndpoints.MaxNotesLength }) return Results.BadRequest($"Notes are up to {AnnotationGroupEndpoints.MaxNotesLength} characters");

            await using var transaction = await HistoryLog.BeginAsync(db);
            await EditConflicts.LockCountGroupAsync(db, id);
            await db.Entry(group).ReloadAsync();
            if (db.Entry(group).State == EntityState.Detached) return Results.NotFound();
            // One the same as its was isn't being changed, so it's left as it is now.
            var name = request.WasName is not null && request.Name?.Trim() == request.WasName ? null : request.Name?.Trim();
            var notes = request.WasNotes is not null && request.Notes == request.WasNotes ? null : request.Notes;
            var inWay = new List<string>();
            if (name is not null && EditConflicts.InWay(request.WasName is not null, request.WasName, group.Name, name))
                inWay.Add(nameof(CellCountGroup.Name));
            if (notes is not null && EditConflicts.InWay(request.WasNotes is not null, request.WasNotes, group.Notes, notes))
                inWay.Add(nameof(CellCountGroup.Notes));
            if (inWay.Count > 0)
            {
                var policy = await EditConflicts.PolicyAsync(db, group.CollectionId);
                EditConflicts.Count(policy, HistoryLog.CellCountGroup);
                if (policy == EditPolicy.FirstComeWins)
                    return await EditConflicts.ConflictAsync(db, HistoryLog.CellCountGroup, id, await Views(db, group.CollectionId, id).FirstAsync(), inWay);
                http.Response.Headers[EditConflicts.OverwroteHeader] = "1";
            }
            if ((await db.ChangeSetAsync(http, group.CollectionId, user, "change cell count group")).Problem is { } problem) return problem;
            if (name is not null) group.Name = name;
            if (notes is not null) group.Notes = notes;
            await db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            return Results.Ok(await Views(db, group.CollectionId, id).FirstAsync());
        });

        // Everything in this group moves into IntoId, and this one goes. Notes
        // are kept - joined if both have some. Answers with the group it went
        // into. Its delete says where it went, so a count put back later that was
        // in it lands in IntoId instead.
        app.MapPost("/cellcountgroups/{id:guid}/merge", async (Guid id, GroupMergeRequest request, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var group = await db.CellCountGroups.FirstOrDefaultAsync(g => g.Id == id);
            if (group is null) return Results.NotFound();
            if (await db.RequireAsync(group.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if (request.IntoId == id) return Results.BadRequest("A group can't merge into itself");
            var into = await db.CellCountGroups.FirstOrDefaultAsync(g => g.Id == request.IntoId && g.CollectionId == group.CollectionId);
            if (into is null) return Results.BadRequest("That group isn't in this collection");
            if ((await db.ChangeSetAsync(http, group.CollectionId, user, "merge groups")).Problem is { } problem) return problem;

            await using var transaction = await HistoryLog.BeginAsync(db);
            await MoveAsync(db, db.CellCounts.Where(c => c.GroupId == id), into.Id);
            into.Notes = AnnotationGroupEndpoints.JoinNotes(into.Notes, group.Notes);
            db.CellCountGroups.Remove(group);
            db.DeleteNotes[group] = new { MergedInto = into.Id };
            await db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            return Results.Ok(await Views(db, into.CollectionId, into.Id).FirstAsync());
        });

        // Ungroups what was in it - the counts stay. Putting it back puts them
        // back in it.
        app.MapDelete("/cellcountgroups/{id:guid}", async (Guid id, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var group = await db.CellCountGroups.FirstOrDefaultAsync(g => g.Id == id);
            if (group is null) return Results.NotFound();
            if (await db.RequireAsync(group.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if ((await db.ChangeSetAsync(http, group.CollectionId, user, "delete cell count group")).Problem is { } problem) return problem;

            await using var transaction = await HistoryLog.BeginAsync(db);
            await MoveAsync(db, db.CellCounts.Where(c => c.GroupId == id), null);
            db.CellCountGroups.Remove(group);
            await db.SaveChangesAsync();
            if (transaction is not null) await transaction.CommitAsync();
            return Results.NoContent();
        });

        // Only touches ids that are in the collection - anything else is ignored,
        // and Count says how many matched. In a FirstComeWins session, ones someone
        // else has moved since the viewer read them are left alone and listed in
        // Conflicts.
        app.MapPut("/cellcounts/group", async (CountGroupMoveRequest request, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(request.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if (request.Ids.Count > AnnotationGroupEndpoints.MaxBulkIds) return Results.BadRequest($"At most {AnnotationGroupEndpoints.MaxBulkIds} at a time");
            if (request.GroupId is { } wanted && !await db.CellCountGroups.AnyAsync(g => g.Id == wanted && g.CollectionId == request.CollectionId))
                return Results.BadRequest("That group isn't in this collection");

            var rows = InCollection(db, request.CollectionId, request.Ids);
            if (request.WasGroups is null)
            {
                if ((await db.ChangeSetAsync(http, request.CollectionId, user, "change cell counts")).Problem is { } notChecked) return notChecked;
                return Results.Ok(new BulkResult(await MoveAsync(db, rows, request.GroupId)));
            }

            await using var transaction = await HistoryLog.BeginAsync(db);
            await EditConflicts.LockCellCountsAsync(db, request.Ids);
            var now = await rows.AsNoTracking().Select(c => new { c.Id, c.GroupId }).ToListAsync();
            var inWay = now.Where(c => request.WasGroups.TryGetValue(c.Id, out var was) && EditConflicts.InWay(true, was, c.GroupId, request.GroupId)).ToList();
            List<BulkConflict>? conflicts = null;
            var overwrote = 0;
            if (inWay.Count > 0)
            {
                var policy = await EditConflicts.PolicyAsync(db, request.CollectionId);
                EditConflicts.Count(policy, HistoryLog.CellCount, inWay.Count);
                if (policy == EditPolicy.FirstComeWins)
                {
                    var skipped = inWay.Select(c => c.Id).ToList();
                    rows = rows.Where(c => !skipped.Contains(c.Id));
                    var last = await EditConflicts.LastChangesAsync(db, HistoryLog.CellCount, skipped, EditConflicts.CountGroupField);
                    conflicts = inWay.Select(c => new BulkConflict(c.Id, "", c.GroupId, last.GetValueOrDefault(c.Id)?.By, last.GetValueOrDefault(c.Id)?.At)).ToList();
                    // All of it turned down - nothing changes, so no change set.
                    if (conflicts.Count == now.Count) return Results.Ok(new BulkResult(0, conflicts));
                }
                else overwrote = inWay.Count;
            }
            if ((await db.ChangeSetAsync(http, request.CollectionId, user, "change cell counts")).Problem is { } problem) return problem;
            var count = await MoveAsync(db, rows, request.GroupId);
            if (transaction is not null) await transaction.CommitAsync();
            return Results.Ok(new BulkResult(count, conflicts, overwrote));
        });
    }

    // In the database rather than through the tracker, which would read every
    // count's dots - they can be megabytes each. Only the ones that actually
    // moved are in the history.
    private static async Task<int> MoveAsync(AnnotationDbContext db, IQueryable<CellCount> rows, Guid? groupId)
    {
        await using var transaction = await HistoryLog.BeginAsync(db);
        var before = await rows.AsNoTracking().Select(c => new { c.Id, c.GroupId }).ToListAsync();
        var ids = before.Select(c => c.Id).ToList();
        await db.CellCounts.Where(c => ids.Contains(c.Id)).ExecuteUpdateAsync(s => s.SetProperty(c => c.GroupId, groupId));
        var history = before
            .Select(c => HistoryLog.Updated(db, HistoryLog.CellCount, c.Id, new Dictionary<string, (object?, object?)>
            {
                [nameof(CellCount.GroupId)] = (c.GroupId, groupId),
            }))
            .OfType<HistoryEntry>()
            .ToList();
        await HistoryLog.WriteAsync(db, history);
        if (transaction is not null) await transaction.CommitAsync();
        return before.Count;
    }

    private static IQueryable<CellCount> InCollection(AnnotationDbContext db, Guid collectionId, List<Guid> ids) =>
        db.CellCounts.Where(c => c.CollectionId == collectionId && ids.Contains(c.Id));

    // Just the one, given an id, or just these, given ids.
    internal static IQueryable<CountGroupView> Views(AnnotationDbContext db, Guid collectionId, Guid? id = null, List<Guid>? ids = null) =>
        db.CellCountGroups
            .Where(g => g.CollectionId == collectionId && (id == null || g.Id == id) && (ids == null || ids.Contains(g.Id)))
            .OrderBy(g => g.Name)
            .Select(g => new CountGroupView(g.Id, g.CollectionId, g.Name, g.Notes, g.Created, db.CellCounts.Count(c => c.GroupId == g.Id)));

    private static IResult? InvalidName(string? name) =>
        string.IsNullOrWhiteSpace(name) ? Results.BadRequest("A name is needed")
        : name.Trim().Length > AnnotationGroupEndpoints.MaxNameLength ? Results.BadRequest($"Names are up to {AnnotationGroupEndpoints.MaxNameLength} characters")
        : null;
}
