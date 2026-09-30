namespace RealtimeHub.Slides;

// A doc this connection no longer has open. No editors left means it was
// dropped, and Updates is how many it was holding.
public record ClosedDoc(string SlideId, string DocId, IReadOnlyList<string> Editors, int Updates);

// Comparison is null once it's been dropped.
public record ComparisonChange(string SlideId, Comparison? Comparison);

// SharedCount is null once it's been dropped or finished.
public record SharedCountChange(string SlideId, SharedCount? SharedCount);

// Comparison and SharedCount are only set if they were part of one.
public record LeaveResult(
    Participant Participant,
    IReadOnlyList<ClosedDoc> Docs,
    ComparisonChange? Comparison,
    SharedCountChange? SharedCount);

// Thrown for comparison or shared count calls that don't fit its current
// state, e.g. joining one that's already revealed. The message goes back
// to the client.
public class CountException(string message) : Exception(message);

public record DocSummary(string DocId, Guid InstanceId, int Editors, int Updates, long Bytes);

// Who's in which slide room. In memory only - fine while there's one copy
// of the hub (see docs/libraries.md), and nothing here needs to survive a
// restart since clients just rejoin.
// Shared counts are in SharedCounts.cs.
public partial class SlideRooms
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
        public Dictionary<string, SharedDoc> Docs { get; } = new();
        public long Seq;
        // One of each at a time per slide.
        public Comparison? Comparison;
        public SharedCountState? SharedCount;
    }

    private class SharedDoc
    {
        public Guid InstanceId { get; } = Guid.NewGuid();
        public List<byte[]> Updates { get; } = new();
        public List<string> Editors { get; } = new();
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

            // Turning up part way through still gets you an invite.
            if (room.Comparison is { Revealed: false } running)
            {
                room.Comparison = running with
                {
                    Counters = [.. running.Counters, new Counter(connectionId, me.DisplayName, me.Colour, CounterState.Invited)],
                };
            }
            room.SharedCount?.Contributors.Add(new Contributor(connectionId, me.UserId, me.DisplayName, me.Colour, ContributorState.Invited));
            return new JoinResult(me, others, room.Seq, room.Comparison?.Blind(), room.SharedCount?.Snapshot());
        }
    }

    public LeaveResult? Leave(string connectionId)
    {
        lock (_lock)
        {
            if (!_slideByConnection.Remove(connectionId, out var slideId)) return null;
            var room = _rooms[slideId];
            room.Participants.Remove(connectionId, out var participant);

            var openDocs = room.Docs
                .Where(d => d.Value.Editors.Contains(connectionId))
                .Select(d => d.Key)
                .ToList();
            var docs = openDocs.Select(docId => CloseDoc(room, slideId, docId, connectionId)).ToList();
            var comparison = RemoveCounter(room, connectionId) ? new ComparisonChange(slideId, room.Comparison) : null;
            var sharedCount = RemoveContributor(room, connectionId)
                ? new SharedCountChange(slideId, room.SharedCount?.Snapshot())
                : null;

            if (room.Participants.Count == 0) _rooms.Remove(slideId);
            return new LeaveResult(participant!, docs, comparison, sharedCount);
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

    public Participant? SetSketch(string connectionId, Sketch? sketch)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var slideId)) return null;
            var participants = _rooms[slideId].Participants;
            var updated = participants[connectionId] with { Sketch = sketch };
            participants[connectionId] = updated;
            return updated;
        }
    }

    // The seed only counts if this call creates the doc. Opening twice is fine.
    // Null if the connection isn't in that slide any more.
    public DocState? OpenDoc(string connectionId, string slideId, string docId, byte[] seed)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var current) || current != slideId) return null;
            var room = _rooms[slideId];

            var seeded = false;
            if (!room.Docs.TryGetValue(docId, out var doc))
            {
                doc = new SharedDoc();
                doc.Updates.Add(seed);
                room.Docs[docId] = doc;
                seeded = true;
            }
            if (!doc.Editors.Contains(connectionId)) doc.Editors.Add(connectionId);

            return new DocState(docId, doc.InstanceId, seeded, doc.Updates.ToList(), doc.Editors.ToList());
        }
    }

    // False if the connection doesn't have this doc open.
    public bool AppendDocUpdate(string connectionId, string slideId, string docId, byte[] update)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var current) || current != slideId) return false;
            if (!_rooms[slideId].Docs.TryGetValue(docId, out var doc) || !doc.Editors.Contains(connectionId)) return false;
            doc.Updates.Add(update);
            return true;
        }
    }

    // Null if it wasn't open.
    public ClosedDoc? CloseDoc(string connectionId, string docId)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var slideId)) return null;
            var room = _rooms[slideId];
            if (!room.Docs.TryGetValue(docId, out var doc) || !doc.Editors.Contains(connectionId)) return null;
            return CloseDoc(room, slideId, docId, connectionId);
        }
    }

    public IReadOnlyList<DocSummary> DocsInSlide(string slideId)
    {
        lock (_lock)
        {
            return _rooms.TryGetValue(slideId, out var room)
                ? room.Docs.Select(d => new DocSummary(d.Key, d.Value.InstanceId, d.Value.Editors.Count,
                    d.Value.Updates.Count, d.Value.Updates.Sum(u => (long)u.Length))).ToList()
                : [];
        }
    }

    // Everyone else in the room is invited. A revealed one gets replaced,
    // one still going doesn't. Null if the connection isn't in a slide.
    public ComparisonChange? StartComparison(string connectionId, ComparisonSettings settings)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var slideId)) return null;
            var room = _rooms[slideId];
            if (room.Comparison is { Revealed: false }) throw new CountException("A comparison is already running");

            var counters = room.Participants.Values
                .OrderBy(p => p.ConnectionId == connectionId ? 0 : 1)
                .Select(p => new Counter(p.ConnectionId, p.DisplayName, p.Colour,
                    p.ConnectionId == connectionId ? CounterState.Counting : CounterState.Invited))
                .ToList();
            room.Comparison = new Comparison(Guid.NewGuid(), connectionId, settings, DateTimeOffset.UtcNow, false, counters);
            return new ComparisonChange(slideId, room.Comparison);
        }
    }

    public ComparisonChange? JoinComparison(string connectionId, Guid comparisonId)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var slideId)) return null;
            var room = _rooms[slideId];
            var comparison = Current(room, comparisonId);
            if (comparison.Revealed) throw new CountException("That comparison has finished");
            var me = comparison.Counters.FirstOrDefault(c => c.ConnectionId == connectionId);
            if (me?.State != CounterState.Invited) throw new CountException("You're not invited to that comparison");

            room.Comparison = WithCounter(comparison, me with { State = CounterState.Counting });
            return new ComparisonChange(slideId, room.Comparison);
        }
    }

    // Declining, giving up part way, or closing the results. Null if they
    // weren't in it, so there's nothing to tell anyone.
    public ComparisonChange? LeaveComparison(string connectionId, Guid comparisonId)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var slideId)) return null;
            var room = _rooms[slideId];
            if (room.Comparison?.Id != comparisonId) return null;
            return RemoveCounter(room, connectionId) ? new ComparisonChange(slideId, room.Comparison) : null;
        }
    }

    public ComparisonChange? SubmitComparison(string connectionId, Guid comparisonId, IReadOnlyList<ComparisonDot> dots)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var slideId)) return null;
            var room = _rooms[slideId];
            var comparison = Current(room, comparisonId);
            var me = comparison.Counters.FirstOrDefault(c => c.ConnectionId == connectionId);
            if (me?.State != CounterState.Counting) throw new CountException("You're not counting in that comparison");

            room.Comparison = Settle(WithCounter(comparison, me with { State = CounterState.Submitted, Dots = dots.ToList() }));
            return new ComparisonChange(slideId, room.Comparison);
        }
    }

    public Comparison? ComparisonInSlide(string slideId)
    {
        lock (_lock)
        {
            return _rooms.TryGetValue(slideId, out var room) ? room.Comparison?.Blind() : null;
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

    // Caller holds the lock. Once the last editor goes the doc goes too, and
    // the next opener starts it again from their own seed.
    private static ClosedDoc CloseDoc(Room room, string slideId, string docId, string connectionId)
    {
        var doc = room.Docs[docId];
        doc.Editors.Remove(connectionId);
        if (doc.Editors.Count == 0) room.Docs.Remove(docId);
        return new ClosedDoc(slideId, docId, doc.Editors.ToList(), doc.Updates.Count);
    }

    private static Comparison Current(Room room, Guid comparisonId) =>
        room.Comparison?.Id == comparisonId
            ? room.Comparison
            : throw new CountException("That comparison isn't running any more");

    private static Comparison WithCounter(Comparison comparison, Counter counter) =>
        comparison with
        {
            Counters = comparison.Counters.Select(c => c.ConnectionId == counter.ConnectionId ? counter : c).ToList(),
        };

    // Caller holds the lock. False if they weren't in the comparison.
    private static bool RemoveCounter(Room room, string connectionId)
    {
        var comparison = room.Comparison;
        if (comparison is null || comparison.Counters.All(c => c.ConnectionId != connectionId)) return false;
        room.Comparison = Settle(comparison with
        {
            Counters = comparison.Counters.Where(c => c.ConnectionId != connectionId).ToList(),
        });
        return true;
    }

    // Reveals once nobody is still counting and at least two have handed in -
    // anyone still sitting on an invite misses out. Dropped once it can never
    // get to two, or once everyone has closed the results.
    private static Comparison? Settle(Comparison comparison)
    {
        if (comparison.Revealed) return comparison.Counters.Count > 0 ? comparison : null;

        var counting = comparison.Counters.Count(c => c.State == CounterState.Counting);
        var submitted = comparison.Counters.Count(c => c.State == CounterState.Submitted);
        var invited = comparison.Counters.Count(c => c.State == CounterState.Invited);

        if (counting == 0 && submitted >= 2)
        {
            return comparison with
            {
                Revealed = true,
                Counters = comparison.Counters.Where(c => c.State == CounterState.Submitted).ToList(),
            };
        }
        if (counting + submitted == 0 || (counting == 0 && invited == 0)) return null;
        return comparison;
    }

    // First colour nobody in the room has, or wrap round once they're all taken.
    private static string PickColour(Room room)
    {
        var used = room.Participants.Values.Select(p => p.Colour).ToHashSet();
        return Palette.FirstOrDefault(c => !used.Contains(c))
            ?? Palette[room.Participants.Count % Palette.Length];
    }
}
