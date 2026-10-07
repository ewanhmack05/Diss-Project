namespace AnnotationStore.Collections;

// A link into a session. Whoever opens it (signed in) becomes a member with
// Role. Only works while it hasn't expired, hasn't been stopped, and the
// session hasn't ended. Code is the only secret, so it's long and random.
public class CollectionInvite
{
    public string Code { get; set; } = "";
    public Guid CollectionId { get; set; }
    public CollectionRole Role { get; set; }
    public string CreatedById { get; set; } = "";
    public DateTimeOffset Created { get; set; }
    public DateTimeOffset Expires { get; set; }
    public DateTimeOffset? Stopped { get; set; }
}
