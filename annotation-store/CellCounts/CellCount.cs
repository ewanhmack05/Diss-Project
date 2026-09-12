namespace AnnotationStore.CellCounts;

// A user-placed dot marker for manually counting cells (e.g. mitotic
// figures) within a region on a slide - optionally tied to a specific
// drawn annotation, or to a broader region of interest.
public class CellCount
{
    public Guid Id { get; set; }
    public string SlideId { get; set; } = "";
    public string Label { get; set; } = "";
    public string Notes { get; set; } = "";
    // Every dot placed during the session, as JSON text
    // (`[{"x":123,"y":456,"colour":"#fff614"}, ...]`) - same
    // plain-text-not-a-real-column convention as GeoJson below, in the same
    // slide pixel coordinates as GeoJson/Location. Lets "View" redraw the
    // actual tally rather than just zoom to it, and a colour breakdown for
    // the saved list's swatch is derived from this rather than stored
    // separately, since a session can use more than one colour (colour is
    // changeable live while counting). Empty for a click made with
    // withAnnotation off - it still tallies, but there's no dot to record.
    // Fixed at creation - not updatable via PUT, same as GeoJson/Location.
    public string Dots { get; set; } = "[]";
    public bool WithAnnotation { get; set; }
    public bool WithRoi { get; set; }
    public int Count { get; set; }
    public int DotSize { get; set; }
    // Where the count was taken - the view/ROI-box center at the moment
    // counting stopped, in the slide's own pixel coordinates (same space
    // Annotation's GeoJson is in). Null for a count with no recorded
    // location (e.g. saved before this field existed). Fixed at creation,
    // same convention as Annotation's GeoJson not being updatable via PUT.
    public double? LocationX { get; set; }
    public double? LocationY { get; set; }
    public DateTimeOffset Created { get; set; }
    // Null unless WithRoi was on. No reverse nav on RegionOfInterest -
    // keeps JSON from looping back through this property.
    public RegionOfInterest? RegionOfInterest { get; set; }
}
