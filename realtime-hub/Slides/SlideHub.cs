using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using RealtimeHub.Auth;

namespace RealtimeHub.Slides;

// What the hub can call on a client. Method names are what the JS client
// listens for with connection.on("UserJoined", ...).
public interface ISlideClient
{
    Task UserJoined(Participant participant);
    Task UserLeft(string connectionId);
    Task ViewportUpdated(ViewportUpdate update);
    Task SketchUpdated(SketchUpdate update);
    Task ScreenUpdated(ScreenUpdate update);
    Task NavigationChanged(NavigationMode mode);
    // Only to them and the host - nobody else needs to know.
    Task ParticipantUpdated(Participant participant);
    Task RequestReceived(HostRequest request);
    Task AnnotationOp(StampedOp op);
    Task DocUpdated(DocUpdate update);
    Task DocEditorsChanged(DocEditors editors);
    // Null once it's been dropped.
    Task ComparisonChanged(Comparison? comparison);
    // Null once it's been finished or dropped.
    Task SharedCountChanged(SharedCount? sharedCount);
    Task SharedDotAdded(SharedDotAdded added);
    Task SharedDotRemoved(SharedDotRemoved removed);
}

// One SignalR group per room, and a room is a session - its collection's
// id (see JoinSession). A connection is in at most one room at a
// time - joining another just moves it. Everyone is signed in (see
// Program.cs), and who they are comes from their Keycloak token.
// Each open shared doc gets its own group inside the room. Shared count
// methods are in SlideHub.SharedCount.cs.
public partial class SlideHub(SlideRooms rooms, ISessionAccess sessions, ILogger<SlideHub> logger) : Hub<ISlideClient>
{
    public const int MaxDocIdLength = 128;
    public const int MaxDocUpdateBytes = 64 * 1024;
    public const int MaxRoiGeoJsonLength = 16 * 1024;
    public const int MaxComparisonDots = 10_000;
    public const int MaxSharedDots = 10_000;
    public const int MaxScreenLength = 4 * 1024;
    public const int MaxSketchTools = 8;
    public const int MaxSketchToolLength = 32;
    public const int MaxRequestKindLength = 32;
    public const int MaxRequestDataLength = 4 * 1024;

    public static string GroupName(string roomId) => $"room:{roomId}";
    public static string DocGroupName(string roomId, string docId) => $"doc:{roomId}:{docId}";

    // roomId is the session's collection id. Only people in the session get
    // in - annotation-store says who is (see SessionAccess).
    public async Task<JoinResult> JoinSession(string roomId)
    {
        if (string.IsNullOrWhiteSpace(roomId)) throw new HubException("roomId is required");
        var user = Context.User ?? throw new HubException("Sign in first");
        var userId = user.UserId();
        var role = await sessions.RoleInAsync(roomId, userId, AccessToken(), Context.ConnectionAborted)
            ?? throw new HubException("You're not in that session, or it's ended");

        await LeaveCurrentRoom();

        var result = rooms.Join(roomId, Context.ConnectionId, userId, user.DisplayName(), role);
        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(roomId));
        await Clients.OthersInGroup(GroupName(roomId)).UserJoined(result.Me);
        // They've just been added to it as invited, so everyone else's list is out of date.
        if (result.Comparison is { Revealed: false })
            await Clients.OthersInGroup(GroupName(roomId)).ComparisonChanged(result.Comparison);
        if (result.SharedCount is not null)
            await Clients.OthersInGroup(GroupName(roomId)).SharedCountChanged(result.SharedCount);

