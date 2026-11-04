using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Security.Claims;
using System.Text.Json;
using AnnotationStore.Annotations;
using AnnotationStore.Auth;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;

namespace AnnotationStore.History;

// What a row's like: column to value. Only what can change.
using RowState = Dictionary<string, JsonElement>;

// How many of one kind of row going back brings back, changes and takes out.
public record RollbackCounts(int Back, int Changed, int Gone);

// Latest is the collection's newest entry, to send back with the rollback.
// EntriesWalked and FromSnapshot say what it took to work out.
public record RollbackView(RollbackCounts Annotations, RollbackCounts Groups, RollbackCounts CellCounts, long? Latest, int EntriesWalked, bool FromSnapshot);

// The whole collection back to how it was just after a change: rows added since
// are taken out, rows deleted since come back, and everything else goes back to
// how it was, whoever changed it. A change of its own, so it can be gone back on
// from the change before it. Image adjustments stay as they are - they're one
// person's own presets, not the work being versioned.
//
// How it was is worked out backwards, like ItemHistory: start from a state
// that's known, and undo each entry between there and the point. It can't go
// forwards from an earlier snapshot, since a create's entry has nothing in it.
// So it starts at the nearest snapshot at or after the point, or from what's
// there now if there isn't one, and never undoes more than what's since then.
public static class CollectionRollback
{
    private static readonly Meter Meter = new(Snapshots.MeterName);
    private static readonly Histogram<double> Durations = Meter.CreateHistogram<double>(
        "annotation_store.rollback_duration", unit: "ms", description: "How long putting a whole collection back took");
    private static readonly Histogram<long> Walked = Meter.CreateHistogram<long>(
        "annotation_store.rollback_entries", description: "How many entries working out a rollback had to undo");

    public record Plan(
        Dictionary<(string Entity, Guid Id), RowState> Add,
        Dictionary<(string Entity, Guid Id), RowState> Change,
        List<(string Entity, Guid Id)> Remove,
        int EntriesWalked,
        bool FromSnapshot);

    // One entry as far as working back goes - Before without what can't change.
    private record EntryRow(string Entity, Guid EntityId, string Op, string? Before);

    // Reads a state as Snapshots.StateJsonAsync writes it.
    public static Dictionary<(string Entity, Guid Id), RowState> ParseState(string json)
    {
        var state = new Dictionary<(string, Guid), RowState>();
        using var document = JsonDocument.Parse(json);
        foreach (var entity in document.RootElement.EnumerateObject())
            foreach (var row in entity.Value.EnumerateObject())
                state[(entity.Name, Guid.Parse(row.Name))] = row.Value.EnumerateObject().ToDictionary(c => c.Name, c => c.Value.Clone());
        return state;
    }

    // Undoes entries, newest first, on a state. An update puts back its
    // columns, a delete brings the row back and a create takes it out. Only
    // annotations, groups and counts are in a state.
    public static void WalkBack(Dictionary<(string Entity, Guid Id), RowState> state, IEnumerable<(string Entity, Guid Id, HistoryOp Op, string? Before)> newestFirst)
    {
        foreach (var (entity, id, op, before) in newestFirst)
        {
            if (!ItemHistory.Changeable.TryGetValue(entity, out var columns)) continue;
            switch (op)
            {
                case HistoryOp.Create:
                    state.Remove((entity, id));
                    break;
                case HistoryOp.Delete when before is not null:
                    state[(entity, id)] = Columns(before, columns);
                    break;
                case HistoryOp.Update when before is not null && state.TryGetValue((entity, id), out var row):
                    foreach (var (name, value) in Columns(before, columns)) row[name] = value;
                    break;
            }
        }
    }

    private static RowState Columns(string json, string[] columns)
    {
        using var document = JsonDocument.Parse(json);
        var found = new RowState();
        foreach (var column in document.RootElement.EnumerateObject())
            if (columns.Contains(column.Name)) found[column.Name] = column.Value.Clone();
        return found;
    }

