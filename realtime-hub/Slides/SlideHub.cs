using System.Text.Json;
using Microsoft.AspNetCore.SignalR;

namespace RealtimeHub.Slides;

// What the hub can call on a client. Method names are what the JS client
// listens for with connection.on("UserJoined", ...).
public interface ISlideClient
{
    Task UserJoined(Participant participant);
    Task UserLeft(string connectionId);
    Task ViewportUpdated(ViewportUpdate update);
    Task SketchUpdated(SketchUpdate update);
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

// One SignalR group per slide. A connection is in at most one slide at a
// time - joining another just moves it. No auth yet, so userId/displayName
// are whatever the client says (fake users for now, sessions come later).
// Each open shared doc gets its own group inside the slide. Shared count
// methods are in SlideHub.SharedCount.cs.
public partial class SlideHub(SlideRooms rooms, ILogger<SlideHub> logger) : Hub<ISlideClient>
{
    public const int MaxDocIdLength = 128;
    public const int MaxDocUpdateBytes = 64 * 1024;
    public const int MaxRoiGeoJsonLength = 16 * 1024;
    public const int MaxComparisonDots = 10_000;
    public const int MaxSharedDots = 10_000;

    public static string GroupName(string slideId) => $"slide:{slideId}";
    public static string DocGroupName(string slideId, string docId) => $"doc:{slideId}:{docId}";

    public async Task<JoinResult> JoinSlide(string slideId, string userId, string displayName)
    {
        if (string.IsNullOrWhiteSpace(slideId)) throw new HubException("slideId is required");
        if (string.IsNullOrWhiteSpace(userId)) throw new HubException("userId is required");

        await LeaveCurrentSlide();

        var result = rooms.Join(slideId, Context.ConnectionId, userId,
            string.IsNullOrWhiteSpace(displayName) ? userId : displayName);
        await Groups.AddToGroupAsync(Context.ConnectionId, GroupName(slideId));
        await Clients.OthersInGroup(GroupName(slideId)).UserJoined(result.Me);
        // They've just been added to it as invited, so everyone else's list is out of date.
        if (result.Comparison is { Revealed: false })
            await Clients.OthersInGroup(GroupName(slideId)).ComparisonChanged(result.Comparison);
        if (result.SharedCount is not null)
            await Clients.OthersInGroup(GroupName(slideId)).SharedCountChanged(result.SharedCount);

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

    // Null clears it. Kept on the participant like the viewport.
    public async Task UpdateSketch(Sketch? sketch)
    {
        if (sketch is not null)
        {
            if (string.IsNullOrWhiteSpace(sketch.Tool)) throw new HubException("sketch.tool is required");
            // A missing data field can't be serialised back out, so it would
            // break the relay rather than just this call.
            if (sketch.Data.ValueKind == JsonValueKind.Undefined)
                throw new HubException("sketch.data is required");
        }

        var me = rooms.SetSketch(Context.ConnectionId, sketch) ?? throw NotJoined();
        await Clients.OthersInGroup(GroupName(me.SlideId))
            .SketchUpdated(new SketchUpdate(Context.ConnectionId, sketch));
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

    // Starts a comparison count on the host's ROI, inviting everyone else in
    // the slide. The host is counting straight away.
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
        var group = DocGroupName(me.SlideId, docId);

        // Into the group before the snapshot, so any update that lands after
        // it still reaches us. Getting one twice is harmless to Yjs, missing
        // one isn't.
        await Groups.AddToGroupAsync(Context.ConnectionId, group);
        var state = rooms.OpenDoc(Context.ConnectionId, me.SlideId, docId, seed);
        if (state is null)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, group);
            throw NotJoined();
        }

        await Clients.OthersInGroup(group).DocEditorsChanged(new DocEditors(docId, state.Editors));
        logger.LogInformation("{UserId} opened doc {DocId} on {SlideId} ({Editors} editors, {Updates} updates)",
            me.UserId, docId, me.SlideId, state.Editors.Count, state.Updates.Count);
        return state;
    }

    public async Task SendDocUpdate(string docId, byte[] update)
    {
        ValidateUpdate(update, "update");
        var me = rooms.Get(Context.ConnectionId) ?? throw NotJoined();
        if (docId is null || !rooms.AppendDocUpdate(Context.ConnectionId, me.SlideId, docId, update))
            throw new HubException("Open the doc first");

        await Clients.OthersInGroup(DocGroupName(me.SlideId, docId))
            .DocUpdated(new DocUpdate(docId, Context.ConnectionId, update));
    }

    public async Task CloseDoc(string docId)
    {
        if (docId is null) return;
        var closed = rooms.CloseDoc(Context.ConnectionId, docId);
        if (closed is null) return;
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, DocGroupName(closed.SlideId, docId));
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
            await Clients.Group(GroupName(me.SlideId)).UserLeft(me.ConnectionId);
            foreach (var doc in left.Docs) await AfterDocClosed(doc);
            if (left.Comparison is not null) await Broadcast(left.Comparison);
            if (left.SharedCount is not null) await Broadcast(left.SharedCount);
            logger.LogInformation("{UserId} dropped from slide {SlideId}", me.UserId, me.SlideId);
        }
        await base.OnDisconnectedAsync(exception);
    }

    private async Task LeaveCurrentSlide()
    {
        var left = rooms.Leave(Context.ConnectionId);
        if (left is null) return;
        var me = left.Participant;
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupName(me.SlideId));
        foreach (var doc in left.Docs)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, DocGroupName(doc.SlideId, doc.DocId));
            await AfterDocClosed(doc);
        }
        await Clients.Group(GroupName(me.SlideId)).UserLeft(me.ConnectionId);
        if (left.Comparison is not null) await Broadcast(left.Comparison);
        if (left.SharedCount is not null) await Broadcast(left.SharedCount);
    }

    // Everyone in the slide gets it, sender included, so there's one path
    // for keeping the client's copy up to date.
    private Task Broadcast(ComparisonChange change) =>
        Clients.Group(GroupName(change.SlideId)).ComparisonChanged(change.Comparison?.Blind());

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
            await Clients.Group(DocGroupName(doc.SlideId, doc.DocId))
                .DocEditorsChanged(new DocEditors(doc.DocId, doc.Editors));
        }
        else
        {
            logger.LogInformation("Dropped doc {DocId} on {SlideId} ({Updates} updates)",
                doc.DocId, doc.SlideId, doc.Updates);
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

    private static HubException NotJoined() => new("Join a slide first");
}
