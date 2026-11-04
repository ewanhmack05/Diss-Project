using System.Security.Claims;
using System.Text.Json;
using AnnotationStore.Annotations;
using AnnotationStore.Auth;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using AnnotationStore.Conflicts;
using AnnotationStore.Paging;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace AnnotationStore.History;

// One thing that happened to one row, and who did it. Op is create, update or
// delete. Changes is only there for an update - a delete's whole row copy is
// never sent, it can be megabytes of dots.
public record ItemVersion(long Id, Guid ChangeSetId, string UserId, string UserName, string What, DateTimeOffset Created, string Op, List<FieldChange> Changes);

// A page of one row's timeline, newest first. Latest is its newest entry, to
// send back with a restore. Groups names every group a GroupId in the page
// points at, gone ones included.
public record ItemTimeline(List<ItemVersion> Versions, int Total, long? Latest, Dictionary<Guid, string> Groups);

// What going back to a version would do, before it's done. Gone means the row
// is deleted now, so Changes is everything it'd come back as. GroupGone names
// the group it was in when that's gone since - it goes where that group went,
// or in none.
public record ItemPreview(bool Gone, List<FieldChange> Changes, Dictionary<Guid, string> Groups, string? GroupGone, long? Latest);

// How a row was after some entry, worked out from the entries since. Whole
// means Columns is every column, from a delete's copy. Absent means the entries
// say it didn't exist, so there's nothing to go back to.
public record WalkedBack(Dictionary<string, JsonElement> Columns, bool Whole, bool Absent);

// A timeline per annotation or cell count, and putting one back to any point
// on it. A change set's restore takes back one change and never touches a
// later edit. This is the other way round: it puts the row how it was at that
// point, undoing everything since, whoever did it - and it's a change of its
// own, so it can be gone back on as well.
public static class ItemHistory
{
    // What someone can change on a row. Everything else is fixed once saved,
    // so going back never needs to touch it. Snapshots.StateJsonAsync has the
    // same list.
    internal static readonly Dictionary<string, string[]> Changeable = new()
    {
        [HistoryLog.Annotation] = [nameof(Annotation.Label), nameof(Annotation.Notes), nameof(Annotation.Colour), nameof(Annotation.GroupId)],
        [HistoryLog.Group] = [nameof(AnnotationGroup.Name), nameof(AnnotationGroup.Notes)],
        [HistoryLog.CellCount] = [nameof(CellCount.Label), nameof(CellCount.Notes), nameof(CellCount.WithAnnotation), nameof(CellCount.WithRoi), nameof(CellCount.Count), nameof(CellCount.DotSize)],
    };

    // Newest entry first, undoing each: an update puts back its columns, a
    // delete brings the whole row back, and a create means it wasn't there.
    public static WalkedBack WalkBack(IEnumerable<HistoryEntry> newestFirst)
    {
        var columns = new Dictionary<string, JsonElement>();
        var whole = false;
        var absent = false;
        foreach (var entry in newestFirst)
        {
            switch (entry.Op)
            {
                case HistoryOp.Create:
                    columns.Clear();
                    whole = false;
                    absent = true;
                    break;
                case HistoryOp.Delete when entry.Before is not null:
                    columns.Clear();
                    Read(entry.Before, columns);
                    whole = true;
                    absent = false;
                    break;
                case HistoryOp.Update when entry.Before is not null:
                    Read(entry.Before, columns);
                    break;
            }
        }
        return new WalkedBack(columns, whole, absent);
    }

    private static void Read(string json, Dictionary<string, JsonElement> into)
    {
        using var document = JsonDocument.Parse(json);
        foreach (var column in document.RootElement.EnumerateObject()) into[column.Name] = column.Value.Clone();
    }

