namespace AnnotationStore.Annotations;

public class Annotation
{
    public Guid Id { get; set; }
    public Guid CollectionId { get; set; }
    // Denormalized from the owning Collection, set server-side on POST - see
    // Program.cs. Kept so a query never needs to join back to Collections
    // just to know which slide a row belongs to.
    public string SlideId { get; set; } = "";
    public string Label { get; set; } = "";
    public string Notes { get; set; } = "";
    public string Colour { get; set; } = "";
    public string Shape { get; set; } = "";
    public string LineStyle { get; set; } = "";
    public int LineThickness { get; set; }
    public string GeoJson { get; set; } = "";
    // The AnnotationGroup it's in, if any - always one in the same collection.
    public Guid? GroupId { get; set; }
    public DateTimeOffset Created { get; set; }
    // Who saved it - their Keycloak id and name, set server-side on POST from
    // the token, like SlideId. Empty for rows from before sign-in.
    public string CreatedById { get; set; } = "";
    public string CreatedByName { get; set; } = "";
}

// What PUT /annotations/{id} takes. Label, notes and colour are all
// replaced. WasColour is the colour the save started from, for a session
// that turns down a save made over someone else's change - see
// Conflicts/EditConflicts.cs. Left out, it isn't checked.
public class AnnotationUpdate
{
    public string Label { get; set; } = "";
    public string Notes { get; set; } = "";
    public string Colour { get; set; } = "";
    public string? WasColour { get; set; }
}
