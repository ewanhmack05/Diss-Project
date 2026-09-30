namespace RealtimeHub.Slides;

// Shared count state. Kept as plain lists rather than records like the
// comparison, since dots come in one click at a time and copying the whole
// list for each would add up.
public partial class SlideRooms
{
    private class SharedCountState(Guid id, string host, SharedCountSettings settings)
    {
        public Guid Id { get; } = id;
        public string Host { get; set; } = host;
        public SharedCountSettings Settings { get; } = settings;
        public DateTimeOffset Started { get; } = DateTimeOffset.UtcNow;
        public List<Contributor> Contributors { get; } = new();
        public List<SharedDot> Dots { get; } = new();

        public SharedCount Snapshot() => new(Id, Host, Settings, Started, Contributors.ToList(), Dots.ToList());

        public Contributor? Find(string connectionId) => Contributors.FirstOrDefault(c => c.ConnectionId == connectionId);

        public void Set(Contributor contributor) =>
            Contributors[Contributors.FindIndex(c => c.ConnectionId == contributor.ConnectionId)] = contributor;
    }

    // Everyone else in the slide is invited. Null if the connection isn't in a slide.
    public SharedCountChange? StartSharedCount(string connectionId, SharedCountSettings settings)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var slideId)) return null;
            var room = _rooms[slideId];
            if (room.SharedCount is not null) throw new CountException("A shared count is already running");

            var state = new SharedCountState(Guid.NewGuid(), connectionId, settings);
            state.Contributors.AddRange(room.Participants.Values
                .OrderBy(p => p.ConnectionId == connectionId ? 0 : 1)
                .Select(p => new Contributor(p.ConnectionId, p.UserId, p.DisplayName, p.Colour,
                    p.ConnectionId == connectionId ? ContributorState.Joined : ContributorState.Invited)));
            room.SharedCount = state;
            return new SharedCountChange(slideId, state.Snapshot());
        }
    }

    // From an invite, or back in after leaving.
    public SharedCountChange? JoinSharedCount(string connectionId, Guid sharedCountId)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var slideId)) return null;
            var state = CurrentShared(_rooms[slideId], sharedCountId);
            var me = state.Find(connectionId) ?? throw new CountException("You're not invited to that shared count");
            if (me.State == ContributorState.Joined) throw new CountException("You're already in that shared count");

            state.Set(me with { State = ContributorState.Joined });
            return new SharedCountChange(slideId, state.Snapshot());
        }
    }

    // Null if they weren't in it. Their dots stay either way.
    public SharedCountChange? LeaveSharedCount(string connectionId, Guid sharedCountId)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var slideId)) return null;
            var room = _rooms[slideId];
            if (room.SharedCount?.Id != sharedCountId) return null;
            return RemoveContributor(room, connectionId) ? new SharedCountChange(slideId, room.SharedCount?.Snapshot()) : null;
        }
    }

    // Returns the dot as stored, with who placed it. Null if not in a slide.
    public (string SlideId, SharedDot Dot)? AddSharedDot(string connectionId, Guid sharedCountId, SharedDot dot)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var slideId)) return null;
            var state = JoinedShared(_rooms[slideId], sharedCountId, connectionId);
            if (state.Dots.Count >= SlideHub.MaxSharedDots) throw new CountException($"The shared count is full ({SlideHub.MaxSharedDots} dots)");
            if (state.Dots.Any(d => d.Id == dot.Id)) throw new CountException("That dot is already there");

            var stored = dot with { ConnectionId = connectionId };
            state.Dots.Add(stored);
            return (slideId, stored);
        }
    }

    // Only your own - undo, not deleting other people's.
    public string? RemoveSharedDot(string connectionId, Guid sharedCountId, Guid dotId)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var slideId)) return null;
            var state = JoinedShared(_rooms[slideId], sharedCountId, connectionId);
            var index = state.Dots.FindIndex(d => d.Id == dotId);
            if (index < 0) throw new CountException("That dot isn't there");
            if (state.Dots[index].ConnectionId != connectionId) throw new CountException("You can only remove your own dots");

            state.Dots.RemoveAt(index);
            return slideId;
        }
    }

    // Host only. Ends it for everyone - the host saves it from their own copy.
    public SharedCountChange? FinishSharedCount(string connectionId, Guid sharedCountId)
    {
        lock (_lock)
        {
            if (!_slideByConnection.TryGetValue(connectionId, out var slideId)) return null;
            var room = _rooms[slideId];
            var state = CurrentShared(room, sharedCountId);
            if (state.Host != connectionId) throw new CountException("Only the host can finish the shared count");

            room.SharedCount = null;
            return new SharedCountChange(slideId, null);
        }
    }

    public SharedCount? SharedCountInSlide(string slideId)
    {
        lock (_lock)
        {
            return _rooms.TryGetValue(slideId, out var room) ? room.SharedCount?.Snapshot() : null;
        }
    }

    private static SharedCountState CurrentShared(Room room, Guid sharedCountId) =>
        room.SharedCount?.Id == sharedCountId
            ? room.SharedCount
            : throw new CountException("That shared count isn't running any more");

    private static SharedCountState JoinedShared(Room room, Guid sharedCountId, string connectionId)
    {
        var state = CurrentShared(room, sharedCountId);
        if (state.Find(connectionId)?.State != ContributorState.Joined)
            throw new CountException("Join the shared count first");
        return state;
    }

    // Caller holds the lock. False if they weren't in it. An invite just
    // goes, but someone with dots is kept as Left so the dots keep a name.
    // Hosting passes to whoever joined first, and with nobody left in it
    // the count is dropped.
    private static bool RemoveContributor(Room room, string connectionId)
    {
        var state = room.SharedCount;
        var me = state?.Find(connectionId);
        if (state is null || me is null || me.State == ContributorState.Left) return false;

        if (me.State == ContributorState.Joined && state.Dots.Any(d => d.ConnectionId == connectionId))
            state.Set(me with { State = ContributorState.Left });
        else
            state.Contributors.Remove(me);

        var joined = state.Contributors.Where(c => c.State == ContributorState.Joined).ToList();
        if (joined.Count == 0) room.SharedCount = null;
        else if (state.Host == connectionId) state.Host = joined[0].ConnectionId;
        return true;
    }
}