    // What it takes to get from now to just after point. useSnapshots is for
    // comparing the two ways - they have to land on the same answer.
    public static async Task<Plan> PlanAsync(AnnotationDbContext db, Guid collectionId, long point, bool useSnapshots = true)
    {
        var snapshot = !useSnapshots ? null : await db.Snapshots.AsNoTracking()
            .Where(s => s.CollectionId == collectionId && s.UpToEntry >= point)
            .OrderBy(s => s.UpToEntry)
            .FirstOrDefaultAsync();
        var nowJson = await Snapshots.StateJsonAsync(db, collectionId);
        var now = ParseState(nowJson);
        var target = ParseState(snapshot?.Rows ?? nowJson);

        var entries = await EntriesAsync(db, collectionId, point, snapshot?.UpToEntry);
        WalkBack(target, entries.Select(e => (e.Entity, e.EntityId, Enum.Parse<HistoryOp>(e.Op), e.Before)));

        // A group that isn't there at the point can't hold anything. Going
        // back through history it always is - this is for older rows that only
        // have part of their story recorded.
        foreach (var ((entity, _), row) in target)
            if (entity == HistoryLog.Annotation && row.TryGetValue(nameof(Annotation.GroupId), out var group)
                && group.ValueKind == JsonValueKind.String && !target.ContainsKey((HistoryLog.Group, group.GetGuid())))
                row[nameof(Annotation.GroupId)] = JsonSerializer.SerializeToElement<Guid?>(null);

        var add = new Dictionary<(string, Guid), RowState>();
        var change = new Dictionary<(string, Guid), RowState>();
        foreach (var (key, row) in target)
        {
            if (!now.TryGetValue(key, out var current))
            {
                add[key] = row;
                continue;
            }
            var different = row.Where(c => !current.TryGetValue(c.Key, out var value) || !JsonElement.DeepEquals(value, c.Value))
                .ToDictionary(c => c.Key, c => c.Value);
            if (different.Count > 0) change[key] = different;
        }
        var remove = now.Keys.Where(key => !target.ContainsKey(key)).ToList();
        return new Plan(add, change, remove, entries.Count, snapshot is not null);
    }

    // On Postgres the shapes and dots are left out in the database - a delete's
    // copy can be megabytes.
    private static Task<List<EntryRow>> EntriesAsync(AnnotationDbContext db, Guid collectionId, long point, long? upTo)
    {
        var postgres = HistoryLog.IsPostgres(db);
        var before = postgres ? """("Before" - 'GeoJson' - 'Dots' - 'ColourCountsJson' - 'PlacedByCountsJson')::text""" : "\"Before\"";
        var table = postgres ? "history.\"Entries\"" : "\"Entries\"";
        return db.Database.SqlQueryRaw<EntryRow>($$"""
            SELECT "Entity", "EntityId", "Op", {{before}} AS "Before" FROM {{table}}
            WHERE "CollectionId" = {0} AND "Id" > {1} AND "Id" <= {2}
            ORDER BY "Id" DESC
            """, collectionId, point, upTo ?? long.MaxValue).ToListAsync();
    }

    private static RollbackView View(Plan plan, long? latest)
    {
        RollbackCounts Counts(string entity) => new(
            plan.Add.Keys.Count(k => k.Entity == entity),
            plan.Change.Keys.Count(k => k.Entity == entity),
            plan.Remove.Count(k => k.Entity == entity));
        return new RollbackView(Counts(HistoryLog.Annotation), Counts(HistoryLog.Group), Counts(HistoryLog.CellCount), latest, plan.EntriesWalked, plan.FromSnapshot);
    }

    private static Task<long?> LatestAsync(AnnotationDbContext db, Guid collectionId) =>
        db.HistoryEntries.Where(e => e.CollectionId == collectionId).MaxAsync(e => (long?)e.Id);

    // The point a change set stands for: its last entry.
    private static Task<long?> PointAsync(AnnotationDbContext db, Guid changeSetId) =>
        db.HistoryEntries.Where(e => e.ChangeSetId == changeSetId).MaxAsync(e => (long?)e.Id);

