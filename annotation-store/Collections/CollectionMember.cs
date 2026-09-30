namespace AnnotationStore.Collections;

// In order, so a role can be compared with "at least editor".
public enum CollectionRole { Viewer, Editor, Owner }

// Who can see or change a collection. The person a collection was made for
// is its Owner (and its Collections.UserId); anyone else is added by them.
// DisplayName is kept here so a collection can list its people without
// asking Keycloak.
public class CollectionMember
{
    public Guid CollectionId { get; set; }
    public string UserId { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public CollectionRole Role { get; set; }
    public DateTimeOffset Added { get; set; }
}
