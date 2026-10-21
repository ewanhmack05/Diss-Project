using System.Security.Claims;
using AnnotationStore.Annotations;
using AnnotationStore.Auth;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using AnnotationStore.Paging;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.ChangeSets;

public record ChangeSetView(Guid Id, Guid CollectionId, string UserId, string UserName, string What, DateTimeOffset Created, int Deleted);

// How many of each came back. Collection is true when the change deleted
// the collection itself.
public record RestoreResult(int Annotations, int Groups, int CellCounts, int ImageAdjustments, bool Collection);

// What a restore answers - the counts, and the rows themselves as the reads
// give them (counts as the Saved list has them, without dots), so the viewer
// can show them and tell everyone else without loading them again.
public record RestoredView(
    RestoreResult Counts,
    List<Annotation> Annotations,
    List<GroupView> Groups,
    List<CellCountListItem> CellCounts,
    List<ImageAdjustments.ImageAdjustments> ImageAdjustments);

public static class ChangeSetEndpoints
{
    // Sent with a write to put it in a change set the client chose - the
    // viewer sends one id with every batch of a bulk delete. Left out, the
    // write gets a change set of its own. Either way the response has it.
    public const string Header = "Change-Set-Id";

    // The change set this write goes in - made now if it's new. Called after
    // the access check and validation, and before anything changes, so a
    // turned-down write doesn't leave one behind. A change set is one person
    // in one collection, so an id already used for someone else or another
    // collection is a 400.
    public static async Task<(ChangeSet? ChangeSet, IResult? Problem)> ChangeSetAsync(
        this AnnotationDbContext db, HttpContext http, Guid collectionId, ClaimsPrincipal user, string what)
    {
        var sent = http.Request.Headers[Header].ToString();
        var id = Guid.NewGuid();
        if (sent != "" && (!Guid.TryParse(sent, out id) || id == Guid.Empty))
            return (null, Results.BadRequest($"{Header} has to be a GUID"));

        var changeSet = await db.ChangeSets.FirstOrDefaultAsync(c => c.Id == id);
        if (changeSet is null)
        {
            changeSet = new ChangeSet
            {
                Id = id,
                CollectionId = collectionId,
                UserId = user.UserId(),
                UserName = user.DisplayName(),
                What = what,
                Created = DateTimeOffset.UtcNow,
            };
            db.ChangeSets.Add(changeSet);
            try
            {
                await db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // Batches of one change go out together, so another may have
                // made it a moment ago.
                db.Entry(changeSet).State = EntityState.Detached;
                changeSet = await db.ChangeSets.FirstOrDefaultAsync(c => c.Id == id);
                if (changeSet is null) throw;
            }
        }

        if (changeSet.CollectionId != collectionId || changeSet.UserId != user.UserId())
            return (null, Results.BadRequest($"That {Header} is already used for something else"));
        http.Response.Headers[Header] = id.ToString();
        return (changeSet, null);
    }

    public static void SoftDelete(this ISoftDeletable row, ChangeSet changeSet)
    {
        row.Deleted = DateTimeOffset.UtcNow;
        row.DeletedIn = changeSet.Id;
    }

    // Many at once, without loading them.
    public static Task<int> SoftDeleteAsync<T>(this IQueryable<T> rows, ChangeSet changeSet) where T : class, ISoftDeletable
    {
        var now = DateTimeOffset.UtcNow;
        return rows.ExecuteUpdateAsync(s => s
            .SetProperty(r => r.Deleted, now)
            .SetProperty(r => r.DeletedIn, changeSet.Id));
    }