    public static void MapCollectionRollback(this WebApplication app)
    {
        // What it would do, changing nothing. Anyone in it can look. snapshots=false
        // works it out from what's there now even if there's a snapshot to start
        // from, for timing the two against each other (scripts/time_rollback.py).
        app.MapGet("/changesets/{id:guid}/rollback", async (Guid id, bool? snapshots, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var changeSet = await db.ChangeSets.FirstOrDefaultAsync(c => c.Id == id);
            if (changeSet is null) return Results.NotFound();
            if (await db.RequireAsync(changeSet.CollectionId, user, CollectionRole.Viewer) is { } denied) return denied;
            if (await PointAsync(db, id) is not { } point) return Results.Conflict("Nothing was recorded for this change");
            return Results.Ok(View(await PlanAsync(db, changeSet.CollectionId, point, snapshots ?? true), await LatestAsync(db, changeSet.CollectionId)));
        }).AllowGuests();

        // Any editor, the same as putting a change back. latest is the newest
        // entry the person saw - if there's a newer one it's a 409, since this
        // would undo it without them knowing. Left out, it isn't checked.
        app.MapPost("/changesets/{id:guid}/rollback", async (Guid id, long? latest, HttpContext http, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var changeSet = await db.ChangeSets.FirstOrDefaultAsync(c => c.Id == id);
            if (changeSet is null) return Results.NotFound();
            var collectionId = changeSet.CollectionId;
            if (await db.RequireAsync(collectionId, user, CollectionRole.Editor) is { } denied) return denied;
            if (await PointAsync(db, id) is not { } point) return Results.Conflict("Nothing was recorded for this change");

            var timer = Stopwatch.StartNew();
            await using var transaction = await db.Database.BeginTransactionAsync();
            // Waits for anything that's part way through, and any new change
            // waits for this - every change set and row points at the
            // collection, and adding one needs this row left alone.
            if (HistoryLog.IsPostgres(db))
                await db.Database.ExecuteSqlAsync($"""SELECT 1 FROM "Collections" WHERE "CollectionId" = {collectionId} FOR UPDATE""");
            if (latest is { } seen && await LatestAsync(db, collectionId) != seen)
                return Results.Conflict("It's changed since you opened it");

            var plan = await PlanAsync(db, collectionId, point);
            // Already how it was, so it isn't a change.
            if (plan.Add.Count + plan.Change.Count + plan.Remove.Count == 0)
                return Results.Ok(View(plan, await LatestAsync(db, collectionId)));

            if ((await db.ChangeSetAsync(http, collectionId, user, "restore collection")).Problem is { } problem) return problem;
            await ApplyAsync(db, collectionId, plan);
            var now = await LatestAsync(db, collectionId);
            await transaction.CommitAsync();

            var fromSnapshot = new KeyValuePair<string, object?>("from_snapshot", plan.FromSnapshot);
            Durations.Record(timer.Elapsed.TotalMilliseconds, fromSnapshot);
            Walked.Record(plan.EntriesWalked, fromSnapshot);
            return Results.Ok(View(plan, now));
        });
    }

    // Groups first so what's in them has somewhere to go, and taken out last
    // once nothing's in them.
    private static async Task ApplyAsync(AnnotationDbContext db, Guid collectionId, Plan plan)
    {
        List<KeyValuePair<(string Entity, Guid Id), RowState>> Of(Dictionary<(string Entity, Guid Id), RowState> rows, string entity) =>
            rows.Where(r => r.Key.Entity == entity).ToList();

        await AddBackAsync<AnnotationGroup>(db, collectionId, HistoryLog.Group, Of(plan.Add, HistoryLog.Group));
        await ChangeTrackedAsync(db, Of(plan.Change, HistoryLog.Group));
        await db.SaveChangesAsync();

        await AddAnnotationsBackAsync(db, collectionId, Of(plan.Add, HistoryLog.Annotation));
        await ChangeAnnotationsAsync(db, Of(plan.Change, HistoryLog.Annotation));
        var annotationsGone = plan.Remove.Where(k => k.Entity == HistoryLog.Annotation).Select(k => k.Id).ToList();
        if (annotationsGone.Count > 0)
            await AnnotationBulk.DeleteAsync(db, db.Annotations.Where(a => annotationsGone.Contains(a.Id)));

        await AddBackAsync<CellCount>(db, collectionId, HistoryLog.CellCount, Of(plan.Add, HistoryLog.CellCount));
        foreach (var (key, _) in Of(plan.Add, HistoryLog.CellCount)) await AddRegionBackAsync(db, collectionId, key.Id);
        await ChangeTrackedAsync(db, Of(plan.Change, HistoryLog.CellCount));
        var countsGone = plan.Remove.Where(k => k.Entity == HistoryLog.CellCount).Select(k => k.Id).ToList();
        db.CellCounts.RemoveRange(await db.CellCounts.Include(c => c.RegionOfInterest).Where(c => countsGone.Contains(c.Id)).ToListAsync());

        var groupsGone = plan.Remove.Where(k => k.Entity == HistoryLog.Group).Select(k => k.Id).ToList();
        db.AnnotationGroups.RemoveRange(await db.AnnotationGroups.Where(g => groupsGone.Contains(g.Id)).ToListAsync());
        await db.SaveChangesAsync();
    }

