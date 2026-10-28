using System.Diagnostics.Metrics;
using System.Text.Json;
using AnnotationStore.Annotations;
using AnnotationStore.History;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.Conflicts;

// What happens when two people change the same thing. Picked per session by
// whoever starts it, and saved on it. Personal collections are one person,
// so they're always LastWriteWins.
public enum EditPolicy
{
    // The later save replaces the earlier one. What it always did.
    LastWriteWins,
    // A save that would replace something changed since it was read is turned
    // down with a 409 saying what it is now and who changed it, and they
    // choose which to keep.
    FirstComeWins,
}

// A 409's body: the row as it is now, and who last changed the fields in the
// way, and when.
public record ConflictView(string Entity, Guid Id, object Current, string? ChangedBy, DateTimeOffset? ChangedAt, IReadOnlyList<string> Changed);

// One row a bulk change left alone under FirstComeWins, as it is now.
public record BulkConflict(Guid Id, string Colour, Guid? GroupId, string? ChangedBy, DateTimeOffset? ChangedAt);

// The check is per field. A save sends what it thinks a field is now (its
// "was") along with what it wants it to be. It's in the way of someone else
// when the field has changed since - it's no longer the was - and the save
// would change it again. Leaving the was out means don't check, which is what
// scripts and older clients do.
//
// Only fields that aren't merged live are checked: an annotation's colour and
// group, a group's name and notes. Labels and notes on annotations and cell
// counts are shared with Yjs, so two people typing never lose anything.
// Deletes aren't checked - anything deleted can be put back from History.
//
// The check and the save happen with the row locked (Postgres), so two saves
// from the same was can't both get through. The write only joins its change
// set once it's passed, inside the same transaction.
public static class EditConflicts
{
    public const string MeterName = "AnnotationStore.Conflicts";
    // On a single save that replaced someone else's change in a LastWriteWins
    // session - what the evaluation scripts count, without the dashboard.
    public const string OverwroteHeader = "Overwrote";
    private static readonly Meter Meter = new(MeterName);

    // Saves that would replace a change someone else made since they read
    // it, by policy and what happened: "refused" under FirstComeWins,
    // "overwrote" under LastWriteWins - the second being someone's change
    // now silently gone. The evaluation compares the two on the same field.
    private static readonly Counter<long> InTheWay = Meter.CreateCounter<long>(
        "annotation_store.conflicting_saves", description: "Saves that would replace a change made since they read it - refused or overwriting");

    // In the way of someone else's change: it's changed since was, and this
    // would change it again. No was, no check.
    public static bool InWay<T>(bool sent, T was, T now, T wanted) =>
        sent && !Equals(was, now) && !Equals(wanted, now);

    public static Task<EditPolicy> PolicyAsync(AnnotationDbContext db, Guid collectionId) =>
        db.Collections.Where(c => c.CollectionId == collectionId).Select(c => c.EditPolicy).FirstAsync();

    public static void Count(EditPolicy policy, string entity, int saves = 1)
    {
        if (saves == 0) return;
        InTheWay.Add(saves,
            new KeyValuePair<string, object?>("policy", policy.ToString()),
            new KeyValuePair<string, object?>("entity", entity),
            new KeyValuePair<string, object?>("outcome", policy == EditPolicy.FirstComeWins ? "refused" : "overwrote"));
    }

    // Holds these rows until the transaction ends. Postgres only - SQLite in
    // the tests runs one write at a time anyway.
    public static async Task LockAnnotationsAsync(AnnotationDbContext db, List<Guid> ids)
    {
        if (HistoryLog.IsPostgres(db))
            await db.Database.ExecuteSqlAsync($"""SELECT 1 FROM "Annotations" WHERE "Id" = ANY({ids.ToArray()}) FOR UPDATE""");
    }

    public static async Task LockGroupAsync(AnnotationDbContext db, Guid id)
    {
        if (HistoryLog.IsPostgres(db))
            await db.Database.ExecuteSqlAsync($"""SELECT 1 FROM "AnnotationGroups" WHERE "Id" = {id} FOR UPDATE""");
    }

    // The 409 - the row now, and the latest change to the fields in the way.
    // It comes before the write joins a change set, so a turned-down write
    // leaves none behind, the same as any other.
    public static async Task<IResult> ConflictAsync(AnnotationDbContext db, string entity, Guid id, object current, IReadOnlyCollection<string> fields)
    {
        var last = (await LastChangesAsync(db, entity, [id], fields)).GetValueOrDefault(id);
        return Results.Conflict(new ConflictView(entity, id, current, last?.By, last?.At, last?.Columns ?? [.. fields]));
    }

    public record LastChange(string By, DateTimeOffset At, IReadOnlyList<string> Columns);

    // The latest update to each row that touched any of these fields, with
    // who made it - so a label edit since isn't what's shown.
    public static async Task<Dictionary<Guid, LastChange>> LastChangesAsync(
        AnnotationDbContext db, string entity, List<Guid> ids, IReadOnlyCollection<string> fields)
    {
        var updates = await db.HistoryEntries
            .Where(e => e.Entity == entity && ids.Contains(e.EntityId) && e.Op == HistoryOp.Update)
            .Join(db.ChangeSets, e => e.ChangeSetId, c => c.Id, (e, c) => new { e.Id, e.EntityId, e.After, c.UserName, c.Created })
            .ToListAsync();
        var last = new Dictionary<Guid, LastChange>();
        foreach (var update in updates.OrderByDescending(u => u.Id))
        {
            if (last.ContainsKey(update.EntityId) || update.After is null) continue;
            using var after = JsonDocument.Parse(update.After);
            var columns = after.RootElement.EnumerateObject().Select(c => c.Name).Where(fields.Contains).ToList();
            if (columns.Count > 0) last[update.EntityId] = new LastChange(update.UserName, update.Created, columns);
        }
        return last;
    }

    public static readonly string[] AnnotationColour = [nameof(Annotation.Colour)];
    public static readonly string[] AnnotationFields = [nameof(Annotation.Colour), nameof(Annotation.GroupId)];
    public static readonly string[] GroupFields = [nameof(AnnotationGroup.Name), nameof(AnnotationGroup.Notes)];
}
