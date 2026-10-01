using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using RealtimeHub.Slides;

namespace RealtimeHub.Tests;

// Real SignalR clients over real WebSockets, just against the in-memory
// test server rather than a port.
public class SlideHubTests : IClassFixture<HubFactory>
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);
    private readonly HubFactory _factory;

    public SlideHubTests(HubFactory factory)
    {
        _factory = factory;
    }

    // Signed in as userId (see TestAuthHandler), with display name "User {userId}".
    private async Task<HubConnection> ConnectAsync(string userId)
    {
        var server = _factory.Server;
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, $"/hubs/slides?test-user={userId}"), options =>
            {
                options.Transports = HttpTransportType.WebSockets;
                options.SkipNegotiation = true;
                options.WebSocketFactory = async (context, ct) =>
                    await server.CreateWebSocketClient().ConnectAsync(context.Uri, ct);
            })
            .AddJsonProtocol(options => HubJson.Configure(options.PayloadSerializerOptions))
            .Build();
        await connection.StartAsync();
        return connection;
    }

    // Each test gets its own slide so rooms don't leak between tests.
    private static string NewRoom() => $"test-{Guid.NewGuid():N}";

    private static Task<JoinResult> Join(HubConnection c, string roomId) =>
        c.InvokeAsync<JoinResult>("JoinSession", roomId);

    private static TaskCompletionSource<T> Listen<T>(HubConnection c, string method)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        c.On<T>(method, value => tcs.TrySetResult(value));
        return tcs;
    }

    private static Task<DocState> OpenDoc(HubConnection c, string docId, byte[] seed) =>
        c.InvokeAsync<DocState>("OpenDoc", docId, seed);

    private static Sketch LineSketch(double x) =>
        new("annotation", JsonSerializer.SerializeToElement(new { points = new[] { 0, 0, x, x } }));

    // Same short wait the other "not sent" checks use.
    private static async Task AssertNothing<T>(params TaskCompletionSource<T>[] listeners)
    {
        await Task.Delay(200);
        foreach (var l in listeners) Assert.False(l.Task.IsCompleted);
    }

    private static AnnotationOp CreateOp() => new(
        OpKind.Create, OpEntity.Annotation, Guid.NewGuid(),
        JsonSerializer.SerializeToElement(new { label = "test", shape = "polygon" }));

    [Fact]
    public async Task Join_ReturnsWhoIsAlreadyThere_AndTellsThem()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");

        var aJoin = await Join(a, slide);
        Assert.Empty(aJoin.Others);

        var joined = Listen<Participant>(a, nameof(ISlideClient.UserJoined));
        var bJoin = await Join(b, slide);

        var seen = await joined.Task.WaitAsync(Timeout);
        Assert.Equal("b", seen.UserId);
        Assert.Equal(slide, seen.RoomId);
        Assert.Single(bJoin.Others, p => p.UserId == "a");
        Assert.NotEqual(aJoin.Me.Colour, bJoin.Me.Colour);
    }

    [Fact]
    public async Task Join_TakesWhoYouAreFromTheToken()
    {
        await using var alice = await ConnectAsync("alice");

        var joined = await Join(alice, NewRoom());

        Assert.Equal("alice", joined.Me.UserId);
        Assert.Equal("User alice", joined.Me.DisplayName);
    }

    [Fact]
    public async Task Join_OnlyLetsInPeopleInTheSession()
    {
        await using var alice = await ConnectAsync("alice");

        var ex = await Assert.ThrowsAsync<HubException>(() => Join(alice, "locked-session"));

        Assert.Contains("not in that session", ex.Message);
    }

    [Fact]
    public async Task NotSignedIn_CantConnect()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => ConnectAsync(""));
    }

    [Fact]
    public async Task AnnotationOp_GoesToOthers_WithIncreasingSeq()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await Join(a, slide);
        await Join(b, slide);

        var received = Listen<StampedOp>(b, nameof(ISlideClient.AnnotationOp));
        var echoedToSender = Listen<StampedOp>(a, nameof(ISlideClient.AnnotationOp));

        var op = CreateOp();
        var first = await a.InvokeAsync<StampedOp>("SendAnnotationOp", op);
        var got = await received.Task.WaitAsync(Timeout);

        Assert.Equal(op.Id, got.Op.Id);
        Assert.Equal(OpKind.Create, got.Op.Kind);
        Assert.Equal("test", got.Op.Data!.Value.GetProperty("label").GetString());
        Assert.Equal("a", got.UserId);
        Assert.Equal(first.Seq, got.Seq);

        var second = await a.InvokeAsync<StampedOp>("SendAnnotationOp",
            new AnnotationOp(OpKind.Delete, OpEntity.Annotation, op.Id));
        Assert.True(second.Seq > first.Seq);

        await Task.Delay(200);
        Assert.False(echoedToSender.Task.IsCompleted);
    }

    [Fact]
    public async Task Slides_AreKeptApart()
    {
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await Join(a, NewRoom());
        await Join(b, NewRoom());

        var received = Listen<StampedOp>(b, nameof(ISlideClient.AnnotationOp));
        await a.InvokeAsync<StampedOp>("SendAnnotationOp", CreateOp());

        await Task.Delay(200);
        Assert.False(received.Task.IsCompleted);
    }

    [Fact]
    public async Task Viewport_IsRelayed_AndGivenToLateJoiners()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await using var c = await ConnectAsync("c");
        var aJoin = await Join(a, slide);
        await Join(b, slide);

        var updated = Listen<ViewportUpdate>(b, nameof(ISlideClient.ViewportUpdated));
        var viewport = new Viewport([100, 200], 4, 0.5, [0, 0, 200, 400]);
        await a.InvokeAsync("UpdateViewport", viewport);

        var got = await updated.Task.WaitAsync(Timeout);
        Assert.Equal(aJoin.Me.ConnectionId, got.ConnectionId);
        Assert.Equal(4, got.Viewport.Resolution);

        var cJoin = await Join(c, slide);
        var aSeenByC = Assert.Single(cJoin.Others, p => p.UserId == "a");
        Assert.Equal([100, 200], aSeenByC.Viewport!.Center);
    }

    [Fact]
    public async Task Disconnect_TellsTheRoom()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        var b = await ConnectAsync("b");
        await Join(a, slide);
        var bId = (await Join(b, slide)).Me.ConnectionId;

        var left = Listen<string>(a, nameof(ISlideClient.UserLeft));
        await b.DisposeAsync();

        Assert.Equal(bId, await left.Task.WaitAsync(Timeout));
    }

    [Fact]
    public async Task JoiningAnotherSlide_LeavesTheFirst()
    {
        var first = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await Join(a, first);
        var bId = (await Join(b, first)).Me.ConnectionId;

        var left = Listen<string>(a, nameof(ISlideClient.UserLeft));
        await Join(b, NewRoom());

        Assert.Equal(bId, await left.Task.WaitAsync(Timeout));
    }

    [Fact]
    public async Task SendingBeforeJoining_Fails()
    {
        await using var a = await ConnectAsync("a");
        var ex = await Assert.ThrowsAsync<HubException>(() =>
            a.InvokeAsync<StampedOp>("SendAnnotationOp", CreateOp()));
        Assert.Contains("Join a session first", ex.Message);
    }

    [Fact]
    public async Task Sketch_IsRelayed_KeptForLateJoiners_AndCleared()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        var aJoin = await Join(a, slide);
        await Join(b, slide);

        var updated = Listen<SketchUpdate>(b, nameof(ISlideClient.SketchUpdated));
        var echoed = Listen<SketchUpdate>(a, nameof(ISlideClient.SketchUpdated));
        await a.InvokeAsync("UpdateSketch", LineSketch(5));

        var got = await updated.Task.WaitAsync(Timeout);
        Assert.Equal(aJoin.Me.ConnectionId, got.ConnectionId);
        Assert.Equal("annotation", got.Sketch!.Tool);
        Assert.Equal(5, got.Sketch.Data.GetProperty("points")[2].GetDouble());
        await AssertNothing(echoed);

        await using var c = await ConnectAsync("c");
        var aSeenByC = Assert.Single((await Join(c, slide)).Others, p => p.UserId == "a");
        Assert.Equal("annotation", aSeenByC.Sketch!.Tool);

        var cleared = Listen<SketchUpdate>(b, nameof(ISlideClient.SketchUpdated));
        await a.InvokeAsync("UpdateSketch", (Sketch?)null);
        Assert.Null((await cleared.Task.WaitAsync(Timeout)).Sketch);

        await using var d = await ConnectAsync("d");
        var aSeenByD = Assert.Single((await Join(d, slide)).Others, p => p.UserId == "a");
        Assert.Null(aSeenByD.Sketch);
    }

    [Fact]
    public async Task Sketch_NeedsATool_AndAJoinedSlide()
    {
        await using var a = await ConnectAsync("a");
        var notJoined = await Assert.ThrowsAsync<HubException>(() => a.InvokeAsync("UpdateSketch", LineSketch(1)));
        Assert.Contains("Join a session first", notJoined.Message);

        await Join(a, NewRoom());
        var noTool = await Assert.ThrowsAsync<HubException>(() =>
            a.InvokeAsync("UpdateSketch", LineSketch(1) with { Tool = "" }));
        Assert.Contains("sketch.tool is required", noTool.Message);

        var noData = await Assert.ThrowsAsync<HubException>(() =>
            a.InvokeAsync("UpdateSketch", new { tool = "annotation" }));
        Assert.Contains("sketch.data is required", noData.Message);
    }

    [Fact]
    public async Task OpenDoc_FirstOpenerSeeds_LaterSeedsAreIgnored()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        var aId = (await Join(a, slide)).Me.ConnectionId;
        var bId = (await Join(b, slide)).Me.ConnectionId;

        var aState = await OpenDoc(a, "ann-1", [1, 2, 3]);
        Assert.True(aState.Seeded);
        Assert.Equal([1, 2, 3], Assert.Single(aState.Updates));
        Assert.Equal([aId], aState.Editors);

        var editors = Listen<DocEditors>(a, nameof(ISlideClient.DocEditorsChanged));
        var bState = await OpenDoc(b, "ann-1", [9, 9]);
        Assert.False(bState.Seeded);
        Assert.Equal(aState.InstanceId, bState.InstanceId);
        Assert.Equal([1, 2, 3], Assert.Single(bState.Updates));
        Assert.Equal([aId, bId], bState.Editors);

        var changed = await editors.Task.WaitAsync(Timeout);
        Assert.Equal("ann-1", changed.DocId);
        Assert.Equal([aId, bId], changed.Editors);

        // Opening again changes nothing.
        var again = await OpenDoc(a, "ann-1", [7]);
        Assert.False(again.Seeded);
        Assert.Equal([aId, bId], again.Editors);
    }

    [Fact]
    public async Task DocUpdate_OnlyGoesToOtherEditorsOfThatDoc()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await using var c = await ConnectAsync("c");
        await using var d = await ConnectAsync("d");
        var aId = (await Join(a, slide)).Me.ConnectionId;
        await Join(b, slide);
        await Join(c, slide);
        await Join(d, NewRoom());

        await OpenDoc(a, "ann-1", [1]);
        await OpenDoc(b, "ann-1", [2]);
        await OpenDoc(d, "ann-1", [3]);

        var toB = Listen<DocUpdate>(b, nameof(ISlideClient.DocUpdated));
        var toA = Listen<DocUpdate>(a, nameof(ISlideClient.DocUpdated));
        var toC = Listen<DocUpdate>(c, nameof(ISlideClient.DocUpdated));
        var toD = Listen<DocUpdate>(d, nameof(ISlideClient.DocUpdated));
        await a.InvokeAsync("SendDocUpdate", "ann-1", new byte[] { 4, 5 });

        var got = await toB.Task.WaitAsync(Timeout);
        Assert.Equal("ann-1", got.DocId);
        Assert.Equal(aId, got.ConnectionId);
        Assert.Equal([4, 5], got.Update);
        await AssertNothing(toA, toC, toD);

        await using var e = await ConnectAsync("e");
        await Join(e, slide);
        var eState = await OpenDoc(e, "ann-1", [6]);
        Assert.Equal([[1], [4, 5]], eState.Updates);
    }

    [Fact]
    public async Task DocUpdate_WithoutOpeningTheDoc_Fails()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await Join(a, slide);
        await Join(b, slide);
        await OpenDoc(a, "ann-1", [1]);

        var ex = await Assert.ThrowsAsync<HubException>(() =>
            b.InvokeAsync("SendDocUpdate", "ann-1", new byte[] { 2 }));
        Assert.Contains("Open the doc first", ex.Message);
    }

    [Fact]
    public async Task ClosingTheLastEditor_DropsTheDoc()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        var aId = (await Join(a, slide)).Me.ConnectionId;
        await Join(b, slide);

        var first = await OpenDoc(a, "ann-1", [1]);
        await OpenDoc(b, "ann-1", [2]);

        var editors = Listen<DocEditors>(a, nameof(ISlideClient.DocEditorsChanged));
        await b.InvokeAsync("CloseDoc", "ann-1");
        Assert.Equal([aId], (await editors.Task.WaitAsync(Timeout)).Editors);

        // Closing twice is a no-op.
        await a.InvokeAsync("CloseDoc", "ann-1");
        await a.InvokeAsync("CloseDoc", "ann-1");

        var reopened = await OpenDoc(b, "ann-1", [3]);
        Assert.True(reopened.Seeded);
        Assert.NotEqual(first.InstanceId, reopened.InstanceId);
        Assert.Equal([3], Assert.Single(reopened.Updates));
    }

    [Fact]
    public async Task Disconnecting_ClosesTheEditorsDocs()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        var b = await ConnectAsync("b");
        var aId = (await Join(a, slide)).Me.ConnectionId;
        await Join(b, slide);
        await OpenDoc(a, "ann-1", [1]);

        var bOpened = Listen<DocEditors>(a, nameof(ISlideClient.DocEditorsChanged));
        await OpenDoc(b, "ann-1", [2]);
        await bOpened.Task.WaitAsync(Timeout);

        var bGone = Listen<DocEditors>(a, nameof(ISlideClient.DocEditorsChanged));
        await b.DisposeAsync();
        Assert.Equal([aId], (await bGone.Task.WaitAsync(Timeout)).Editors);
    }

    [Fact]
    public async Task SwitchingSlide_ClosesTheEditorsDocs()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        var aId = (await Join(a, slide)).Me.ConnectionId;
        await Join(b, slide);
        await OpenDoc(a, "ann-1", [1]);

        var bOpened = Listen<DocEditors>(a, nameof(ISlideClient.DocEditorsChanged));
        await OpenDoc(b, "ann-1", [2]);
        await bOpened.Task.WaitAsync(Timeout);

        var bGone = Listen<DocEditors>(a, nameof(ISlideClient.DocEditorsChanged));
        await Join(b, NewRoom());
        Assert.Equal([aId], (await bGone.Task.WaitAsync(Timeout)).Editors);

        var toB = Listen<DocUpdate>(b, nameof(ISlideClient.DocUpdated));
        await a.InvokeAsync("SendDocUpdate", "ann-1", new byte[] { 3 });
        await AssertNothing(toB);
    }

    [Fact]
    public async Task BadDocIdsAndUpdates_AreRejected()
    {
        await using var a = await ConnectAsync("a");
        await Join(a, NewRoom());

        async Task Rejected(string method, object?[] args, string message)
        {
            var ex = await Assert.ThrowsAsync<HubException>(() => a.InvokeCoreAsync(method, args));
            Assert.Contains(message, ex.Message);
        }

        await Rejected("OpenDoc", ["", new byte[] { 1 }], "docId is required");
        await Rejected("OpenDoc", [new string('x', SlideHub.MaxDocIdLength + 1), new byte[] { 1 }], "docId is longer");
        await Rejected("OpenDoc", ["ann-1", Array.Empty<byte>()], "seed is required");
        await Rejected("OpenDoc", ["ann-1", new byte[SlideHub.MaxDocUpdateBytes + 1]], "seed is bigger");

        await OpenDoc(a, "ann-1", [1]);
        await Rejected("SendDocUpdate", ["ann-1", new byte[SlideHub.MaxDocUpdateBytes + 1]], "update is bigger");
        await Rejected("SendDocUpdate", ["ann-1", Array.Empty<byte>()], "update is required");

        // Right at the limit is fine.
        await a.InvokeAsync("SendDocUpdate", "ann-1", new byte[SlideHub.MaxDocUpdateBytes]);
    }

    [Fact]
    public async Task MessagesOver32KB_GetThrough()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await Join(a, slide);
        await Join(b, slide);

        var received = Listen<StampedOp>(b, nameof(ISlideClient.AnnotationOp));
        var points = new string('1', 100 * 1024);
        var op = new AnnotationOp(OpKind.Create, OpEntity.Annotation, Guid.NewGuid(),
            JsonSerializer.SerializeToElement(new { points }));
        await a.InvokeAsync<StampedOp>("SendAnnotationOp", op);

        var got = await received.Task.WaitAsync(Timeout);
        Assert.Equal(points, got.Op.Data!.Value.GetProperty("points").GetString());
    }

    [Fact]
    public async Task DocsEndpoint_ReportsSizes()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await Join(a, slide);
        await Join(b, slide);
        var state = await OpenDoc(a, "ann-1", [1, 2, 3]);
        await a.InvokeAsync("SendDocUpdate", "ann-1", new byte[] { 4, 5, 6, 7, 8 });
        await OpenDoc(b, "ann-1", [9]);

        var docs = await _factory.CreateClient()
            .GetFromJsonAsync<List<DocSummary>>($"/rooms/{slide}/docs");

        var doc = Assert.Single(docs!);
        Assert.Equal(new DocSummary("ann-1", state.InstanceId, 2, 2, 8), doc);
    }

    private static readonly ComparisonSettings Settings = new("{\"type\":\"Polygon\"}", 6, 20);

    private static Task<Comparison> StartComparison(HubConnection c) =>
        c.InvokeAsync<Comparison>("StartComparison", Settings);

    private static ComparisonDot[] Dots(params double[] xs) => xs.Select(x => new ComparisonDot(x, x)).ToArray();

    // Waits for the first ComparisonChanged that matches, skipping any before it.
    private static Task<Comparison?> NextComparison(HubConnection c, Func<Comparison?, bool> match)
    {
        var tcs = new TaskCompletionSource<Comparison?>(TaskCreationOptions.RunContinuationsAsynchronously);
        c.On<Comparison?>(nameof(ISlideClient.ComparisonChanged), value =>
        {
            if (match(value)) tcs.TrySetResult(value);
        });
        return tcs.Task.WaitAsync(Timeout);
    }

    private static CounterState StateOf(Comparison comparison, string connectionId) =>
        comparison.Counters.Single(c => c.ConnectionId == connectionId).State;

    [Fact]
    public async Task Comparison_InvitesEveryone_AndHidesDotsUntilTheReveal()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await using var c = await ConnectAsync("c");
        var aId = (await Join(a, slide)).Me.ConnectionId;
        var bId = (await Join(b, slide)).Me.ConnectionId;
        var cId = (await Join(c, slide)).Me.ConnectionId;

        var invited = NextComparison(b, x => x is not null);
        var started = await StartComparison(a);
        Assert.Equal(aId, started.HostConnectionId);
        Assert.Equal(aId, started.Counters[0].ConnectionId);
        Assert.Equal(CounterState.Counting, StateOf(started, aId));
        Assert.Equal(CounterState.Invited, StateOf(started, bId));
        Assert.Equal(Settings, (await invited)!.Settings);

        await b.InvokeAsync("JoinComparison", started.Id);

        var aHandedIn = NextComparison(b, x => x is not null && StateOf(x, aId) == CounterState.Submitted);
        await a.InvokeAsync("SubmitComparison", started.Id, Dots(1, 2, 3));
        var blind = (await aHandedIn)!;
        Assert.False(blind.Revealed);
        Assert.All(blind.Counters, counter => Assert.Null(counter.Dots));

        // c never answered, so it goes ahead without them.
        var revealed = NextComparison(c, x => x is { Revealed: true });
        await b.InvokeAsync("SubmitComparison", started.Id, Dots(1, 2));
        var result = (await revealed)!;
        Assert.Equal([aId, bId], result.Counters.Select(x => x.ConnectionId));
        Assert.Equal(3, result.Counters[0].Dots!.Count);
        Assert.Equal(2, result.Counters[1].Dots!.Count);
        Assert.DoesNotContain(result.Counters, x => x.ConnectionId == cId);
    }

    [Fact]
    public async Task Comparison_OneAtATime_AndLateJoinersAreInvited()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await using var c = await ConnectAsync("c");
        await Join(a, slide);
        await Join(b, slide);
        var started = await StartComparison(a);

        var ex = await Assert.ThrowsAsync<HubException>(() => StartComparison(b));
        Assert.Contains("already running", ex.Message);

        var aSeesC = NextComparison(a, x => x?.Counters.Count == 3);
        var cJoin = await Join(c, slide);
        Assert.Equal(started.Id, cJoin.Comparison!.Id);
        Assert.Equal(CounterState.Invited, StateOf(cJoin.Comparison, cJoin.Me.ConnectionId));
        await aSeesC;
    }

    [Fact]
    public async Task Comparison_IsDropped_OnceItCantGetToTwo()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await Join(a, slide);
        var bId = (await Join(b, slide)).Me.ConnectionId;
        var started = await StartComparison(a);

        var declined = NextComparison(a, x => x is not null && x.Counters.All(c => c.ConnectionId != bId));
        await b.InvokeAsync("LeaveComparison", started.Id);
        await declined;

        var dropped = NextComparison(a, x => x is null);
        await a.InvokeAsync("SubmitComparison", started.Id, Dots(1));
        Assert.Null(await dropped);

        var comparison = await _factory.CreateClient().GetAsync($"/rooms/{slide}/comparison");
        Assert.Equal(System.Net.HttpStatusCode.NoContent, comparison.StatusCode);
    }

    [Fact]
    public async Task Comparison_CounterDropping_CanTriggerTheReveal()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        var c = await ConnectAsync("c");
        await Join(a, slide);
        await Join(b, slide);
        await Join(c, slide);
        var started = await StartComparison(a);
        await b.InvokeAsync("JoinComparison", started.Id);
        await c.InvokeAsync("JoinComparison", started.Id);
        await a.InvokeAsync("SubmitComparison", started.Id, Dots(1));
        await b.InvokeAsync("SubmitComparison", started.Id, Dots(1));

        var revealed = NextComparison(a, x => x is { Revealed: true });
        await c.DisposeAsync();
        Assert.Equal(2, (await revealed)!.Counters.Count);
    }

    [Fact]
    public async Task Comparison_RevealedOne_GoesOnceEveryoneLeaves_OrANewOneStarts()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await Join(a, slide);
        await Join(b, slide);

        var first = await StartComparison(a);
        await b.InvokeAsync("JoinComparison", first.Id);
        await a.InvokeAsync("SubmitComparison", first.Id, Dots(1));
        await b.InvokeAsync("SubmitComparison", first.Id, Dots(1));

        // A revealed one doesn't block the next.
        var second = await StartComparison(b);
        Assert.NotEqual(first.Id, second.Id);
        await a.InvokeAsync("JoinComparison", second.Id);
        await a.InvokeAsync("SubmitComparison", second.Id, Dots(2));
        await b.InvokeAsync("SubmitComparison", second.Id, Dots(2));

        var aLeft = NextComparison(b, x => x is { Counters.Count: 1 });
        await a.InvokeAsync("LeaveComparison", second.Id);
        await aLeft;
        var gone = NextComparison(a, x => x is null);
        await b.InvokeAsync("LeaveComparison", second.Id);
        Assert.Null(await gone);
    }

    private static readonly SharedCountSettings SharedSettings = new(null, 6, 20);

    private static Task<SharedCount> StartShared(HubConnection c) =>
        c.InvokeAsync<SharedCount>("StartSharedCount", SharedSettings);

    private static SharedDot Dot(double x) => new(Guid.NewGuid(), x, x, "#fff614");

    private static Task<SharedCount?> NextShared(HubConnection c, Func<SharedCount?, bool> match)
    {
        var tcs = new TaskCompletionSource<SharedCount?>(TaskCreationOptions.RunContinuationsAsynchronously);
        c.On<SharedCount?>(nameof(ISlideClient.SharedCountChanged), value =>
        {
            if (match(value)) tcs.TrySetResult(value);
        });
        return tcs.Task.WaitAsync(Timeout);
    }

    [Fact]
    public async Task SharedCount_DotsGoToEveryoneElse_AndLateJoinersCatchUp()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        var aId = (await Join(a, slide)).Me.ConnectionId;
        var bId = (await Join(b, slide)).Me.ConnectionId;

        var started = await StartShared(a);
        Assert.Equal(ContributorState.Joined, started.Contributors.Single(c => c.ConnectionId == aId).State);
        Assert.Equal(ContributorState.Invited, started.Contributors.Single(c => c.ConnectionId == bId).State);
        Assert.Equal("b", started.Contributors.Single(c => c.ConnectionId == bId).UserId);
        await b.InvokeAsync("JoinSharedCount", started.Id);

        var toB = Listen<SharedDotAdded>(b, nameof(ISlideClient.SharedDotAdded));
        var toA = Listen<SharedDotAdded>(a, nameof(ISlideClient.SharedDotAdded));
        // Whatever connection id the client claims, the hub uses the real one.
        var dot = Dot(5) with { ConnectionId = "someone-else" };
        await a.InvokeAsync("AddSharedDot", started.Id, dot);
        var got = await toB.Task.WaitAsync(Timeout);
        Assert.Equal(dot.Id, got.Dot.Id);
        Assert.Equal(aId, got.Dot.ConnectionId);
        await AssertNothing(toA);

        await b.InvokeAsync("AddSharedDot", started.Id, Dot(9));

        await using var c = await ConnectAsync("c");
        var cJoin = await Join(c, slide);
        Assert.Equal(2, cJoin.SharedCount!.Dots.Count);
        Assert.Equal(ContributorState.Invited,
            cJoin.SharedCount.Contributors.Single(x => x.ConnectionId == cJoin.Me.ConnectionId).State);
    }

    [Fact]
    public async Task SharedCount_OnlyYourOwnDotsCanBeRemoved()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await Join(a, slide);
        await Join(b, slide);
        var started = await StartShared(a);
        await b.InvokeAsync("JoinSharedCount", started.Id);

        var dot = Dot(1);
        await a.InvokeAsync("AddSharedDot", started.Id, dot);
        var notYours = await Assert.ThrowsAsync<HubException>(() => b.InvokeAsync("RemoveSharedDot", started.Id, dot.Id));
        Assert.Contains("only remove your own", notYours.Message);

        var removed = Listen<SharedDotRemoved>(b, nameof(ISlideClient.SharedDotRemoved));
        await a.InvokeAsync("RemoveSharedDot", started.Id, dot.Id);
        Assert.Equal(dot.Id, (await removed.Task.WaitAsync(Timeout)).DotId);

        // Redo puts the same id back.
        await a.InvokeAsync("AddSharedDot", started.Id, dot);
        var twice = await Assert.ThrowsAsync<HubException>(() => a.InvokeAsync("AddSharedDot", started.Id, dot));
        Assert.Contains("already there", twice.Message);
    }

    [Fact]
    public async Task SharedCount_LeaversKeepTheirDots_AndHostingPassesOn()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await using var c = await ConnectAsync("c");
        var aId = (await Join(a, slide)).Me.ConnectionId;
        var bId = (await Join(b, slide)).Me.ConnectionId;
        var cId = (await Join(c, slide)).Me.ConnectionId;
        var started = await StartShared(a);
        await b.InvokeAsync("JoinSharedCount", started.Id);
        await a.InvokeAsync("AddSharedDot", started.Id, Dot(1));

        // c only had an invite, so they just go.
        var cGone = NextShared(b, x => x is not null && x.Contributors.All(p => p.ConnectionId != cId));
        await c.InvokeAsync("LeaveSharedCount", started.Id);
        await cGone;

        var aLeft = NextShared(b, x => x?.HostConnectionId == bId);
        await a.InvokeAsync("LeaveSharedCount", started.Id);
        var after = (await aLeft)!;
        Assert.Equal(ContributorState.Left, after.Contributors.Single(p => p.ConnectionId == aId).State);
        Assert.Single(after.Dots);

        var notHost = await Assert.ThrowsAsync<HubException>(() => a.InvokeAsync("AddSharedDot", started.Id, Dot(2)));
        Assert.Contains("Join the shared count first", notHost.Message);

        // Last one out drops it.
        var dropped = NextShared(a, x => x is null);
        await b.InvokeAsync("LeaveSharedCount", started.Id);
        Assert.Null(await dropped);
    }

    [Fact]
    public async Task SharedCount_OnlyTheHostCanFinish_AndItEndsForEveryone()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await Join(a, slide);
        await Join(b, slide);
        var started = await StartShared(a);
        await b.InvokeAsync("JoinSharedCount", started.Id);

        var ex = await Assert.ThrowsAsync<HubException>(() => b.InvokeAsync("FinishSharedCount", started.Id));
        Assert.Contains("Only the host", ex.Message);
        var again = await Assert.ThrowsAsync<HubException>(() => StartShared(b));
        Assert.Contains("already running", again.Message);

        var ended = NextShared(b, x => x is null);
        await a.InvokeAsync("FinishSharedCount", started.Id);
        Assert.Null(await ended);

        var endpoint = await _factory.CreateClient().GetAsync($"/rooms/{slide}/sharedcount");
        Assert.Equal(System.Net.HttpStatusCode.NoContent, endpoint.StatusCode);
    }

    [Fact]
    public async Task SharedCount_HostDropping_PassesItOn()
    {
        var slide = NewRoom();
        var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await Join(a, slide);
        var bId = (await Join(b, slide)).Me.ConnectionId;
        var started = await StartShared(a);
        await b.InvokeAsync("JoinSharedCount", started.Id);

        var handedOver = NextShared(b, x => x?.HostConnectionId == bId);
        await a.DisposeAsync();
        await handedOver;
    }

    [Fact]
    public async Task Comparison_BadCallsAreRejected()
    {
        var slide = NewRoom();
        await using var a = await ConnectAsync("a");
        await using var b = await ConnectAsync("b");
        await Join(a, slide);
        await Join(b, slide);

        async Task Rejected(HubConnection c, string method, object?[] args, string message)
        {
            var ex = await Assert.ThrowsAsync<HubException>(() => c.InvokeCoreAsync(method, args));
            Assert.Contains(message, ex.Message);
        }

        await Rejected(a, "StartComparison", [Settings with { RoiGeoJson = "" }], "roiGeoJson is required");
        await Rejected(a, "StartComparison", [Settings with { DotSize = 0 }], "dotSize must be above 0");
        await Rejected(a, "StartComparison", [Settings with { MatchRadius = 0 }], "matchRadius must be above 0");
        await Rejected(a, "JoinComparison", [Guid.NewGuid()], "isn't running");

        var started = await StartComparison(a);
        await Rejected(b, "SubmitComparison", [started.Id, Dots(1)], "not counting");
        await Rejected(a, "JoinComparison", [started.Id], "not invited");
        await Rejected(a, "SubmitComparison", [started.Id, new ComparisonDot[SlideHub.MaxComparisonDots + 1]], "More than");
    }
}
