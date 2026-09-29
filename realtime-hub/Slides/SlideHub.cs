using Microsoft.AspNetCore.SignalR;

namespace RealtimeHub.Slides;

// What the hub can call on a client. Method names are what the JS client
// listens for with connection.on("UserJoined", ...).
public interface ISlideClient
{
    Task UserJoined(Participant participant);
    Task UserLeft(string connectionId);
    Task ViewportUpdated(ViewportUpdate update);
    Task AnnotationOp(StampedOp op);
}

// One SignalR group per slide. A connection is in at most one slide at a
// time - joining another just moves it. No auth yet, so userId/displayName
// are whatever the client says (fake users for now, sessions come later).
public class SlideHub(SlideRooms rooms, ILogger<SlideHub> logger) : Hub<ISlideClient>
{
    public static string GroupName(string slideId) => $"slide:{slideId}";

    public async Task<JoinResult> JoinSlide(string slideId, string userId, string displayName)
    {
        if (string.IsNullOrWhiteSpace(slideId)) throw new HubException("slideId is required");
        if (string.IsNullOrWhiteSpace(userId)) throw new HubException("userId is required");

        await LeaveCurrentSlide();

        var result = rooms.Join(slideId, Context.ConnectionId, userId,
            string.IsNullOrWhiteSpace(displayName) ? userId : displayName);
        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(slideId));
        await Clients.OthersInGroup(GroupName(slideId)).UserJoined(result.Me);

        logger.LogInformation("{UserId} joined slide {SlideId} ({Count} others)",
            userId, slideId, result.Others.Count);
        return result;
    }

    public Task LeaveSlide() => LeaveCurrentSlide();

    // Clients throttle this to ~10/sec, the hub just passes it on.
    public async Task UpdateViewport(Viewport viewport)
    {
        var me = rooms.SetViewport(Context.ConnectionId, viewport) ?? throw NotJoined();
        await Clients.OthersInGroup(GroupName(me.SlideId))
            .ViewportUpdated(new ViewportUpdate(Context.ConnectionId, viewport));
    }

    // Relay only - the sender still saves to annotation-store itself for now.
    // Returns the stamped op so the sender knows its seq too.
    public async Task<StampedOp> SendAnnotationOp(AnnotationOp op)
    {
        if (op.Id == Guid.Empty) throw new HubException("op.id is required");
        if (op.Kind != OpKind.Delete && op.Data is null) throw new HubException("op.data is required for create/update");

        var me = rooms.Get(Context.ConnectionId) ?? throw NotJoined();
        var stamped = rooms.Stamp(Context.ConnectionId, op) ?? throw NotJoined();
        await Clients.OthersInGroup(GroupName(me.SlideId)).AnnotationOp(stamped);
        return stamped;
    }

    // SignalR drops the connection from its groups on its own, but the
    // room still needs tidying and everyone else needs telling.
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var left = rooms.Leave(Context.ConnectionId);
        if (left is not null)
        {
            await Clients.Group(GroupName(left.SlideId)).UserLeft(left.ConnectionId);
            logger.LogInformation("{UserId} dropped from slide {SlideId}", left.UserId, left.SlideId);
        }
        await base.OnDisconnectedAsync(exception);
    }

    private async Task LeaveCurrentSlide()
    {
        var left = rooms.Leave(Context.ConnectionId);
        if (left is null) return;
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(left.SlideId));
        await Clients.Group(GroupName(left.SlideId)).UserLeft(left.ConnectionId);
    }

    private static HubException NotJoined() => new("Join a slide first");
}