        logger.LogInformation("{UserId} joined session {RoomId} ({Count} others)",
            userId, roomId, result.Others.Count);
        return result;
    }

    public Task LeaveSession() => LeaveCurrentRoom();

    // Clients throttle this to ~10/sec, the hub just passes it on.
    public async Task UpdateViewport(Viewport viewport)
    {
        var me = rooms.SetViewport(Context.ConnectionId, viewport) ?? throw NotJoined();
        await Clients.OthersInGroup(GroupName(me.RoomId))
            .ViewportUpdated(new ViewportUpdate(Context.ConnectionId, viewport));
    }

    // Kept on the participant like the viewport, one per tool - a new one
    // for a tool replaces that tool's last one.
    public async Task UpdateSketch(Sketch sketch)
    {
        if (sketch is null) throw new HubException("sketch is required - ClearSketch clears one");
        ValidateTool(sketch.Tool, "sketch.tool");
        // A missing data field can't be serialised back out, so it would
        // break the relay rather than just this call.
        if (sketch.Data.ValueKind == JsonValueKind.Undefined)
            throw new HubException("sketch.data is required");

        var me = Counting(() => rooms.SetSketch(Context.ConnectionId, sketch.Tool, sketch)) ?? throw NotJoined();
        await Clients.OthersInGroup(GroupName(me.RoomId))
            .SketchUpdated(new SketchUpdate(Context.ConnectionId, sketch.Tool, sketch));
    }

    // Done or given up with that tool. The others stay.
    public async Task ClearSketch(string tool)
    {
        ValidateTool(tool, "tool");
        var me = rooms.SetSketch(Context.ConnectionId, tool, null) ?? throw NotJoined();
        await Clients.OthersInGroup(GroupName(me.RoomId))
            .SketchUpdated(new SketchUpdate(Context.ConnectionId, tool, null));
    }

    private static void ValidateTool(string tool, string name)
    {
        if (string.IsNullOrWhiteSpace(tool)) throw new HubException($"{name} is required");
        if (tool.Length > MaxSketchToolLength) throw new HubException($"{name} is longer than {MaxSketchToolLength} characters");
    }

    // What's on screen besides the map, for Present. Kept on the participant
    // like the viewport, so someone joining a Present part way through gets
    // the host's. The hub doesn't look inside it.
    public async Task UpdateScreen(JsonElement screen)
    {
        if (screen.ValueKind != JsonValueKind.Object) throw new HubException("screen has to be an object");
        if (screen.GetRawText().Length > MaxScreenLength)
            throw new HubException($"screen is longer than {MaxScreenLength} characters");

        var me = rooms.SetScreen(Context.ConnectionId, screen) ?? throw NotJoined();
        await Clients.OthersInGroup(GroupName(me.RoomId))
            .ScreenUpdated(new ScreenUpdate(Context.ConnectionId, screen));
    }

    // After the host changes your role - checked with annotation-store, not
    // taken from the client. Going view only takes you out of any count.
    // Taken out of the session altogether is left to the client, which
    // leaves the room once it sees that.
    public async Task RefreshRole()
    {
        var me = rooms.Get(Context.ConnectionId) ?? throw NotJoined();
        var role = await sessions.RoleInAsync(me.RoomId, me.UserId, AccessToken(), Context.ConnectionAborted);
        if (role is null) return;
        var change = rooms.SetRole(Context.ConnectionId, role.Value);
        if (change is null) return;
        await Clients.Clients([Context.ConnectionId, .. change.Hosts]).ParticipantUpdated(change.Participant);
        if (change.Comparison is not null) await Broadcast(change.Comparison);
        if (change.SharedCount is not null) await Broadcast(change.SharedCount);
    }

    // Host only. to is connection ids, or null for everyone else in the room.
    // Anyone named who isn't in the room is skipped.
    public async Task SendRequest(IReadOnlyList<string>? to, string kind, JsonElement? data)
    {
        if (string.IsNullOrWhiteSpace(kind) || kind.Length > MaxRequestKindLength)
            throw new HubException($"kind is required, up to {MaxRequestKindLength} characters");
        if (data is { } d && d.GetRawText().Length > MaxRequestDataLength)
            throw new HubException($"data is longer than {MaxRequestDataLength} characters");
        var me = rooms.Get(Context.ConnectionId) ?? throw NotJoined();
        var targets = rooms.RequestTargets(Context.ConnectionId, to)
            ?? throw new HubException("Only the host can ask people to do things");
        if (targets.Count == 0) return;
        await Clients.Clients(targets).RequestReceived(new HostRequest(Context.ConnectionId, me.DisplayName, kind, data));
    }

    // Host only. Goes to everyone, host included.
    public async Task SetNavigation(NavigationMode mode)
    {
        if (!Enum.IsDefined(mode)) throw new HubException("Unknown navigation mode");
        if (rooms.Get(Context.ConnectionId) is null) throw NotJoined();
        var roomId = rooms.SetNavigation(Context.ConnectionId, mode)
            ?? throw new HubException("Only the host can change how people move round");
        await Clients.Group(GroupName(roomId)).NavigationChanged(mode);
    }

    // Relay only - the sender still saves to annotation-store itself for now.
    // Returns the stamped op so the sender knows its seq too.
    public async Task<StampedOp> SendAnnotationOp(AnnotationOp op)
    {
        if (op.Id == Guid.Empty) throw new HubException("op.id is required");
        // A collection op is just a nudge to fetch the session again, so it has no data.
        if (op.Kind != OpKind.Delete && op.Entity != OpEntity.Collection && op.Data is null)
            throw new HubException("op.data is required for create/update");

        var me = rooms.Get(Context.ConnectionId) ?? throw NotJoined();
        var stamped = rooms.Stamp(Context.ConnectionId, op) ?? throw NotJoined();
        await Clients.OthersInGroup(GroupName(me.RoomId)).AnnotationOp(stamped);
        return stamped;
    }

    // Starts a comparison count on the host's ROI, inviting everyone else in
    // the room. The host is counting straight away.
    public async Task<Comparison> StartComparison(ComparisonSettings settings)
    {
        if (settings is null) throw new HubException("settings are required");
        if (string.IsNullOrWhiteSpace(settings.RoiGeoJson)) throw new HubException("settings.roiGeoJson is required");
        if (settings.RoiGeoJson.Length > MaxRoiGeoJsonLength)
            throw new HubException($"settings.roiGeoJson is longer than {MaxRoiGeoJsonLength} characters");
        if (settings.DotSize <= 0) throw new HubException("settings.dotSize must be above 0");
        if (!double.IsFinite(settings.MatchRadius) || settings.MatchRadius <= 0)
            throw new HubException("settings.matchRadius must be above 0");

        var change = Counting(() => rooms.StartComparison(Context.ConnectionId, settings)) ?? throw NotJoined();
        await Broadcast(change);
        return change.Comparison!.Blind();
    }

    public async Task JoinComparison(Guid comparisonId)
    {
        var change = Counting(() => rooms.JoinComparison(Context.ConnectionId, comparisonId)) ?? throw NotJoined();
        await Broadcast(change);
    }

    // Declines an invite, gives up part way, or closes the results.
    public async Task LeaveComparison(Guid comparisonId)
    {
        var change = rooms.LeaveComparison(Context.ConnectionId, comparisonId);
        if (change is not null) await Broadcast(change);
    }

    public async Task SubmitComparison(Guid comparisonId, IReadOnlyList<ComparisonDot> dots)
    {
        if (dots is null) throw new HubException("dots are required");
        if (dots.Count > MaxComparisonDots) throw new HubException($"More than {MaxComparisonDots} dots");
        if (dots.Any(d => d is null || !double.IsFinite(d.X) || !double.IsFinite(d.Y)))
            throw new HubException("Every dot needs a finite x and y");

        var change = Counting(() => rooms.SubmitComparison(Context.ConnectionId, comparisonId, dots)) ?? throw NotJoined();
        await Broadcast(change);
    }

    // The seed is only used if nobody has the doc open yet.
    public async Task<DocState> OpenDoc(string docId, byte[] seed)
    {
        ValidateDocId(docId);
        ValidateUpdate(seed, "seed");
        var me = rooms.Get(Context.ConnectionId) ?? throw NotJoined();
        var group = DocGroupName(me.RoomId, docId);

        // Into the group before the snapshot, so any update that lands after
        // it still reaches us. Getting one twice is harmless to Yjs, missing
        // one isn't.
        await Groups.AddToGroupAsync(Context.ConnectionId, group);
        var state = rooms.OpenDoc(Context.ConnectionId, me.RoomId, docId, seed);
        if (state is null)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, group);
            throw NotJoined();
        }

        await Clients.OthersInGroup(group).DocEditorsChanged(new DocEditors(docId, state.Editors));
        logger.LogInformation("{UserId} opened doc {DocId} on {RoomId} ({Editors} editors, {Updates} updates)",
            me.UserId, docId, me.RoomId, state.Editors.Count, state.Updates.Count);
        return state;
    }

    public async Task SendDocUpdate(string docId, byte[] update)
    {
        ValidateUpdate(update, "update");
        var me = rooms.Get(Context.ConnectionId) ?? throw NotJoined();
        if (docId is null || !rooms.AppendDocUpdate(Context.ConnectionId, me.RoomId, docId, update))
            throw new HubException("Open the doc first");

        await Clients.OthersInGroup(DocGroupName(me.RoomId, docId))
            .DocUpdated(new DocUpdate(docId, Context.ConnectionId, update));
    }

    public async Task CloseDoc(string docId)
    {
        if (docId is null) return;
        var closed = rooms.CloseDoc(Context.ConnectionId, docId);
        if (closed is null) return;
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, DocGroupName(closed.RoomId, docId));
        await AfterDocClosed(closed);
    }

    // SignalR drops the connection from its groups on its own, but the
    // room still needs tidying and everyone else needs telling.
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var left = rooms.Leave(Context.ConnectionId);
        if (left is not null)
        {
            var me = left.Participant;
            await Clients.Group(GroupName(me.RoomId)).UserLeft(me.ConnectionId);
            foreach (var doc in left.Docs) await AfterDocClosed(doc);
            if (left.Comparison is not null) await Broadcast(left.Comparison);
            if (left.SharedCount is not null) await Broadcast(left.SharedCount);
            logger.LogInformation("{UserId} dropped from session {RoomId}", me.UserId, me.RoomId);
        }
        await base.OnDisconnectedAsync(exception);
    }

    private async Task LeaveCurrentRoom()
    {
        var left = rooms.Leave(Context.ConnectionId);
        if (left is null) return;
        var me = left.Participant;
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(me.RoomId));
        foreach (var doc in left.Docs)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, DocGroupName(doc.RoomId, doc.DocId));
            await AfterDocClosed(doc);
        }
        await Clients.Group(GroupName(me.RoomId)).UserLeft(me.ConnectionId);
        if (left.Comparison is not null) await Broadcast(left.Comparison);
        if (left.SharedCount is not null) await Broadcast(left.SharedCount);
    }

    // Everyone in the room gets it, sender included, so there's one path
    // for keeping the client's copy up to date.
    private Task Broadcast(ComparisonChange change) =>
        Clients.Group(GroupName(change.RoomId)).ComparisonChanged(change.Comparison?.Blind());

    // Turns the rooms' CountException into a HubException, so the reason
    // gets back to the caller.
    private static T Counting<T>(Func<T> call)
    {
        try
        {
            return call();
        }
        catch (CountException e)
        {
            throw new HubException(e.Message);
        }
    }

    // Tell whoever still has the doc open, or note that it's gone.
    private async Task AfterDocClosed(ClosedDoc doc)
    {
        if (doc.Editors.Count > 0)
        {
            await Clients.Group(DocGroupName(doc.RoomId, doc.DocId))
                .DocEditorsChanged(new DocEditors(doc.DocId, doc.Editors));
        }
        else
        {
            logger.LogInformation("Dropped doc {DocId} on {RoomId} ({Updates} updates)",
                doc.DocId, doc.RoomId, doc.Updates);
        }
    }

    private static void ValidateDocId(string docId)
    {
        if (string.IsNullOrWhiteSpace(docId)) throw new HubException("docId is required");
        if (docId.Length > MaxDocIdLength) throw new HubException($"docId is longer than {MaxDocIdLength} characters");
    }

    private static void ValidateUpdate(byte[] bytes, string name)
    {
        if (bytes is null || bytes.Length == 0) throw new HubException($"{name} is required");
        if (bytes.Length > MaxDocUpdateBytes) throw new HubException($"{name} is bigger than {MaxDocUpdateBytes} bytes");
    }

    // The token this connection signed in with, to ask annotation-store on
    // the user's behalf. Browsers send it as ?access_token=, anything else in
    // the usual header.
    private string AccessToken()
    {
        var request = Context.GetHttpContext()?.Request;
        if (request is null) return "";
        var fromQuery = request.Query["access_token"].FirstOrDefault();
        if (!string.IsNullOrEmpty(fromQuery)) return fromQuery;
        var header = request.Headers.Authorization.FirstOrDefault() ?? "";
        return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header["Bearer ".Length..] : "";
    }

    private static HubException NotJoined() => new("Join a session first");
}