    public static void MapChangeSetEndpoints(this WebApplication app)
    {
        // A collection's change sets, newest first, with how many rows each
        // one deleted that are still deleted. Anyone in it can read.
        app.MapGet("/changesets", async (Guid collectionId, int? skip, int? take, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (SavedPaging.Invalid(skip, take) is { } invalid) return invalid;
            if (await db.RequireAsync(collectionId, user, CollectionRole.Viewer) is { } denied) return denied;
            return Results.Ok(await db.ChangeSets
                .Where(c => c.CollectionId == collectionId)
                .OrderByDescending(c => c.Created).ThenByDescending(c => c.Id)
                .Skip(skip ?? 0)
                .Take(take ?? SavedPaging.MaxTake)
                .Select(c => new ChangeSetView(c.Id, c.CollectionId, c.UserId, c.UserName, c.What, c.Created,
                    db.Annotations.IgnoreQueryFilters().Count(a => a.DeletedIn == c.Id)
                    + db.AnnotationGroups.IgnoreQueryFilters().Count(g => g.DeletedIn == c.Id)
                    + db.CellCounts.IgnoreQueryFilters().Count(cc => cc.DeletedIn == c.Id)
                    + db.ImageAdjustments.IgnoreQueryFilters().Count(a => a.DeletedIn == c.Id)
                    + db.Collections.IgnoreQueryFilters().Count(col => col.DeletedIn == c.Id)))
                .ToListAsync());
        }).AllowGuests();

        // How many there are, for the History list's pager.
        app.MapGet("/changesets/total", async (Guid collectionId, ClaimsPrincipal user, AnnotationDbContext db) =>
            await db.RequireAsync(collectionId, user, CollectionRole.Viewer)
            ?? Results.Ok(await db.ChangeSets.CountAsync(c => c.CollectionId == collectionId))).AllowGuests();

        // Puts back everything a change set deleted - anyone's, so it's
        // rollback rather than undo, and any editor can do it (the viewer's
        // canRestore in collections/history/history.ts matches). Itself a
        // change, in a change set of its own. A deleted group comes back
        // empty: deleting it ungrouped its annotations, and which ones were
        // in it isn't kept until the history log.
        app.MapPost("/changesets/{id:guid}/restore", async (Guid id, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var deleting = await db.ChangeSets.FirstOrDefaultAsync(c => c.Id == id);
            if (deleting is null) return Results.NotFound();
            var collectionId = deleting.CollectionId;
            var collection = await db.Collections.IgnoreQueryFilters().FirstAsync(c => c.CollectionId == collectionId);

            var restoresCollection = collection.DeletedIn == id;
            if (restoresCollection)
            {
                // Nobody's role counts in a deleted collection, so it's the owner
                // or nobody - and a 404 for anyone else, same as any collection
                // they can't see.
                if (user.IsGuest() || collection.UserId != user.UserId()) return Results.NotFound();
                if (collection.Kind == CollectionKind.Personal && await db.Collections.AnyAsync(c =>
                        c.SlideId == collection.SlideId && c.UserId == collection.UserId && c.Kind == CollectionKind.Personal))
                    return Results.Conflict("You've a newer collection for this slide, so this one can't come back");
            }
            else if (await db.RequireAsync(collectionId, user, CollectionRole.Editor) is { } denied) return denied;

            var (restoring, problem) = await db.ChangeSetAsync(http, collectionId, user, "restore");
            if (problem is not null) return problem;

            await using var transaction = await db.Database.BeginTransactionAsync();
            if (restoresCollection)
            {
                collection.Deleted = null;
                collection.DeletedIn = null;
                await db.SaveChangesAsync();
            }
            // Read before they come back - after, nothing marks which ones they
            // were. Annotations and adjustments go back as they are; groups and
            // counts are read again after, for their member count and summary.
            var annotations = await DeletedIn(db.Annotations, collectionId, id).AsNoTracking().ToListAsync();
            var adjustments = await DeletedIn(db.ImageAdjustments, collectionId, id).AsNoTracking().ToListAsync();
            var groupIds = await DeletedIn(db.AnnotationGroups, collectionId, id).Select(g => g.Id).ToListAsync();
            var cellCountIds = await DeletedIn(db.CellCounts, collectionId, id).Select(c => c.Id).ToListAsync();
            var counts = new RestoreResult(
                await Restore(db.Annotations, collectionId, id),
                await Restore(db.AnnotationGroups, collectionId, id),
                await Restore(db.CellCounts, collectionId, id),
                await Restore(db.ImageAdjustments, collectionId, id),
                restoresCollection);
            var groups = await AnnotationGroupEndpoints.GroupViews(db, collectionId, ids: groupIds).ToListAsync();
            var cellCounts = await db.CellCounts
                .Where(c => cellCountIds.Contains(c.Id))
                .NewestFirst()
                .ListItemsAsync(db);
            await transaction.CommitAsync();
            return Results.Ok(new RestoredView(counts, annotations, groups, cellCounts, adjustments));
        });
    }

    private static IQueryable<T> DeletedIn<T>(IQueryable<T> rows, Guid collectionId, Guid changeSetId) where T : class, ISoftDeletable, IInCollection =>
        rows.IgnoreQueryFilters().Where(r => r.CollectionId == collectionId && r.DeletedIn == changeSetId);

    private static Task<int> Restore<T>(IQueryable<T> rows, Guid collectionId, Guid changeSetId) where T : class, ISoftDeletable, IInCollection =>
        DeletedIn(rows, collectionId, changeSetId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(r => r.Deleted, (DateTimeOffset?)null)
                .SetProperty(r => r.DeletedIn, (Guid?)null));
}

// Lets Restore filter any of them by collection.
public interface IInCollection
{
    Guid CollectionId { get; }
}
