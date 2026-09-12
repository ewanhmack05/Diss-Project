namespace AnnotationStore.CellCounts;

// ROI box a cell count was taken within, as GeoJson. One per CellCount
// with WithRoi on. Fixed at creation, no PUT.
public class RegionOfInterest
{
    public Guid Id { get; set; }
    public Guid CellCountId { get; set; }
    public string GeoJson { get; set; } = "";
    public DateTimeOffset Created { get; set; }
}