    // The row's latest delete has the whole of it, and it must have one, since
    // it isn't here now and was then. Through the tracker, so the save logs it.
    private static async Task AddBackAsync<T>(AnnotationDbContext db, Guid collectionId, string entity, List<KeyValuePair<(string Entity, Guid Id), RowState>> rows) where T : class, new()
    {
        foreach (var ((_, id), columns) in rows)
        {
            var before = await LatestDeleteAsync(db, collectionId, entity, id);
            if (before is null) continue;
            var row = HistoryLog.Rebuild<T>(db, before);
            var entry = db.Entry(row);
            foreach (var (name, value) in columns)
                entry.Property(name).CurrentValue = HistoryLog.ValueOf(value, entry.Property(name).Metadata.ClrType);
            db.Add(row);
        }
    }

    private static Task<string?> LatestDeleteAsync(AnnotationDbContext db, Guid collectionId, string entity, Guid id) =>
        db.HistoryEntries.AsNoTracking()
            .Where(e => e.CollectionId == collectionId && e.Entity == entity && e.EntityId == id && e.Op == HistoryOp.Delete)
            .OrderByDescending(e => e.Id)
            .Select(e => e.Before)
            .FirstOrDefaultAsync();

    // Its region of interest went with it, in the same change set.
    private static async Task AddRegionBackAsync(AnnotationDbContext db, Guid collectionId, Guid countId)
    {
        var delete = await db.HistoryEntries.AsNoTracking()
            .Where(e => e.CollectionId == collectionId && e.Entity == HistoryLog.CellCount && e.EntityId == countId && e.Op == HistoryOp.Delete)
            .OrderByDescending(e => e.Id)
            .Select(e => e.ChangeSetId)
            .FirstOrDefaultAsync();
        var regions = await db.HistoryEntries.AsNoTracking()
            .Where(e => e.ChangeSetId == delete && e.Entity == HistoryLog.RegionOfInterest && e.Op == HistoryOp.Delete)
            .ToListAsync();
        foreach (var entry in regions)
        {
            var region = HistoryLog.Rebuild<RegionOfInterest>(db, entry.Before!);
            if (region.CellCountId == countId && await db.RegionsOfInterest.FindAsync(region.Id) is null)
                db.RegionsOfInterest.Add(region);
        }
    }

    private static async Task ChangeTrackedAsync(AnnotationDbContext db, List<KeyValuePair<(string Entity, Guid Id), RowState>> rows)
    {
        foreach (var ((entity, id), columns) in rows)
        {
            object? live = entity == HistoryLog.Group ? await db.AnnotationGroups.FindAsync(id) : await db.CellCounts.FindAsync(id);
            if (live is null) continue;
            var entry = db.Entry(live);
            foreach (var (name, value) in columns)
                entry.Property(name).CurrentValue = HistoryLog.ValueOf(value, entry.Property(name).Metadata.ClrType);
        }
    }

