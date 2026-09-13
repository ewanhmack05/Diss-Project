using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;

namespace AnnotationStore.Collections;

// A user's workspace for one slide - every Annotation, CellCount, and
// ImageAdjustments row belongs to exactly one of these via its own
// CollectionId, so this holds them by real relationship rather than a
// duplicated blob (no Annotations/CellCount/ImageAdjustments string fields
// here - those would just be a second, driftable copy of what those tables
// already own). Auto-created per (SlideId, UserId) the first time a user
// opens a slide - see POST /collections/ensure - not something set up by
// hand first. This could still grow into public/private collections, or
// archiving instead of deleting, later.
public class Collections
{
    public Guid CollectionId { get; set; }
    public string SlideId { get; set; } = "";
    public string CollectionName { get; set; } = "";
    public DateTimeOffset Created { get; set; }
    public string UserId { get; set; } = "";

    // Only populated where the query actually asks for it (GET /collections
    // eager-loads these; POST /collections, /collections/ensure, and PUT
    // don't, so they come back empty there even for a collection that
    // already has real rows - those endpoints only ever need the collection
    // itself, not a hydrated read of its contents).
    public List<Annotation> Annotations { get; set; } = [];
    public List<CellCount> CellCounts { get; set; } = [];
    public List<ImageAdjustments.ImageAdjustments> ImageAdjustments { get; set; } = [];
}
