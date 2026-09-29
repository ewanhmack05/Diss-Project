using System.Text.Json;
using System.Text.Json.Serialization;

namespace RealtimeHub.Slides;

// Everything that goes over the wire. Kept separate from annotation-store's
// models on purpose - the hub just relays, so op data is an opaque blob and
// this service doesn't break when that schema changes.

// One connection in a slide room. Keyed by connection, not user, so the same
// user in two tabs shows as two participants.
public record Participant(
    string ConnectionId,
    string SlideId,
    string UserId,
    string DisplayName,
    string Colour,
    DateTimeOffset Joined,
    Viewport? Viewport = null,
    Sketch? Sketch = null);

// OpenLayers view state. Extent is the view box before rotation, in map
// units - turn it by Rotation round Center to get what's actually on screen.
// Saves everyone else working it out from a screen size they don't know.
public record Viewport(double[] Center, double Resolution, double Rotation, double[] Extent);

public record ViewportUpdate(string ConnectionId, Viewport Viewport);

// Whatever someone is part way through drawing, so others see it take shape
// before it's saved. Tool is "annotation", "ruler" etc, Data is opaque.
public record Sketch(string Tool, JsonElement Data);

// Sketch is null once they finish or give up.
public record SketchUpdate(string ConnectionId, Sketch? Sketch);

public enum OpKind { Create, Update, Delete }

// Image adjustments stay personal, so they aren't here.
public enum OpEntity { Annotation, CellCount }

public record AnnotationOp(OpKind Kind, OpEntity Entity, Guid Id, JsonElement? Data = null);

// Seq is per room and only ever goes up, so clients can spot a gap or
// order two edits to the same thing. Resets when the room empties.
public record StampedOp(long Seq, DateTimeOffset ServerTime, string ConnectionId, string UserId, AnnotationOp Op);

// Shared docs hold raw Yjs updates the hub never reads. byte[] goes over the
// wire as base64. Seeded is true for whoever created the doc with their seed;
// InstanceId changes each time a doc is dropped and recreated, so a client can
// tell whether the history it has matches the hub's.
public record DocState(string DocId, Guid InstanceId, bool Seeded, IReadOnlyList<byte[]> Updates, IReadOnlyList<string> Editors);

public record DocUpdate(string DocId, string ConnectionId, byte[] Update);

// Connection ids, in the order they opened the doc.
public record DocEditors(string DocId, IReadOnlyList<string> Editors);

public record JoinResult(Participant Me, IReadOnlyList<Participant> Others, long Seq);

public static class HubJson
{
    // camelCase enums so the TS side can send "create" rather than 0.
    // Shared with the tests so both ends agree.
    public static void Configure(JsonSerializerOptions options) =>
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
}
