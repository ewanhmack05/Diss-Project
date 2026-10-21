using System.Text.Json.Serialization;
using AnnotationStore.ChangeSets;

namespace AnnotationStore.Annotations;

// A named set of annotations inside one collection - for keeping related
// shapes together. One level only, and an annotation is in at most one (its
// GroupId). Same access as the collection it's in. Deleting a group leaves
// its annotations where they are, just ungrouped.
public class AnnotationGroup : ISoftDeletable, IInCollection
{
    public Guid Id { get; set; }
    public Guid CollectionId { get; set; }
    public string Name { get; set; } = "";
    public string Notes { get; set; } = "";
    public DateTimeOffset Created { get; set; }
    // Set when it's deleted - see ChangeSets/ChangeSet.cs. Never sent or taken
    // over JSON, so a POST can't make a hidden row.
    [JsonIgnore] public DateTimeOffset? Deleted { get; set; }
    [JsonIgnore] public Guid? DeletedIn { get; set; }
}
