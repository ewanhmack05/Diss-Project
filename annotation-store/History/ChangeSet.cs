namespace AnnotationStore.History;

// One change someone made, like a commit - a single save, or a 21k delete
// sent in batches, all under the one id. Every write to annotations,
// groups, cell counts, image adjustments and collections makes one or adds
// to one (see ChangeSets.cs). What it did to each row is in its
// HistoryEntry rows. Lives in the history schema, apart from the data.
public class ChangeSet
{
    public Guid Id { get; set; }
    public Guid CollectionId { get; set; }
    // Who made it, from the token - the same person for every request in it.
    public string UserId { get; set; } = "";
    public string UserName { get; set; } = "";
    // What the first request in it did, e.g. "delete annotations".
    public string What { get; set; } = "";
    public DateTimeOffset Created { get; set; }
}

public enum HistoryOp { Create, Update, Delete }

// What one change did to one row. The live tables only ever hold what's
// there now - this is the only place anything that was there is kept.
// Before and After are JSON objects of column name to value:
// - Create: neither. The live row has it, or a later delete's Before does.
// - Update: just the columns that changed, before and after.
// - Delete: Before is the whole row, so it can be put back. After is only
//   used to say where a merged group went (MergedInto).
public class HistoryEntry
{
    public long Id { get; set; }
    public Guid ChangeSetId { get; set; }
    public Guid CollectionId { get; set; }
    // See HistoryLog.Entities - "annotation", "group", "cellCount",
    // "regionOfInterest", "imageAdjustment" or "collection".
    public string Entity { get; set; } = "";
    public Guid EntityId { get; set; }
    public HistoryOp Op { get; set; }
    public string? Before { get; set; }
    public string? After { get; set; }
}
