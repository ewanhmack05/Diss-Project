using System.Text.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;

namespace AnnotationStore.History;

// Writes the history for every save, from what EF is about to change, so no
// endpoint has to remember to. Bulk changes to annotations - up to 20,000 at
// a time - go through AnnotationBulk instead, which writes its own. The only
// code that touches the history tables, along with ChangeSets.cs.
public static class HistoryLog
{
    public const string Annotation = "annotation";
    public const string Group = "group";
    public const string CellCount = "cellCount";
    public const string RegionOfInterest = "regionOfInterest";
    public const string ImageAdjustment = "imageAdjustment";
    public const string Collection = "collection";

    // The rows that are versioned. Collections aren't on the list - deleting
    // one hides it (Collections.Deleted) and is logged by hand, see
    // CollectionDeleted.
    public static readonly IReadOnlyDictionary<Type, string> Entities = new Dictionary<Type, string>
    {
        [typeof(Annotation)] = Annotation,
        [typeof(AnnotationGroup)] = Group,
        [typeof(CellCount)] = CellCount,
        [typeof(RegionOfInterest)] = RegionOfInterest,
        [typeof(ImageAdjustments.ImageAdjustments)] = ImageAdjustment,
    };

    // Worked out from other columns and stamped when a list first needs them
    // (CellCountSummary) - not a change anyone made.
    private static readonly HashSet<string> Derived = ["ColourCountsJson", "PlacedByCountsJson"];

    // Column names as they are, so a row's JSON matches Postgres' to_jsonb
    // of it - the migration that moved soft-deleted rows here used that.
    private static readonly JsonSerializerOptions Json = new();

    private const string Postgres = "Npgsql.EntityFrameworkCore.PostgreSQL";

    // What this save is about to do to versioned rows, as history - called
    // by AnnotationDbContext before every save, which writes them after.
    // Anything versioned changing without a change set is a bug, so it
    // throws rather than saving a change nobody can see or put back.
    public static List<HistoryEntry> Capture(AnnotationDbContext db)
    {
        var captured = new List<HistoryEntry>();
        db.ChangeTracker.DetectChanges();
        foreach (var entry in db.ChangeTracker.Entries().ToList())
        {
            if (!Entities.TryGetValue(entry.Entity.GetType(), out var entity)) continue;
            var logged = entry.State switch
            {
                EntityState.Added => new HistoryEntry { Op = HistoryOp.Create },
                EntityState.Modified => Changed(entry),
                EntityState.Deleted => new HistoryEntry
                {
                    Op = HistoryOp.Delete,
                    Before = Columns(entry.Properties.Select(p => (p.Metadata.Name, p.OriginalValue))),
                    After = db.DeleteNotes.TryGetValue(entry.Entity, out var note) ? JsonSerializer.Serialize(note, Json) : null,
                },
                _ => null,
            };
            if (logged is null) continue;
            var key = entry.Metadata.FindPrimaryKey()!.Properties[0].Name;
            captured.Add(InChangeSet(db, logged, entity, (Guid)entry.Property(key).CurrentValue!));
        }
        return captured;
    }

    // Straight into the table - on Postgres with COPY, since a bulk change can
    // be 20,000 rows of whole annotations. Same connection and transaction as
    // the change itself, so they can't end up apart.
    public static async Task WriteAsync(AnnotationDbContext db, IReadOnlyList<HistoryEntry> entries, CancellationToken cancellationToken = default)
    {
        if (entries.Count == 0) return;
        if (db.Database.ProviderName != Postgres)
        {
            db.HistoryEntries.AddRange(entries);
            await db.SaveWithoutHistoryAsync(cancellationToken);
            return;
        }
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        await using var copy = await connection.BeginBinaryImportAsync(
            """COPY history."Entries" ("ChangeSetId", "CollectionId", "Entity", "EntityId", "Op", "Before", "After") FROM STDIN (FORMAT BINARY)""",
            cancellationToken);
        foreach (var entry in entries)
        {
            await copy.StartRowAsync(cancellationToken);
            await copy.WriteAsync(entry.ChangeSetId, NpgsqlDbType.Uuid, cancellationToken);
            await copy.WriteAsync(entry.CollectionId, NpgsqlDbType.Uuid, cancellationToken);
            await copy.WriteAsync(entry.Entity, NpgsqlDbType.Text, cancellationToken);
            await copy.WriteAsync(entry.EntityId, NpgsqlDbType.Uuid, cancellationToken);
            await copy.WriteAsync(entry.Op.ToString(), NpgsqlDbType.Text, cancellationToken);
            await WriteJsonAsync(copy, entry.Before, cancellationToken);
            await WriteJsonAsync(copy, entry.After, cancellationToken);
        }
        await copy.CompleteAsync(cancellationToken);
    }

    // A transaction for a change that's more than one statement - or none, if
    // the caller already has one going.
    public static async Task<IDbContextTransaction?> BeginAsync(AnnotationDbContext db) =>
        db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync() : null;

    public static bool IsPostgres(AnnotationDbContext db) => db.Database.ProviderName == Postgres;

    public static HistoryEntry Created(AnnotationDbContext db, string entity, Guid id) =>
        InChangeSet(db, new HistoryEntry { Op = HistoryOp.Create }, entity, id);

