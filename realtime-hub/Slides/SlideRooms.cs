namespace RealtimeHub.Slides;

// Who's in which slide room. In memory only - fine while there's one copy
// of the hub (see docs/libraries.md), and nothing here needs to survive a
// restart since clients just rejoin.
public class SlideRooms
{
    private static readonly string[] Palette =
    [
        "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
        "#42d4f4", "#f032e6", "#9a6324", "#469990", "#800000",
    ];

    private readonly Lock _lock = new();
    private readonly Dictionary<string, Room> _rooms = new();
    private readonly Dictionary<string, string> _slideByConnection = new();

    private class Room
    {
        public Dictionary<string, Participant> Participants { get; } = new();
        public long Seq;
    }

    public JoinResult Join(string slideId, string connectionId, string userId, string displayName)
    {
        lock (_lock)
        {
            if (!_rooms.TryGetValue(slideId, out var room))
            {
                room = new Room();
                _rooms[slideId] = room;
            }

            var me = new Participant(connectionId, slideId, userId, displayName,
                PickColour(room), DateTimeOffset.UtcNow);
            var others = room.Participants.Values.ToList();

            room.Participants[connectionId] = me;
            _slideByConnection[connectionId] = slideId;
            return new JoinResult(me, others, room.Seq);
        }
    }

    public Participant? Leave(string connectionId)
    {
        lock (_lock)
        {
            if (!_slideByConnection.Remove(connectionId, out var slideId)) return null;
            var room = _rooms[slideId];
            room.Participants.Remove(connectionId, out var participant);
            if (room.Participants.Count == 0) _rooms.Remove(slideId);
            return participant;
        }
    }

    public Participant? Get(string connectionId)
    {
        lock (_lock)
        {
            return _slideByConnection.TryGetValue(connectionId, out var slideId)
                ? _rooms[slideId].Participants[connectionId]
                : null;
        }
    }

    // Kept so someone joining late can see where everyone already is.
    public Participant? SetViewport(string connectionId, Viewport viewport)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var slideId)) return null;
            var participants = _rooms[slideId].Participants;
            var updated = participants[connectionId] with { Viewport = viewport };
            participants[connectionId] = updated;
            return updated;
        }
    }

    public StampedOp? Stamp(string connectionId, AnnotationOp op)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var slideId)) return null;
            var room = _rooms[slideId];
            var sender = room.Participants[connectionId];
            return new StampedOp(++room.Seq, DateTimeOffset.UtcNow, connectionId, sender.UserId, op);
        }
    }

    public IReadOnlyList<Participant> InSlide(string slideId)
    {
        lock (_lock)
        {
            return _rooms.TryGetValue(slideId, out var room)
                ? room.Participants.Values.ToList()
                : [];
        }
    }

    public IReadOnlyDictionary<string, int> Summary()
    {
        lock (_lock)
        {
            return _rooms.ToDictionary(r => r.Key, r => r.Value.Participants.Count);
        }
    }

    // First colour nobody in the room has, or wrap round once they're all taken.
    private static string PickColour(Room room)
    {
        var used = room.Participants.Values.Select(p => p.Colour).ToHashSet();
        return Palette.FirstOrDefault(c => !used.Contains(c))
            ?? Palette[room.Participants.Count % Palette.Length];
    }
}
