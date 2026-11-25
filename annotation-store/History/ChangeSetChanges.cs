using System.Security.Claims;
using System.Text.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.Auth;
using AnnotationStore.Collections;
using AnnotationStore.Paging;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.History;

// One column going from one value to another, on Count rows of one kind -
// a recolour of 48 annotations from red to blue is one of these. Names are
// the first few of those rows, or null for one that's gone since. Someone
// joining or leaving is their role going from or to nothing, and a new link is
// the same for what it is.
public record FieldChange(string Entity, string Column, JsonElement Before, JsonElement After, int Count, List<string?> Names);

// What one change set did, for the History tab's detail page. Changes is
// every column it changed, grouped; Deleted how many rows it took out, with
// the first few by name; Created how many it made. Groups names every group
// a GroupId in Changes points at, gone ones included. DeletedRows is the same
// first few as DeletedNames with what they are, so one can be opened, and
// the slices of a volume each was on - a count's one slice is both.
// CopiedFrom is which row each new one came from, when it's something sent in
// a message.
public record ChangeSetChanges(
    List<FieldChange> Changes,
    int Created,
    int Deleted,
    List<string?> DeletedNames,
    Dictionary<Guid, string> Groups,
    List<DeletedRow> DeletedRows,
    List<SourceRow>? CopiedFrom = null);

public record DeletedRow(string Entity, Guid Id, string? Name, int? SliceFrom = null, int? SliceTo = null);

// A page of everything one change deleted. Total is how many match the search.
public record DeletedPage(int Total, List<DeletedRow> Rows);

public static class ChangeSetChangesEndpoint
{
    // How many rows a FieldChange or the deleted list names - the page opens
    // GET /changesets/{id}/deleted for the rest.
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
                .Where(e => e.ChangeSetId == id
                    && (e.Op == HistoryOp.Update || e.Entity == HistoryLog.Member || e.Entity == HistoryLog.Invite))
                .OrderBy(e => e.Id)
                .Select(e => new { e.Entity, e.EntityId, e.Op, e.Before, e.After })
                .ToListAsync();
            var grouped = new Dictionary<(string Entity, string Column, string Before, string After), Grouped>();
            foreach (var update in updates)
            {
                if (update.Op == HistoryOp.Update && (update.Before is null || update.After is null)) continue;
                using var before = JsonDocument.Parse(update.Before ?? "{}");
                using var after = JsonDocument.Parse(update.After ?? "{}");
                // Who it is rather than what changed - they're the name on it.
                var columns = (update.Op == HistoryOp.Delete ? before : after).RootElement.EnumerateObject()
                    .Select(c => c.Name)
                    .Where(c => c is not (nameof(CollectionMember.UserId) or nameof(CollectionMember.DisplayName)));
                foreach (var column in columns)
                {
                    var was = ValueIn(before, column);
                    var now = ValueIn(after, column);
                    // Neither was there nor is now - a new link hasn't stopped.
                    if (update.Op == HistoryOp.Create && now.ValueKind == JsonValueKind.Null) continue;
                    var key = (update.Entity, column, was.GetRawText(), now.GetRawText());
                    if (!grouped.TryGetValue(key, out var entry)) grouped[key] = entry = new Grouped(was, now);
                    if (entry.Ids.Count < NamesShown) entry.Ids.Add(update.EntityId);
                    entry.Count++;
                }
            }

            var changes = new List<FieldChange>();
            foreach (var ((entity, column, _, _), value) in grouped.OrderByDescending(g => g.Value.Count))
                changes.Add(new FieldChange(entity, column, value.Before, value.After, value.Count, await NamesAsync(db, changeSet.CollectionId, entity, value.Ids)));

            var counted = db.HistoryEntries.Where(e => e.ChangeSetId == id && e.Entity != HistoryLog.RegionOfInterest).WithoutSettings();
            var deleted = await counted.CountAsync(e => e.Op == HistoryOp.Delete);
            var created = await counted.CountAsync(e => e.Op == HistoryOp.Create);
            var deletedRows = await NamesInHistoryAsync(db, id, NamesShown);
            var deletedNames = deletedRows.Select(n => n.Name).ToList();

