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
    public DateTimeOffset Created { get; set; }
}
