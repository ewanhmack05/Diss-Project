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
    // The slices of a volume it's on, inclusive - a 3D marker spans several.
    // Both null means every slice: every row from before, and every 2D
    // annotation. Set when it's added and never changed after.
    public int? SliceFrom { get; set; }
    public int? SliceTo { get; set; }
    public DateTimeOffset Created { get; set; }
    // Who saved it - their Keycloak id and name, set server-side on POST from
    // the token, like SlideId. Empty for rows from before sign-in.
    public string CreatedById { get; set; } = "";
    public string CreatedByName { get; set; } = "";

    // Why a slice range can't be saved, or null if it can. No upper bound -
    // the store doesn't know how many slices a slide has.
    public static string? SliceRangeProblem(Annotation annotation) => (annotation.SliceFrom, annotation.SliceTo) switch
    {
        (null, null) => null,
        (null, _) or (_, null) => "sliceFrom and sliceTo go together - set both or neither",
        ( < 0, _) => "sliceFrom can't be below 0",
        var (from, to) when from > to => "sliceFrom can't be after sliceTo",
        _ => null,
    };
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
