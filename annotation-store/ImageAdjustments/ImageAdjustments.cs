namespace AnnotationStore.ImageAdjustments;

// Per image adjustment presets for brightess, constrast, red, green, blue, gamma, etc. for a given slide
public class ImageAdjustments
{
    public Guid ImageAdjustmentId { get; set; }
    public string SlideId { get; set; } = "";
    public string AdjustmentName { get; set; } = "";
    public string Adjustments { get; set; } = "";
    public DateTimeOffset Created { get; set; }
    public string UserId { get; set; } = "";
}
