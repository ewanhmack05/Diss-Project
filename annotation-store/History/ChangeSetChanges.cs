using System.Security.Claims;
using System.Text.Json;
using AnnotationStore.Annotations;
using AnnotationStore.Auth;
using AnnotationStore.Collections;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.History;

// One column going from one value to another, on Count rows of one kind -
// a recolour of 48 annotations from red to blue is one of these. Names are
// the first few of those rows, or null for one that's gone since.
public record FieldChange(string Entity, string Column, JsonElement Before, JsonElement After, int Count, List<string?> Names);

// What one change set did, for the History tab's detail page. Changes is
// every column it changed, grouped; Deleted how many rows it took out, with
// the first few by name; Created how many it made. Groups names every group
// a GroupId in Changes points at, gone ones included.
public record ChangeSetChanges(
    List<FieldChange> Changes,
    int Created,
    int Deleted,
    List<string?> DeletedNames,
    Dictionary<Guid, string> Groups);

public static class ChangeSetChangesEndpoint
{
    // How many rows a FieldChange or the deleted list names - the page says
    // "and 2,135 more" for the rest.
    public const int NamesShown = 5;

    public static void MapChangeSetChanges(this WebApplication app)
    {
        // Anyone who can read the collection, like the list. Reads only the
        // update entries' changed columns and the names of what was deleted
        // - never a deleted row's whole copy, which for a cell count can be
        // megabytes of dots.
        app.MapGet("/changesets/{id:guid}/changes", async (Guid id, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var changeSet = await db.ChangeSets.FirstOrDefaultAsync(c => c.Id == id);
            if (changeSet is null) return Results.NotFound();
            if (await db.RequireAsync(changeSet.CollectionId, user, CollectionRole.Viewer) is { } denied) return denied;

            var updates = await db.HistoryEntries.AsNoTracking()
                .Where(e => e.ChangeSetId == id && e.Op == HistoryOp.Update)
                .OrderBy(e => e.Id)
                .Select(e => new { e.Entity, e.EntityId, e.Before, e.After })
                .ToListAsync();
            var grouped = new Dictionary<(string Entity, string Column, string Before, string After), Grouped>();
            foreach (var update in updates)
            {
                if (update.Before is null || update.After is null) continue;
                using var before = JsonDocument.Parse(update.Before);
                using var after = JsonDocument.Parse(update.After);
                foreach (var column in after.RootElement.EnumerateObject())
                {
                    var was = before.RootElement.TryGetProperty(column.Name, out var b) ? b.Clone() : default;
                    var key = (update.Entity, column.Name, was.ValueKind == JsonValueKind.Undefined ? "" : was.GetRawText(), column.Value.GetRawText());
                    if (!grouped.TryGetValue(key, out var entry)) grouped[key] = entry = new Grouped(was, column.Value.Clone());
                    if (entry.Ids.Count < NamesShown) entry.Ids.Add(update.EntityId);
                    entry.Count++;
                }
            }

            var changes = new List<FieldChange>();
            foreach (var ((entity, column, _, _), value) in grouped.OrderByDescending(g => g.Value.Count))
                changes.Add(new FieldChange(entity, column, value.Before, value.After, value.Count, await NamesAsync(db, entity, value.Ids)));

            var counted = db.HistoryEntries.Where(e => e.ChangeSetId == id && e.Entity != HistoryLog.RegionOfInterest);
            var deleted = await counted.CountAsync(e => e.Op == HistoryOp.Delete);
            var created = await counted.CountAsync(e => e.Op == HistoryOp.Create);
            var deletedNames = (await NamesInHistoryAsync(db, id, null, NamesShown)).Select(n => n.Name).ToList();

            var groups = new Dictionary<Guid, string>();
            foreach (var change in changes.Where(c => c.Column == "GroupId"))
                foreach (var value in new[] { change.Before, change.After })
                    if (value.ValueKind == JsonValueKind.String && value.GetGuid() is var group && !groups.ContainsKey(group))
                        groups[group] = await GroupNameAsync(db, changeSet.CollectionId, group);

            return Results.Ok(new ChangeSetChanges(changes, created, deleted, deletedNames, groups));
        }).AllowGuests();
    }

    private class Grouped(JsonElement before, JsonElement after)
    {
        public JsonElement Before { get; } = before;
        public JsonElement After { get; } = after;
        public List<Guid> Ids { get; } = [];
        public int Count { get; set; }
    }

    // What these rows are called now - null for one that's gone since.
    private static async Task<List<string?>> NamesAsync(AnnotationDbContext db, string entity, List<Guid> ids)
    {
        var names = entity switch
        {
            HistoryLog.Annotation => await db.Annotations.Where(a => ids.Contains(a.Id)).Select(a => new { a.Id, Name = a.Label }).ToListAsync(),
            HistoryLog.Group => await db.AnnotationGroups.Where(g => ids.Contains(g.Id)).Select(g => new { g.Id, g.Name }).ToListAsync(),
            HistoryLog.CellCount => await db.CellCounts.Where(c => ids.Contains(c.Id)).Select(c => new { c.Id, Name = c.Label }).ToListAsync(),
            HistoryLog.ImageAdjustment => await db.ImageAdjustments.Where(a => ids.Contains(a.ImageAdjustmentId)).Select(a => new { Id = a.ImageAdjustmentId, Name = a.AdjustmentName }).ToListAsync(),
            _ => [],
        };
        var byId = names.ToDictionary(n => n.Id, n => (string?)n.Name);
        return ids.Select(i => byId.GetValueOrDefault(i)).ToList();
    }

    // A group by name - from the live table, or from its delete if it's gone.
    private static async Task<string> GroupNameAsync(AnnotationDbContext db, Guid collectionId, Guid id)
    {
        if (await db.AnnotationGroups.Where(g => g.Id == id).Select(g => g.Name).FirstOrDefaultAsync() is { } name) return name;
        var deleted = await NamesInHistoryAsync(db, null, id, 1);
        return deleted.FirstOrDefault()?.Name ?? "a deleted group";
    }

    private record Named(Guid EntityId, string? Name);

    // Names out of delete entries, read in the database so the whole row
    // never comes back - by change set, or one row's latest delete.
    private static Task<List<Named>> NamesInHistoryAsync(AnnotationDbContext db, Guid? changeSetId, Guid? entityId, int take)
    {
        var postgres = HistoryLog.IsPostgres(db);
        string Field(string name) => postgres ? $"\"Before\" ->> '{name}'" : $"json_extract(\"Before\", '$.{name}')";
        var name = $"COALESCE({Field("Label")}, {Field("Name")}, {Field("AdjustmentName")})";
        var entries = postgres ? "history.\"Entries\"" : "\"Entries\"";
        var where = changeSetId is not null ? "\"ChangeSetId\" = {0}" : "\"EntityId\" = {0}";
        return db.Database.SqlQueryRaw<Named>($"""
            SELECT "EntityId", {name} AS "Name" FROM {entries}
            WHERE {where} AND "Op" = 'Delete' AND "Entity" <> 'regionOfInterest' AND "Entity" <> 'collection'
            ORDER BY "Id" {(changeSetId is not null ? "" : "DESC")}
            LIMIT {take}
            """, changeSetId ?? entityId!.Value).ToListAsync();
    }
}
