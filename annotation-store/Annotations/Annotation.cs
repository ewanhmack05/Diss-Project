namespace AnnotationStore.Annotations;

// Just one type - the viewer only supports free-form drawing right now, so
// there's no preset/cell-counter/etc. split to model.
public class Annotation
{
    public Guid Id { get; set; }
    public string SlideId { get; set; } = "";
    public string Label { get; set; } = "";
    public string Colour { get; set; } = "";
    public string Shape { get; set; } = "";
    public string LineStyle { get; set; } = "";
    public int LineThickness { get; set; }
    public string GeoJson { get; set; } = "";
    public DateTimeOffset Created { get; set; }
}
