namespace AnnotationStore.ImageAdjustments;

// Per image adjustment presets for brightess, constrast, red, green, blue, gamma, etc. for a given slide
public class ImageAdjustments
{
    public Guid ImageAdjustmentId { get; set; }
    public Guid CollectionId { get; set; }
    // Denormalized from the owning Collection, set server-side on POST - see
    // Program.cs and Annotation's own copy of this same field/comment.
    public string SlideId { get; set; } = "";
    public string AdjustmentName { get; set; } = "";
    public string Adjustments { get; set; } = "";
    public DateTimeOffset Created { get; set; }
    public string UserId { get; set; } = "";
}