            var groups = new Dictionary<Guid, string>();
            foreach (var change in changes.Where(c => c.Column == "GroupId"))
                foreach (var value in new[] { change.Before, change.After })
                    if (value.ValueKind == JsonValueKind.String && value.GetGuid() is var group && !groups.ContainsKey(group))
                        groups[group] = await GroupNameAsync(db, group);

            return Results.Ok(new ChangeSetChanges(changes, created, deleted, deletedNames, groups,
                deletedRows.Select(Row).ToList(),
                changeSet.SourceRows is null ? null : JsonSerializer.Deserialize<List<SourceRow>>(changeSet.SourceRows)));
        }).AllowGuests();

        // Everything a change deleted, a page at a time, in the order it deleted
        // them - by name if there's a search. Still listed once they're back.
        // Anyone who can read the collection, and the names are read the same
        // way as above.
        app.MapGet("/changesets/{id:guid}/deleted", async (Guid id, string? search, int? skip, int? take, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (SavedPaging.Invalid(skip, take) is { } invalid) return invalid;
            var changeSet = await db.ChangeSets.FirstOrDefaultAsync(c => c.Id == id);
            if (changeSet is null) return Results.NotFound();
            if (await db.RequireAsync(changeSet.CollectionId, user, CollectionRole.Viewer) is { } denied) return denied;
            var total = await DeletedCountAsync(db, id, search);
            var rows = await NamesInHistoryAsync(db, id, take ?? SavedPaging.MaxTake, skip ?? 0, search);
            return Results.Ok(new DeletedPage(total, rows.Select(Row).ToList()));
        }).AllowGuests();
    }

    private static DeletedRow Row(Named named) => new(named.Entity, named.EntityId, named.Name, named.SliceFrom, named.SliceTo);

    private static readonly JsonElement Nothing = JsonSerializer.SerializeToElement<string?>(null);

    private static JsonElement ValueIn(JsonDocument columns, string column) =>
        columns.RootElement.TryGetProperty(column, out var value) ? value.Clone() : Nothing;

    private class Grouped(JsonElement before, JsonElement after)
    {
        public JsonElement Before { get; } = before;
        public JsonElement After { get; } = after;
        public List<Guid> Ids { get; } = [];
        public int Count { get; set; }
    }

    // What these rows are called now - null for one that's gone since. Someone
    // who's left is still called what they were.
    private static async Task<List<string?>> NamesAsync(AnnotationDbContext db, Guid collectionId, string entity, List<Guid> ids)
    {
        if (entity == HistoryLog.Member)
        {
            var members = (await db.CollectionMembers.Where(m => m.CollectionId == collectionId)
                    .Select(m => new { m.UserId, m.DisplayName }).ToListAsync())
                .ToDictionary(m => HistoryLog.SettingId(collectionId, m.UserId), m => m.DisplayName);
            var found = new List<string?>();
            foreach (var id in ids) found.Add(members.GetValueOrDefault(id) ?? await NameInHistoryAsync(db, id));
            return found;
        }

        var names = entity switch
        {
            HistoryLog.Annotation => await db.Annotations.Where(a => ids.Contains(a.Id)).Select(a => new { a.Id, Name = a.Label }).ToListAsync(),
            HistoryLog.Group => await db.AnnotationGroups.Where(g => ids.Contains(g.Id)).Select(g => new { g.Id, g.Name }).ToListAsync(),
            HistoryLog.CellCountGroup => await db.CellCountGroups.Where(g => ids.Contains(g.Id)).Select(g => new { g.Id, g.Name }).ToListAsync(),
            HistoryLog.CellCount => await db.CellCounts.Where(c => ids.Contains(c.Id)).Select(c => new { c.Id, Name = c.Label }).ToListAsync(),
            HistoryLog.Collection => await db.Collections.Where(c => ids.Contains(c.CollectionId)).Select(c => new { Id = c.CollectionId, Name = c.CollectionName }).ToListAsync(),
            HistoryLog.ImageAdjustment => await db.ImageAdjustments.Where(a => ids.Contains(a.ImageAdjustmentId)).Select(a => new { Id = a.ImageAdjustmentId, Name = a.AdjustmentName }).ToListAsync(),
            _ => [],
        };
        var byId = names.ToDictionary(n => n.Id, n => (string?)n.Name);
        return ids.Select(i => byId.GetValueOrDefault(i)).ToList();
    }

    // A group by name - from the live table, or from its delete if it's gone.
    public static async Task<string> GroupNameAsync(AnnotationDbContext db, Guid id)
    {
        if (await db.AnnotationGroups.Where(g => g.Id == id).Select(g => g.Name).FirstOrDefaultAsync() is { } name) return name;
        if (await db.CellCountGroups.Where(g => g.Id == id).Select(g => g.Name).FirstOrDefaultAsync() is { } countGroup) return countGroup;
        return await NameInHistoryAsync(db, id) ?? "a deleted group";
    }

    private record Named(string Entity, Guid EntityId, string? Name, int? SliceFrom, int? SliceTo);

    // Names out of delete entries, read in the database so the whole row
    // never comes back. Only fixed column names and numbers are put in the SQL
    // itself; ids and what's searched for go in as parameters.
    private static Task<List<Named>> NamesInHistoryAsync(AnnotationDbContext db, Guid changeSetId, int take, int skip = 0, string? search = null)
    {
        var sql = $"SELECT \"Entity\", \"EntityId\", {Name(db)} AS \"Name\", {Slices(db)} {DeletedFrom(db, search)} "
            + $"ORDER BY \"Id\" LIMIT {take} OFFSET {skip}";
        return db.Database.SqlQueryRaw<Named>(sql, Parameters(changeSetId, search)).ToListAsync();
    }

    private static Task<int> DeletedCountAsync(AnnotationDbContext db, Guid changeSetId, string? search)
    {
        var sql = $"SELECT CAST(COUNT(*) AS integer) AS \"Value\" {DeletedFrom(db, search)}";
        return db.Database.SqlQueryRaw<int>(sql, Parameters(changeSetId, search)).SingleAsync();
    }

    // What a row was called when it was last deleted.
    private static async Task<string?> NameInHistoryAsync(AnnotationDbContext db, Guid entityId)
    {
        var sql = $"SELECT \"Entity\", \"EntityId\", {Name(db)} AS \"Name\", {Slices(db)} FROM {Entries(db)} "
            + "WHERE \"EntityId\" = {0} AND \"Op\" = 'Delete' ORDER BY \"Id\" DESC LIMIT 1";
        return (await db.Database.SqlQueryRaw<Named>(sql, entityId).ToListAsync()).FirstOrDefault()?.Name;
    }

    private static string Entries(AnnotationDbContext db) => HistoryLog.IsPostgres(db) ? "history.\"Entries\"" : "\"Entries\"";

    private static string Field(AnnotationDbContext db, string column) =>
        HistoryLog.IsPostgres(db) ? $"\"Before\" ->> '{column}'" : $"json_extract(\"Before\", '$.{column}')";

    private static string Name(AnnotationDbContext db) =>
        $"COALESCE({Field(db, "Label")}, {Field(db, "Name")}, {Field(db, "AdjustmentName")}, {Field(db, "DisplayName")})";

    // An annotation's range, or a count's one slice as both ends.
    private static string Slices(AnnotationDbContext db)
    {
        string Whole(string column) => $"CAST({Field(db, column)} AS integer)";
        return $"COALESCE({Whole("SliceFrom")}, {Whole("Slice")}) AS \"SliceFrom\", COALESCE({Whole("SliceTo")}, {Whole("Slice")}) AS \"SliceTo\"";
    }

    private static string DeletedFrom(AnnotationDbContext db, string? search)
    {
        var sql = $"FROM {Entries(db)} WHERE \"ChangeSetId\" = {{0}} AND \"Op\" = 'Delete' "
            + "AND \"Entity\" NOT IN ('regionOfInterest', 'collection', 'member', 'invite')";
        if (string.IsNullOrWhiteSpace(search)) return sql;
        // Found rather than matched, so % and _ are only themselves.
        var find = HistoryLog.IsPostgres(db) ? "strpos" : "instr";
        return $"{sql} AND {find}(LOWER({Name(db)}), {{1}}) > 0";
    }

    private static object[] Parameters(Guid changeSetId, string? search) =>
        string.IsNullOrWhiteSpace(search) ? [changeSetId] : [changeSetId, search.Trim().ToLower()];
}
