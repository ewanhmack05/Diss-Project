namespace AnnotationStore.Annotations;

public class Annotation
{
    public Guid Id { get; set; }
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