    // Could be thousands, each with a whole shape, so on Postgres they're
    // rebuilt in the database with what's going back on top.
    private static async Task AddAnnotationsBackAsync(AnnotationDbContext db, Guid collectionId, List<KeyValuePair<(string Entity, Guid Id), RowState>> rows)
    {
        if (rows.Count == 0) return;
        if (!HistoryLog.IsPostgres(db))
        {
            await AddBackAsync<Annotation>(db, collectionId, HistoryLog.Annotation, rows);
            await db.SaveChangesAsync();
            return;
        }
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = (NpgsqlTransaction)db.Database.CurrentTransaction!.GetDbTransaction();
        command.CommandText = """
            INSERT INTO "Annotations"
            SELECT (jsonb_populate_record(NULL::"Annotations", e."Before" || t.columns::jsonb)).*
            FROM unnest(@ids, @columns) AS t(id, columns)
            CROSS JOIN LATERAL (
                SELECT "Before" FROM history."Entries"
                WHERE "CollectionId" = @collection AND "Entity" = 'annotation' AND "EntityId" = t.id AND "Op" = 'Delete'
                ORDER BY "Id" DESC LIMIT 1) e
            ON CONFLICT ("Id") DO NOTHING
            RETURNING "Id"
            """;
        command.Parameters.Add(new NpgsqlParameter("collection", NpgsqlDbType.Uuid) { Value = collectionId });
        command.Parameters.Add(new NpgsqlParameter("ids", NpgsqlDbType.Array | NpgsqlDbType.Uuid) { Value = rows.Select(r => r.Key.Id).ToArray() });
        command.Parameters.Add(new NpgsqlParameter("columns", NpgsqlDbType.Array | NpgsqlDbType.Text) { Value = rows.Select(r => JsonSerializer.Serialize(r.Value)).ToArray() });
        var back = new List<Guid>();
        await using (var reader = await command.ExecuteReaderAsync())
            while (await reader.ReadAsync()) back.Add(reader.GetGuid(0));
        await HistoryLog.WriteAsync(db, back.Select(id => HistoryLog.Created(db, HistoryLog.Annotation, id)).ToList());
    }

    // One statement for each set of values going back, not one per row - a bulk
    // recolour undone is a handful.
    private static async Task ChangeAnnotationsAsync(AnnotationDbContext db, List<KeyValuePair<(string Entity, Guid Id), RowState>> rows)
    {
        if (rows.Count == 0) return;
        var ids = rows.Select(r => r.Key.Id).ToList();
        var now = await db.Annotations.AsNoTracking().Where(a => ids.Contains(a.Id))
            .Select(a => new { a.Id, a.Label, a.Notes, a.Colour, a.GroupId }).ToDictionaryAsync(a => a.Id);
        Type TypeOf(string column) => column == nameof(Annotation.GroupId) ? typeof(Guid?) : typeof(string);

        foreach (var batch in rows.GroupBy(r => JsonSerializer.Serialize(r.Value.OrderBy(c => c.Key))))
        {
            var rowIds = batch.Select(r => r.Key.Id).ToList();
            var set = batch.First().Value.ToDictionary(c => c.Key, c => HistoryLog.ValueOf(c.Value, TypeOf(c.Key)));
            await db.Annotations.Where(a => rowIds.Contains(a.Id)).ExecuteUpdateAsync(s =>
            {
                foreach (var (column, value) in set)
                    if (column == nameof(Annotation.GroupId)) s.SetProperty(a => a.GroupId, (Guid?)value);
                    else s.SetProperty(a => EF.Property<string>(a, column), (string)value!);
            });
        }

        object? Was(Guid id, string column) => column switch
        {
            nameof(Annotation.Label) => now[id].Label,
            nameof(Annotation.Notes) => now[id].Notes,
            nameof(Annotation.Colour) => now[id].Colour,
            _ => now[id].GroupId,
        };
        var history = rows
            .Where(r => now.ContainsKey(r.Key.Id))
            .Select(r => HistoryLog.Updated(db, HistoryLog.Annotation, r.Key.Id,
                r.Value.ToDictionary(c => c.Key, c => (Was(r.Key.Id, c.Key), HistoryLog.ValueOf(c.Value, TypeOf(c.Key))))))
            .OfType<HistoryEntry>()
            .ToList();
        await HistoryLog.WriteAsync(db, history);
    }
}
