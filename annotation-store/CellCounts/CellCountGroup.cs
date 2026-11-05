namespace AnnotationStore.CellCounts;

// A named set of cell counts inside one collection, the same as AnnotationGroup
// is for annotations. One level only, and a count is in at most one (its
// GroupId). Same access as the collection it's in. Deleting a group leaves its
// counts where they are, just ungrouped.
public class CellCountGroup
{
    public Guid Id { get; set; }
    public Guid CollectionId { get; set; }
    public string Name { get; set; } = "";
    public string Notes { get; set; } = "";
    public DateTimeOffset Created { get; set; }
}
