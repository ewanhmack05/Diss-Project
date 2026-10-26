using System.Security.Claims;
using System.Text.Json;
using AnnotationStore.Annotations;
using AnnotationStore.Auth;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using AnnotationStore.Paging;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;

namespace AnnotationStore.History;

public record ChangeSetView(Guid Id, Guid CollectionId, string UserId, string UserName, string What, DateTimeOffset Created, int Deleted);

// How many of each came back. Collection is true when the change deleted
// the collection itself.
public record RestoreResult(int Annotations, int Groups, int CellCounts, int ImageAdjustments, bool Collection);

// What a restore answers - the counts, and the rows themselves as the reads
// give them (counts as the Saved list has them, without dots), so the viewer
// can show them and tell everyone else without loading them again.
// ChangedAnnotations were already there and went back how they were - put
// back in the group a delete or merge took them out of.
public record RestoredView(
    RestoreResult Counts,
    List<Annotation> Annotations,
    List<GroupView> Groups,
    List<CellCountListItem> CellCounts,
    List<ImageAdjustments.ImageAdjustments> ImageAdjustments,
    List<Annotation> ChangedAnnotations);

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
        db.CurrentChangeSet = changeSet;
        return (changeSet, null);
    }

    public static void MapChangeSetEndpoints(this WebApplication app)
    {
        // A collection's change sets, newest first, with how many rows each
        // one deleted that still aren't back - and haven't been put back and
        // deleted again by something later, which makes them that one's. A
        // region of interest goes with its count, so isn't counted on its own.
        // Anyone in it can read.
        // Narrowed by createdBy, kind, from and to (see ChangeSetFilter), and
        // oldest first with order=oldest.
        app.MapGet("/changesets", async (Guid collectionId, int? skip, int? take, string? order, [AsParameters] ChangeSetFilter filter,
            ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if ((SavedPaging.Invalid(skip, take) ?? ChangeKinds.Invalid(filter)) is { } invalid) return invalid;
            if (order is not (null or "newest" or "oldest")) return Results.BadRequest("order is newest or oldest");
            if (await db.RequireAsync(collectionId, user, CollectionRole.Viewer) is { } denied) return denied;
            var matching = db.ChangeSets.Where(c => c.CollectionId == collectionId).Filtered(filter);
            var ordered = order == "oldest"
                ? matching.OrderBy(c => c.Created).ThenBy(c => c.Id)
                : matching.OrderByDescending(c => c.Created).ThenByDescending(c => c.Id);
            return Results.Ok(await ordered
                .Skip(skip ?? 0)
                .Take(take ?? SavedPaging.MaxTake)
                .Select(c => new ChangeSetView(c.Id, c.CollectionId, c.UserId, c.UserName, c.What, c.Created,
                    db.HistoryEntries.Count(e => e.ChangeSetId == c.Id && e.Op == HistoryOp.Delete
                        // Not if it's been put back or deleted again since - then
                        // it's that later change's.
                        && !db.HistoryEntries.Any(l => l.CollectionId == e.CollectionId && l.Entity == e.Entity
                            && l.EntityId == e.EntityId && l.Id > e.Id && l.Op != HistoryOp.Update) && (
                        (e.Entity == HistoryLog.Annotation && !db.Annotations.Any(x => x.Id == e.EntityId))
                        || (e.Entity == HistoryLog.Group && !db.AnnotationGroups.Any(x => x.Id == e.EntityId))
                        || (e.Entity == HistoryLog.CellCount && !db.CellCounts.Any(x => x.Id == e.EntityId))
                        || (e.Entity == HistoryLog.ImageAdjustment && !db.ImageAdjustments.Any(x => x.ImageAdjustmentId == e.EntityId))
                        || (e.Entity == HistoryLog.Collection && db.Collections.IgnoreQueryFilters()
                            .Any(x => x.CollectionId == e.EntityId && x.Deleted != null))))))
                .ToListAsync());
        }).AllowGuests();

        app.MapChangeSetChanges();

        // How many there are, for the History list's pager - with the same
        // filters as the list.
        app.MapGet("/changesets/total", async (Guid collectionId, [AsParameters] ChangeSetFilter filter, ClaimsPrincipal user, AnnotationDbContext db) =>
            ChangeKinds.Invalid(filter)
            ?? await db.RequireAsync(collectionId, user, CollectionRole.Viewer)
            ?? Results.Ok(await db.ChangeSets.Where(c => c.CollectionId == collectionId).Filtered(filter).CountAsync())).AllowGuests();

        // Who's made changes and how many of each kind, for the History
        // list's filter popout.
        app.MapGet("/changesets/facets", async (Guid collectionId, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(collectionId, user, CollectionRole.Viewer) is { } denied) return denied;
            var inCollection = db.ChangeSets.Where(c => c.CollectionId == collectionId);
            var authors = await inCollection
                .GroupBy(c => new { c.UserId, c.UserName })
                .Select(g => new SavedAuthor(g.Key.UserId, g.Key.UserName, g.Count()))
                .ToListAsync();
            var whats = await inCollection.GroupBy(c => c.What).Select(g => new { What = g.Key, Count = g.Count() }).ToListAsync();
            var kinds = whats
                .GroupBy(w => ChangeKinds.Of(w.What))
                .Select(g => new KindCount(g.Key, g.Sum(w => w.Count)))
                .OrderBy(k => Array.IndexOf(ChangeKinds.All, k.Kind))
                .ToList();
            return Results.Ok(new ChangeSetFacets(SavedPaging.Authors(authors), kinds));
        }).AllowGuests();

        // Puts it back how it was before the change: every row it deleted
        // comes back, and every column it changed on a row that's still here
        // goes back - but only where nobody's changed it again since. So a
        // deleted group comes back with what was in it, and a later edit is
        // never undone. Anyone's change, so it's rollback rather than undo,
        // and any editor can do it (the viewer's canRestore in
        // collections/history/history.ts matches). Itself a change, in a
        // change set of its own. One transaction, so it all comes back or
        // none of it does.
        app.MapPost("/changesets/{id:guid}/restore", async (Guid id, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var undoing = await db.ChangeSets.FirstOrDefaultAsync(c => c.Id == id);
            if (undoing is null) return Results.NotFound();
            var collectionId = undoing.CollectionId;
            var collection = await db.Collections.IgnoreQueryFilters().FirstAsync(c => c.CollectionId == collectionId);
            // On Postgres a deleted annotation is rebuilt in the database, so its
            // copy - 20,000 of them can be 60MB of GeoJSON - isn't read here.
            var rebuiltThere = HistoryLog.IsPostgres(db);
            var entries = await db.HistoryEntries.AsNoTracking()
                .Where(e => e.ChangeSetId == id)
                .OrderByDescending(e => e.Id)
                .Select(e => new HistoryEntry
                {
                    Id = e.Id,
                    ChangeSetId = e.ChangeSetId,
                    CollectionId = e.CollectionId,
                    Entity = e.Entity,
                    EntityId = e.EntityId,
                    Op = e.Op,
                    Before = rebuiltThere && e.Entity == HistoryLog.Annotation && e.Op == HistoryOp.Delete ? null : e.Before,
                    After = e.After,
                })
                .ToListAsync();

            var restoresCollection = collection.Deleted is not null
                && entries.Any(e => e.Entity == HistoryLog.Collection && e.Op == HistoryOp.Delete);
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

            if ((await db.ChangeSetAsync(http, collectionId, user, "restore")).Problem is { } problem) return problem;
            await using var transaction = await db.Database.BeginTransactionAsync();
            var history = new List<HistoryEntry>();
            if (restoresCollection)
            {
                collection.Deleted = null;
                history.Add(HistoryLog.CollectionRestored(db, collectionId));
            }
            var back = await PutBackAsync(db, id, entries, history);
            await db.SaveChangesAsync();
            await HistoryLog.WriteAsync(db, history);
            await transaction.CommitAsync();

            var annotations = await db.Annotations.AsNoTracking().Where(a => back.Annotations.Contains(a.Id)).ToListAsync();
            var changed = await db.Annotations.AsNoTracking().Where(a => back.ChangedAnnotations.Contains(a.Id)).ToListAsync();
            var groups = await AnnotationGroupEndpoints.GroupViews(db, collectionId, ids: back.Groups).ToListAsync();
            var cellCounts = await db.CellCounts
                .Where(c => back.CellCounts.Contains(c.Id))
                .NewestFirst()
                .ListItemsAsync(db);
            var counts = new RestoreResult(annotations.Count, back.Groups.Count, back.CellCounts.Count, back.ImageAdjustments.Count, restoresCollection);
            return Results.Ok(new RestoredView(counts, annotations, groups, cellCounts, back.ImageAdjustments, changed));
        });
    }

    private record PutBack(
        List<Guid> Annotations,
        List<Guid> Groups,
        List<Guid> CellCounts,
        List<ImageAdjustments.ImageAdjustments> ImageAdjustments,
        List<Guid> ChangedAnnotations);

    // Newest entry first, so a row changed twice in one change goes back to
    // how it was before the first. Annotations - which can be 20,000 - go
    // back in bulk, with their history added to history; everything else is
    // added to the context, and the caller's save writes its history.
    private static async Task<PutBack> PutBackAsync(AnnotationDbContext db, Guid changeSetId, List<HistoryEntry> entries, List<HistoryEntry> history)
    {
        var back = new PutBack([], [], [], [], []);
        // A row put back and deleted again since belongs to that later delete -
        // bringing it back here would undo it.
        var later = (await db.HistoryEntries
            .Where(e => e.ChangeSetId == changeSetId && e.Op == HistoryOp.Delete && db.HistoryEntries.Any(l =>
                l.CollectionId == e.CollectionId && l.Entity == e.Entity && l.EntityId == e.EntityId && l.Id > e.Id && l.Op != HistoryOp.Update))
            .Select(e => e.Id)
            .ToListAsync()).ToHashSet();
        var deletes = entries
            .Where(e => !later.Contains(e.Id))
            .Where(e => e.Op == HistoryOp.Delete && (e.Before is not null || e.Entity == HistoryLog.Annotation))
            .GroupBy(e => (e.Entity, e.EntityId)).Select(g => g.First())
            .ToList();
        List<HistoryEntry> Deleted(string entity) => deletes.Where(e => e.Entity == entity).ToList();

        // Groups first, and saved, so annotations coming back can go in them.
        var groups = Deleted(HistoryLog.Group);
        var groupIds = groups.Select(e => e.EntityId).ToList();
        var liveGroups = await db.AnnotationGroups.Where(g => groupIds.Contains(g.Id)).Select(g => g.Id).ToListAsync();
        foreach (var entry in groups.Where(e => !liveGroups.Contains(e.EntityId)))
        {
            db.AnnotationGroups.Add(HistoryLog.Rebuild<AnnotationGroup>(db, entry.Before!));
            back.Groups.Add(entry.EntityId);
        }
        await db.SaveChangesAsync();

        await PutBackAnnotationsAsync(db, changeSetId, Deleted(HistoryLog.Annotation), back, history);

        var counts = Deleted(HistoryLog.CellCount);
        var countIds = counts.Select(e => e.EntityId).ToList();
        var liveCounts = await db.CellCounts.Where(c => countIds.Contains(c.Id)).Select(c => c.Id).ToListAsync();
        foreach (var entry in counts.Where(e => !liveCounts.Contains(e.EntityId)))
        {
            db.CellCounts.Add(HistoryLog.Rebuild<CellCount>(db, entry.Before!));
            back.CellCounts.Add(entry.EntityId);
        }
        // Only with its count - one that's still gone has nothing to go on.
        foreach (var entry in Deleted(HistoryLog.RegionOfInterest))
        {
            var region = HistoryLog.Rebuild<RegionOfInterest>(db, entry.Before!);
            if (back.CellCounts.Contains(region.CellCountId) && await db.RegionsOfInterest.FindAsync(entry.EntityId) is null)
                db.RegionsOfInterest.Add(region);
        }
        var adjustments = Deleted(HistoryLog.ImageAdjustment);
        var adjustmentIds = adjustments.Select(e => e.EntityId).ToList();
        var liveAdjustments = await db.ImageAdjustments.Where(a => adjustmentIds.Contains(a.ImageAdjustmentId)).Select(a => a.ImageAdjustmentId).ToListAsync();
        foreach (var entry in adjustments.Where(e => !liveAdjustments.Contains(e.EntityId)))
        {
            var adjustment = HistoryLog.Rebuild<ImageAdjustments.ImageAdjustments>(db, entry.Before!);
            db.ImageAdjustments.Add(adjustment);
            back.ImageAdjustments.Add(adjustment);
        }

        await RevertAnnotationsAsync(db, entries.Where(e => e.Op == HistoryOp.Update && e.Entity == HistoryLog.Annotation).ToList(), back, history);

        // Anything else it changed - names, notes, a count's details - is a
        // handful of rows, so through the tracker.
        foreach (var entry in entries.Where(e => e.Op == HistoryOp.Update && e.Entity != HistoryLog.Annotation))
        {
            object? live = entry.Entity switch
            {
                HistoryLog.Group => await db.AnnotationGroups.FindAsync(entry.EntityId),
                HistoryLog.CellCount => await db.CellCounts.FindAsync(entry.EntityId),
                HistoryLog.ImageAdjustment => await db.ImageAdjustments.FindAsync(entry.EntityId),
                _ => null,
            };
            if (live is not null) HistoryLog.Revert(db.Entry(live), entry);
        }
        return back;
    }

    // Deleted annotations that aren't back yet, back in the group they were
    // in - or where that group went.
    private static async Task PutBackAnnotationsAsync(AnnotationDbContext db, Guid changeSetId, List<HistoryEntry> deletes, PutBack back, List<HistoryEntry> history)
    {
        if (deletes.Count == 0) return;
        if (HistoryLog.IsPostgres(db))
        {
            var groupNow = new Dictionary<Guid, Guid?>();
            var wasIn = await db.Database.SqlQueryRaw<Guid>("""
                SELECT DISTINCT ("Before" ->> 'GroupId')::uuid AS "Value" FROM history."Entries"
                WHERE "ChangeSetId" = {0} AND "Entity" = 'annotation' AND "Op" = 'Delete' AND "Before" ->> 'GroupId' IS NOT NULL
                """, changeSetId).ToListAsync();
            foreach (var group in wasIn) groupNow[group] = await GroupNowAsync(db, group);

            // Straight from the entries, in the database - no 20,000 rows of
            // GeoJSON through here and back.
            var connection = (NpgsqlConnection)db.Database.GetDbConnection();
            await using var command = connection.CreateCommand();
            command.Transaction = (NpgsqlTransaction)db.Database.CurrentTransaction!.GetDbTransaction();
            // Only the ones that aren't back already. A change deletes a row
            // once, so there's one entry for each. Two people putting the same
            // change back at once both get past NOT EXISTS - ON CONFLICT lets
            // the second find nothing left to add.
            command.CommandText = """
                INSERT INTO "Annotations"
                SELECT (jsonb_populate_record(NULL::"Annotations", e."Before" || jsonb_build_object('GroupId', g.now))).*
                FROM history."Entries" e
                LEFT JOIN unnest(@was, @now) AS g(was, now) ON g.was = (e."Before" ->> 'GroupId')::uuid
                WHERE e."ChangeSetId" = @changeSet AND e."Entity" = 'annotation' AND e."Op" = 'Delete'
                  AND NOT EXISTS (SELECT 1 FROM "Annotations" a WHERE a."Id" = e."EntityId")
                  AND NOT EXISTS (SELECT 1 FROM history."Entries" l
                      WHERE l."CollectionId" = e."CollectionId" AND l."Entity" = e."Entity" AND l."EntityId" = e."EntityId"
                        AND l."Id" > e."Id" AND l."Op" <> 'Update')
                ON CONFLICT ("Id") DO NOTHING
                RETURNING "Id"
                """;
            command.Parameters.Add(new NpgsqlParameter("changeSet", NpgsqlDbType.Uuid) { Value = changeSetId });
            command.Parameters.Add(new NpgsqlParameter("was", NpgsqlDbType.Array | NpgsqlDbType.Uuid) { Value = groupNow.Keys.ToArray() });
            command.Parameters.Add(new NpgsqlParameter("now", NpgsqlDbType.Array | NpgsqlDbType.Uuid) { Value = groupNow.Values.Select(v => v is { } g ? (object)g : DBNull.Value).ToArray() });
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync()) back.Annotations.Add(reader.GetGuid(0));
            history.AddRange(back.Annotations.Select(a => HistoryLog.Created(db, HistoryLog.Annotation, a)));
            return;
        }

        var ids = deletes.Select(e => e.EntityId).ToList();
        var live = (await db.Annotations.Where(a => ids.Contains(a.Id)).Select(a => a.Id).ToListAsync()).ToHashSet();
        foreach (var entry in deletes.Where(e => !live.Contains(e.EntityId)))
        {
            var annotation = HistoryLog.Rebuild<Annotation>(db, entry.Before!);
            annotation.GroupId = await GroupNowAsync(db, annotation.GroupId);
            db.Annotations.Add(annotation);
            back.Annotations.Add(annotation.Id);
        }
        await db.SaveChangesAsync();
    }

    // Columns a change took annotations off, put back - in a few statements,
    // one for each set of values going back, rather than one per row.
    private static async Task RevertAnnotationsAsync(AnnotationDbContext db, List<HistoryEntry> updates, PutBack back, List<HistoryEntry> history)
    {
        if (updates.Count == 0) return;
        var ids = updates.Select(e => e.EntityId).Distinct().ToList();
        var now = (await db.Annotations.AsNoTracking().Where(a => ids.Contains(a.Id))
                .Select(a => new { a.Id, a.Label, a.Notes, a.Colour, a.GroupId }).ToListAsync())
            .ToDictionary(a => a.Id, a => new Dictionary<string, object?>
            {
                [nameof(Annotation.Label)] = a.Label,
                [nameof(Annotation.Notes)] = a.Notes,
                [nameof(Annotation.Colour)] = a.Colour,
                [nameof(Annotation.GroupId)] = a.GroupId,
            });
        var was = now.ToDictionary(a => a.Key, a => new Dictionary<string, object?>(a.Value));
        Type TypeOf(string column) => column == nameof(Annotation.GroupId) ? typeof(Guid?) : typeof(string);

        foreach (var entry in updates)
        {
            if (!now.TryGetValue(entry.EntityId, out var columns)) continue;
            foreach (var (column, value) in HistoryLog.Reverted(entry, c => columns.GetValueOrDefault(c), TypeOf))
                columns[column] = column == nameof(Annotation.GroupId) && value is Guid group ? await GroupNowAsync(db, group) : value;
        }

        var changes = now
            .Select(a => (Id: a.Key, Changes: a.Value.Where(c => !Equals(c.Value, was[a.Key][c.Key])).ToDictionary(c => c.Key, c => c.Value)))
            .Where(a => a.Changes.Count > 0)
            .ToList();
        foreach (var batch in changes.GroupBy(a => string.Join("|", a.Changes.OrderBy(c => c.Key).Select(c => $"{c.Key}={c.Value}"))))
        {
            var rows = batch.Select(a => a.Id).ToList();
            var set = batch.First().Changes;
            await db.Annotations.Where(a => rows.Contains(a.Id)).ExecuteUpdateAsync(s =>
            {
                foreach (var (column, value) in set)
                    if (column == nameof(Annotation.GroupId)) s.SetProperty(a => a.GroupId, (Guid?)value);
                    else s.SetProperty(a => EF.Property<string>(a, column), (string)value!);
            });
        }
        foreach (var (id, set) in changes)
        {
            history.Add(HistoryLog.Updated(db, HistoryLog.Annotation, id,
                set.ToDictionary(c => c.Key, c => (was[id][c.Key], c.Value)))!);
            if (!back.Annotations.Contains(id)) back.ChangedAnnotations.Add(id);
        }
    }

    // Where an annotation's group is now: the same one if it's still here,
    // the one it was merged into if it was merged (and so on, if that was
    // merged too), otherwise none.
    private static async Task<Guid?> GroupNowAsync(AnnotationDbContext db, Guid? groupId)
    {
        for (var hops = 0; groupId is { } id && hops < 20; hops++)
        {
            if (db.AnnotationGroups.Local.Any(g => g.Id == id) || await db.AnnotationGroups.AnyAsync(g => g.Id == id)) return id;
            var deleted = await db.HistoryEntries
                .Where(e => e.Entity == HistoryLog.Group && e.EntityId == id && e.Op == HistoryOp.Delete)
                .OrderByDescending(e => e.Id)
                .FirstOrDefaultAsync();
            groupId = deleted is null ? null : HistoryLog.MergedInto(deleted);
        }
        return null;
    }
}