    public static void MapItemHistory(this WebApplication app)
    {
        foreach (var (path, entity, what) in new[]
        {
            ("annotations", HistoryLog.Annotation, "restore annotation"),
            ("cellcounts", HistoryLog.CellCount, "restore cell count"),
        })
        {
            // Anyone who can read the collection.
            app.MapGet($"/{path}/{{id:guid}}/history", async (Guid id, Guid collectionId, int? skip, int? take, ClaimsPrincipal user, AnnotationDbContext db) =>
            {
                if (SavedPaging.Invalid(skip, take) is { } invalid) return invalid;
                if (await db.RequireAsync(collectionId, user, CollectionRole.Viewer) is { } denied) return denied;
                return Results.Ok(await TimelineAsync(db, entity, id, collectionId, skip ?? 0, take ?? SavedPaging.MaxTake));
            }).AllowGuests();

            app.MapGet($"/{path}/{{id:guid}}/history/{{entryId:long}}", async (Guid id, long entryId, ClaimsPrincipal user, AnnotationDbContext db) =>
            {
                var version = await VersionAsync(db, entity, id, entryId);
                if (version is null) return Results.NotFound();
                if (await db.RequireAsync(version.CollectionId, user, CollectionRole.Viewer) is { } denied) return denied;
                var plan = await PlanAsync(db, version);
                if (plan is null) return NothingToGoBackTo();
                var groups = new Dictionary<Guid, string>();
                foreach (var change in plan.Changes.Where(c => c.Column == nameof(Annotation.GroupId)))
                    foreach (var group in new[] { change.Now as Guid?, change.Wanted as Guid? })
                        if (group is { } known) groups[known] = await ChangeSetChangesEndpoint.GroupNameAsync(db, known);
                var gone = plan.GroupWas is { } was ? await ChangeSetChangesEndpoint.GroupNameAsync(db, was) : null;
                return Results.Ok(new ItemPreview(plan.Live is null, plan.Changes.Select(c => c.AsFieldChange(entity, plan.Live is null)).ToList(),
                    groups, gone, await LatestAsync(db, version)));
            }).AllowGuests();

            // latest is the newest entry the person was looking at. If there's
            // a newer one they haven't seen it, so it's a 409 whatever the
            // session's edit policy - going back would undo it without them
            // knowing. Left out, it isn't checked.
            app.MapPost($"/{path}/{{id:guid}}/history/{{entryId:long}}/restore", async (Guid id, long entryId, long? latest, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
            {
                var version = await VersionAsync(db, entity, id, entryId);
                if (version is null) return Results.NotFound();
                if (await db.RequireAsync(version.CollectionId, user, CollectionRole.Editor) is { } denied) return denied;

                await using var transaction = await db.Database.BeginTransactionAsync();
                // Held until it's done, so no save can land between the check and this.
                if (entity == HistoryLog.Annotation) await EditConflicts.LockAnnotationsAsync(db, [id]);
                else await EditConflicts.LockCellCountAsync(db, id);
                if (latest is { } seen && await LatestAsync(db, version) != seen)
                    return Results.Conflict("It's changed since you opened it");

                var plan = await PlanAsync(db, version);
                if (plan is null) return NothingToGoBackTo();
                // Already how it was, so it isn't a change.
                if (plan.Changes.Count == 0 && plan.Live is not null) return Results.Ok(Answer(null, null, null, null));

                if ((await db.ChangeSetAsync(http, version.CollectionId, user, what)).Problem is { } problem) return problem;
                var bringingBack = plan.Live is null;
                foreach (var change in plan.Changes) plan.Row.Property(change.Column).CurrentValue = change.Wanted;
                if (bringingBack)
                {
                    plan.Row.State = EntityState.Added;
                    if (entity == HistoryLog.CellCount) await AddRegionBackAsync(db, id, plan.Entries);
                }
                try
                {
                    await db.SaveChangesAsync();
                }
                catch (DbUpdateException) when (bringingBack)
                {
                    // Two people bringing it back at once - there's no row to
                    // lock, so the second finds out from the primary key.
                    return Results.Conflict("It's changed since you opened it");
                }
                await transaction.CommitAsync();

                if (entity == HistoryLog.Annotation)
                {
                    var annotation = (Annotation)plan.Row.Entity;
                    return Results.Ok(bringingBack ? Answer(annotation, null, null, null) : Answer(null, annotation, null, null));
                }
                var count = (await db.CellCounts.Where(c => c.Id == id).NewestFirst().ListItemsAsync(db)).Single();
                return Results.Ok(bringingBack ? Answer(null, null, count, null) : Answer(null, null, null, count));
            });
        }
    }

    private static IResult NothingToGoBackTo() =>
        Results.Conflict("History doesn't say how it was then");

    private static RestoredView Answer(Annotation? annotation, Annotation? changed, CellCountListItem? count, CellCountListItem? changedCount) =>
        new(new RestoreResult(annotation is null ? 0 : 1, 0, count is null ? 0 : 1, 0, false),
            annotation is null ? [] : [annotation], [], count is null ? [] : [count], [],
            changed is null ? [] : [changed], changedCount is null ? [] : [changedCount]);

    private static Task<HistoryEntry?> VersionAsync(AnnotationDbContext db, string entity, Guid id, long entryId) =>
        db.HistoryEntries.AsNoTracking()
            .Where(e => e.Id == entryId && e.Entity == entity && e.EntityId == id)
            .Select(e => new HistoryEntry { Id = e.Id, CollectionId = e.CollectionId, Entity = e.Entity, EntityId = e.EntityId, Op = e.Op })
            .FirstOrDefaultAsync();

    private static IQueryable<HistoryEntry> Of(AnnotationDbContext db, Guid collectionId, string entity, Guid id) =>
        db.HistoryEntries.Where(e => e.CollectionId == collectionId && e.Entity == entity && e.EntityId == id);

    private static Task<long?> LatestAsync(AnnotationDbContext db, HistoryEntry version) =>
        Of(db, version.CollectionId, version.Entity, version.EntityId).MaxAsync(e => (long?)e.Id);

    private static async Task<ItemTimeline> TimelineAsync(AnnotationDbContext db, string entity, Guid id, Guid collectionId, int skip, int take)
    {
        var entries = Of(db, collectionId, entity, id);
        var rows = await entries
            .Join(db.ChangeSets, e => e.ChangeSetId, c => c.Id, (e, c) => new
            {
                e.Id,
                e.ChangeSetId,
                e.Op,
                Before = e.Op == HistoryOp.Update ? e.Before : null,
                After = e.Op == HistoryOp.Update ? e.After : null,
                c.UserId,
                c.UserName,
                c.What,
                c.Created,
            })
            .OrderByDescending(r => r.Id)
            .Skip(skip)
            .Take(take)
            .ToListAsync();

        var groups = new Dictionary<Guid, string>();
        var versions = new List<ItemVersion>();
        foreach (var row in rows)
        {
            var changes = Changes(entity, row.Before, row.After);
            foreach (var change in changes.Where(c => c.Column == nameof(Annotation.GroupId)))
                foreach (var value in new[] { change.Before, change.After })
                    if (value.ValueKind == JsonValueKind.String && value.GetGuid() is var group && !groups.ContainsKey(group))
                        groups[group] = await ChangeSetChangesEndpoint.GroupNameAsync(db, group);
            versions.Add(new ItemVersion(row.Id, row.ChangeSetId, row.UserId, row.UserName, row.What, row.Created, row.Op.ToString().ToLowerInvariant(), changes));
        }
        return new ItemTimeline(versions, await entries.CountAsync(), await entries.MaxAsync(e => (long?)e.Id), groups);
    }

    private static List<FieldChange> Changes(string entity, string? before, string? after)
    {
        if (before is null || after is null) return [];
        using var was = JsonDocument.Parse(before);
        using var now = JsonDocument.Parse(after);
        return now.RootElement.EnumerateObject()
            .Select(column => new FieldChange(entity, column.Name,
                was.RootElement.TryGetProperty(column.Name, out var b) ? b.Clone() : Empty, column.Value.Clone(), 1, []))
            .ToList();
    }

    private static readonly JsonElement Empty = JsonDocument.Parse("null").RootElement.Clone();

    private record Change(string Column, object? Now, object? Wanted)
    {
        // Coming back from deleted there's no now to go from.
        public FieldChange AsFieldChange(string entity, bool gone) =>
            new(entity, Column, gone ? Empty : JsonSerializer.SerializeToElement(Now), JsonSerializer.SerializeToElement(Wanted), 1, []);
    }

    private record Plan(object? Live, EntityEntry Row, List<Change> Changes, Guid? GroupWas, List<HistoryEntry> Entries);

    // What it'd take to put the row how it was. Going back to a delete means
    // how it was when it was deleted, so the delete's own copy is part of the
    // walk. Null if the entries don't say. Nothing's saved here - a row
    // rebuilt from history is only added if the caller adds it.
    private static async Task<Plan?> PlanAsync(AnnotationDbContext db, HistoryEntry version)
    {
        var since = await Of(db, version.CollectionId, version.Entity, version.EntityId)
            .AsNoTracking()
            .Where(e => e.Id > version.Id || (e.Id == version.Id && e.Op == HistoryOp.Delete))
            .OrderByDescending(e => e.Id)
            .ToListAsync();
        var walked = WalkBack(since);
        if (walked.Absent) return null;

        object? live = version.Entity == HistoryLog.Annotation
            ? await db.Annotations.FindAsync(version.EntityId)
            : await db.CellCounts.FindAsync(version.EntityId);
        if (live is null && !walked.Whole) return null;

        var row = db.Entry(live ?? Rebuild(db, version.Entity, walked.Columns));
        var changes = new List<Change>();
        Guid? groupWas = null;
        foreach (var column in Changeable[version.Entity])
        {
            if (!walked.Columns.TryGetValue(column, out var value)) continue;
            var wanted = HistoryLog.ValueOf(value, row.Property(column).Metadata.ClrType);
            if (column == nameof(Annotation.GroupId))
            {
                var now = await ChangeSetEndpoints.GroupNowAsync(db, (Guid?)wanted);
                if (now != (Guid?)wanted) groupWas = (Guid?)wanted;
                wanted = now;
            }
            var current = live is null ? null : row.Property(column).CurrentValue;
            if (live is null || !Equals(current, wanted)) changes.Add(new Change(column, current, wanted));
        }
        return new Plan(live, row, changes, groupWas, since);
    }

    private static object Rebuild(AnnotationDbContext db, string entity, Dictionary<string, JsonElement> columns)
    {
        var json = JsonSerializer.Serialize(columns);
        return entity == HistoryLog.Annotation
            ? HistoryLog.Rebuild<Annotation>(db, json)
            : HistoryLog.Rebuild<CellCount>(db, json);
    }

    // A count's region of interest goes with it, so it comes back from the
    // change set the count's delete was in.
    private static async Task AddRegionBackAsync(AnnotationDbContext db, Guid countId, List<HistoryEntry> since)
    {
        var delete = since.FirstOrDefault(e => e.Op == HistoryOp.Delete);
        if (delete is null) return;
        var regions = await db.HistoryEntries.AsNoTracking()
            .Where(e => e.ChangeSetId == delete.ChangeSetId && e.Entity == HistoryLog.RegionOfInterest && e.Op == HistoryOp.Delete)
            .ToListAsync();
        foreach (var entry in regions)
        {
            var region = HistoryLog.Rebuild<RegionOfInterest>(db, entry.Before!);
            if (region.CellCountId == countId && await db.RegionsOfInterest.FindAsync(region.Id) is null)
                db.RegionsOfInterest.Add(region);
        }
    }
}
