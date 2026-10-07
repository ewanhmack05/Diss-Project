using Microsoft.AspNetCore.SignalR;

namespace RealtimeHub.Slides;

// Shared count - several people adding to one count at once. Joining,
// leaving and finishing send the whole thing to everyone; dots go one at a
// time to everyone but the sender, who has already drawn theirs.
public partial class SlideHub
{
    public async Task<SharedCount> StartSharedCount(SharedCountSettings settings)
    {
        if (settings is null) throw new HubException("settings are required");
        if (settings.RoiGeoJson is { Length: > MaxRoiGeoJsonLength })
            throw new HubException($"settings.roiGeoJson is longer than {MaxRoiGeoJsonLength} characters");
        if (settings.DotSize <= 0) throw new HubException("settings.dotSize must be above 0");
        if (!double.IsFinite(settings.MatchRadius) || settings.MatchRadius <= 0)
            throw new HubException("settings.matchRadius must be above 0");

        var change = Counting(() => rooms.StartSharedCount(Context.ConnectionId, settings)) ?? throw NotJoined();
        await Broadcast(change);
        return change.SharedCount!;
    }

    public async Task JoinSharedCount(Guid sharedCountId)
    {
        var change = Counting(() => rooms.JoinSharedCount(Context.ConnectionId, sharedCountId)) ?? throw NotJoined();
        await Broadcast(change);
    }

    // Declines an invite or stops counting. Your dots stay in the count.
    public async Task LeaveSharedCount(Guid sharedCountId)
    {
        var change = rooms.LeaveSharedCount(Context.ConnectionId, sharedCountId);
        if (change is not null) await Broadcast(change);
    }

    public async Task AddSharedDot(Guid sharedCountId, SharedDot dot)
    {
        if (dot is null) throw new HubException("dot is required");
        if (dot.Id == Guid.Empty) throw new HubException("dot.id is required");
        if (!double.IsFinite(dot.X) || !double.IsFinite(dot.Y)) throw new HubException("dot needs a finite x and y");
        if (string.IsNullOrWhiteSpace(dot.Colour)) throw new HubException("dot.colour is required");

        var (roomId, stored) = Counting(() => rooms.AddSharedDot(Context.ConnectionId, sharedCountId, dot)) ?? throw NotJoined();
        await Clients.OthersInGroup(GroupName(roomId)).SharedDotAdded(new SharedDotAdded(sharedCountId, stored));
    }

    public async Task RemoveSharedDot(Guid sharedCountId, Guid dotId)
    {
        var roomId = Counting(() => rooms.RemoveSharedDot(Context.ConnectionId, sharedCountId, dotId)) ?? throw NotJoined();
        await Clients.OthersInGroup(GroupName(roomId)).SharedDotRemoved(new SharedDotRemoved(sharedCountId, dotId));
    }

    // Host only - ends it for everyone.
    public async Task FinishSharedCount(Guid sharedCountId)
    {
        var change = Counting(() => rooms.FinishSharedCount(Context.ConnectionId, sharedCountId)) ?? throw NotJoined();
        await Broadcast(change);
    }

    private Task Broadcast(SharedCountChange change) =>
        Clients.Group(GroupName(change.RoomId)).SharedCountChanged(change.SharedCount);
}
