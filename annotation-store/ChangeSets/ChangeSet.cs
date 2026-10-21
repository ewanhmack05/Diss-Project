namespace AnnotationStore.ChangeSets;

// One change someone made, like a commit - a single save, or a 21k delete
// sent in batches, all under the one id. Every write to annotations,
// groups, cell counts, image adjustments and collections makes one or adds
// to one (see ChangeSets.cs). Deleted rows say which one deleted them, so a
// whole change can be put back in one go.
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

// Hidden rather than removed when deleted. A global query filter in
// AnnotationDbContext keeps them out of every read, so endpoints don't have
// to remember to. Nothing is purged yet - the history log needs them.
public interface ISoftDeletable
{
    DateTimeOffset? Deleted { get; set; }
    // The change set that deleted it.
    Guid? DeletedIn { get; set; }
}