    // Every column of a row that's going, from the row itself.
    public static HistoryEntry Deleted<T>(AnnotationDbContext db, T row, Guid id) where T : class
    {
        var type = db.Model.FindEntityType(typeof(T))!;
        var before = Columns(type.GetProperties().Where(p => p.PropertyInfo is not null).Select(p => (p.Name, p.PropertyInfo!.GetValue(row))));
        return InChangeSet(db, new HistoryEntry { Op = HistoryOp.Delete, Before = before }, Entities[typeof(T)], id);
    }

    // Just what changed - nothing if nothing did.
    public static HistoryEntry? Updated(AnnotationDbContext db, string entity, Guid id, IReadOnlyDictionary<string, (object? Before, object? After)> columns)
    {
        var changed = columns.Where(c => !Equals(c.Value.Before, c.Value.After)).ToList();
        if (changed.Count == 0) return null;
        return InChangeSet(db, new HistoryEntry
        {
            Op = HistoryOp.Update,
            Before = Columns(changed.Select(c => (c.Key, c.Value.Before))),
            After = Columns(changed.Select(c => (c.Key, c.Value.After))),
        }, entity, id);
    }

    // A deleted collection stays in its table, hidden, so the tracker never
    // sees a delete for it.
    public static Task CollectionDeletedAsync(AnnotationDbContext db, Guid collectionId) =>
        WriteAsync(db, [InChangeSet(db, new HistoryEntry { Op = HistoryOp.Delete }, Collection, collectionId)]);

    public static HistoryEntry CollectionRestored(AnnotationDbContext db, Guid collectionId) =>
        Created(db, Collection, collectionId);

    // The row a delete took, as it was - every column, ready to add back.
    public static T Rebuild<T>(AnnotationDbContext db, string before) where T : class, new()
    {
        var type = db.Model.FindEntityType(typeof(T))!;
        var row = new T();
        using var document = JsonDocument.Parse(before);
        foreach (var property in type.GetProperties())
            if (property.PropertyInfo is { } info && document.RootElement.TryGetProperty(property.Name, out var value))
                info.SetValue(row, value.Deserialize(property.ClrType, Json));
        return row;
    }

    // What an update would go back to: for each column it changed that's
    // still what it changed it to, the value from before. A column changed
    // again since is left out, so a later edit is never undone. now gives
    // a column's value now; types its type.
    public static Dictionary<string, object?> Reverted(HistoryEntry update, Func<string, object?> now, Func<string, Type> types)
    {
        var back = new Dictionary<string, object?>();
        if (update.Before is null || update.After is null) return back;
        using var before = JsonDocument.Parse(update.Before);
        using var after = JsonDocument.Parse(update.After);
        foreach (var column in after.RootElement.EnumerateObject())
        {
            var type = types(column.Name);
            if (!Equals(now(column.Name), column.Value.Deserialize(type, Json))) continue;
            if (before.RootElement.TryGetProperty(column.Name, out var was)) back[column.Name] = was.Deserialize(type, Json);
        }
        return back;
    }

    // The same, onto a tracked row - the save then logs it.
    public static bool Revert(EntityEntry live, HistoryEntry update, Func<string, object?, object?>? adjust = null)
    {
        var back = Reverted(update, name => live.Property(name).CurrentValue, name => live.Property(name).Metadata.ClrType);
        var changed = false;
        foreach (var (name, was) in back)
        {
            var value = adjust is null ? was : adjust(name, was);
            if (Equals(value, live.Property(name).CurrentValue)) continue;
            live.Property(name).CurrentValue = value;
            changed = true;
        }
        return changed;
    }

    public static Guid? MergedInto(HistoryEntry delete)
    {
        if (delete.After is null) return null;
        using var after = JsonDocument.Parse(delete.After);
        return after.RootElement.TryGetProperty(nameof(MergedInto), out var into) ? into.GetGuid() : null;
    }

    private static HistoryEntry? Changed(EntityEntry entry)
    {
        var changed = entry.Properties
            .Where(p => p.IsModified && !Derived.Contains(p.Metadata.Name) && !Equals(p.OriginalValue, p.CurrentValue))
            .ToList();
        if (changed.Count == 0) return null;
        return new HistoryEntry
        {
            Op = HistoryOp.Update,
            Before = Columns(changed.Select(p => (p.Metadata.Name, p.OriginalValue))),
            After = Columns(changed.Select(p => (p.Metadata.Name, p.CurrentValue))),
        };
    }

    private static HistoryEntry InChangeSet(AnnotationDbContext db, HistoryEntry entry, string entity, Guid id)
    {
        var changeSet = db.CurrentChangeSet
            ?? throw new InvalidOperationException($"A {entity} changed outside a change set - call ChangeSetAsync first");
        entry.ChangeSetId = changeSet.Id;
        entry.CollectionId = changeSet.CollectionId;
        entry.Entity = entity;
        entry.EntityId = id;
        return entry;
    }

    private static string Columns(IEnumerable<(string Name, object? Value)> columns) =>
        JsonSerializer.Serialize(columns.ToDictionary(c => c.Name, c => c.Value), Json);

    private static async Task WriteJsonAsync(NpgsqlBinaryImporter copy, string? json, CancellationToken cancellationToken)
    {
        if (json is null) await copy.WriteNullAsync(cancellationToken);
        else await copy.WriteAsync(json, NpgsqlDbType.Jsonb, cancellationToken);
    }
}
