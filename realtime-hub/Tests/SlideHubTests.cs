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
public class SlideHubTests : IClassFixture<WebApplicationFactory<Program>>
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);
    private readonly WebApplicationFactory<Program> _factory;

    public SlideHubTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    private async Task<HubConnection> ConnectAsync()
    {
        var server = _factory.Server;
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, "/hubs/slides"), options =>
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
    private static string NewSlide() => $"test-{Guid.NewGuid():N}";

    private static Task<JoinResult> Join(HubConnection c, string slideId, string userId) =>
        c.InvokeAsync<JoinResult>("JoinSlide", slideId, userId, $"User {userId}");

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
        var slide = NewSlide();
        await using var a = await ConnectAsync();
        await using var b = await ConnectAsync();

        var aJoin = await Join(a, slide, "a");
        Assert.Empty(aJoin.Others);

        var joined = Listen<Participant>(a, nameof(ISlideClient.UserJoined));
        var bJoin = await Join(b, slide, "b");

        var seen = await joined.Task.WaitAsync(Timeout);
        Assert.Equal("b", seen.UserId);
        Assert.Equal(slide, seen.SlideId);
        Assert.Single(bJoin.Others, p => p.UserId == "a");
        Assert.NotEqual(aJoin.Me.Colour, bJoin.Me.Colour);
    }

    [Fact]
    public async Task AnnotationOp_GoesToOthers_WithIncreasingSeq()
    {
        var slide = NewSlide();
        await using var a = await ConnectAsync();
        await using var b = await ConnectAsync();
        await Join(a, slide, "a");
        await Join(b, slide, "b");

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
        await using var a = await ConnectAsync();
        await using var b = await ConnectAsync();
        await Join(a, NewSlide(), "a");
        await Join(b, NewSlide(), "b");

        var received = Listen<StampedOp>(b, nameof(ISlideClient.AnnotationOp));
        await a.InvokeAsync<StampedOp>("SendAnnotationOp", CreateOp());

        await Task.Delay(200);
        Assert.False(received.Task.IsCompleted);
    }

    [Fact]
    public async Task Viewport_IsRelayed_AndGivenToLateJoiners()
    {
        var slide = NewSlide();
        await using var a = await ConnectAsync();
        await using var b = await ConnectAsync();
        await using var c = await ConnectAsync();
        var aJoin = await Join(a, slide, "a");
        await Join(b, slide, "b");

        var updated = Listen<ViewportUpdate>(b, nameof(ISlideClient.ViewportUpdated));
        var viewport = new Viewport([100, 200], 4, 0.5, [0, 0, 200, 400]);
        await a.InvokeAsync("UpdateViewport", viewport);

        var got = await updated.Task.WaitAsync(Timeout);
        Assert.Equal(aJoin.Me.ConnectionId, got.ConnectionId);
        Assert.Equal(4, got.Viewport.Resolution);

        var cJoin = await Join(c, slide, "c");
        var aSeenByC = Assert.Single(cJoin.Others, p => p.UserId == "a");
        Assert.Equal([100, 200], aSeenByC.Viewport!.Center);
    }

    [Fact]
    public async Task Disconnect_TellsTheRoom()
    {
        var slide = NewSlide();
        await using var a = await ConnectAsync();
        var b = await ConnectAsync();
        await Join(a, slide, "a");
        var bId = (await Join(b, slide, "b")).Me.ConnectionId;

        var left = Listen<string>(a, nameof(ISlideClient.UserLeft));
        await b.DisposeAsync();

        Assert.Equal(bId, await left.Task.WaitAsync(Timeout));
    }

    [Fact]
    public async Task JoiningAnotherSlide_LeavesTheFirst()
    {
        var first = NewSlide();
        await using var a = await ConnectAsync();
        await using var b = await ConnectAsync();
        await Join(a, first, "a");
        var bId = (await Join(b, first, "b")).Me.ConnectionId;

        var left = Listen<string>(a, nameof(ISlideClient.UserLeft));
        await Join(b, NewSlide(), "b");

        Assert.Equal(bId, await left.Task.WaitAsync(Timeout));
    }

    [Fact]
    public async Task SendingBeforeJoining_Fails()
    {
        await using var a = await ConnectAsync();
        var ex = await Assert.ThrowsAsync<HubException>(() =>
            a.InvokeAsync<StampedOp>("SendAnnotationOp", CreateOp()));
        Assert.Contains("Join a slide first", ex.Message);
    }

    [Fact]
    public async Task Sketch_IsRelayed_KeptForLateJoiners_AndCleared()
    {
        var slide = NewSlide();
        await using var a = await ConnectAsync();
        await using var b = await ConnectAsync();
        var aJoin = await Join(a, slide, "a");
        await Join(b, slide, "b");

        var updated = Listen<SketchUpdate>(b, nameof(ISlideClient.SketchUpdated));
        var echoed = Listen<SketchUpdate>(a, nameof(ISlideClient.SketchUpdated));
        await a.InvokeAsync("UpdateSketch", LineSketch(5));

        var got = await updated.Task.WaitAsync(Timeout);
        Assert.Equal(aJoin.Me.ConnectionId, got.ConnectionId);
        Assert.Equal("annotation", got.Sketch!.Tool);
        Assert.Equal(5, got.Sketch.Data.GetProperty("points")[2].GetDouble());
        await AssertNothing(echoed);

        await using var c = await ConnectAsync();
        var aSeenByC = Assert.Single((await Join(c, slide, "c")).Others, p => p.UserId == "a");
        Assert.Equal("annotation", aSeenByC.Sketch!.Tool);

        var cleared = Listen<SketchUpdate>(b, nameof(ISlideClient.SketchUpdated));
        await a.InvokeAsync("UpdateSketch", (Sketch?)null);
        Assert.Null((await cleared.Task.WaitAsync(Timeout)).Sketch);

        await using var d = await ConnectAsync();
        var aSeenByD = Assert.Single((await Join(d, slide, "d")).Others, p => p.UserId == "a");
        Assert.Null(aSeenByD.Sketch);
    }

    [Fact]
    public async Task Sketch_NeedsATool_AndAJoinedSlide()
    {
        await using var a = await ConnectAsync();
        var notJoined = await Assert.ThrowsAsync<HubException>(() => a.InvokeAsync("UpdateSketch", LineSketch(1)));
        Assert.Contains("Join a slide first", notJoined.Message);

        await Join(a, NewSlide(), "a");
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
        var slide = NewSlide();
        await using var a = await ConnectAsync();
        await using var b = await ConnectAsync();
        var aId = (await Join(a, slide, "a")).Me.ConnectionId;
        var bId = (await Join(b, slide, "b")).Me.ConnectionId;

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
        var slide = NewSlide();
        await using var a = await ConnectAsync();
        await using var b = await ConnectAsync();
        await using var c = await ConnectAsync();
        await using var d = await ConnectAsync();
        var aId = (await Join(a, slide, "a")).Me.ConnectionId;
        await Join(b, slide, "b");
        await Join(c, slide, "c");
        await Join(d, NewSlide(), "d");

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

        await using var e = await ConnectAsync();
        await Join(e, slide, "e");
        var eState = await OpenDoc(e, "ann-1", [6]);
        Assert.Equal([[1], [4, 5]], eState.Updates);
    }

    [Fact]
    public async Task DocUpdate_WithoutOpeningTheDoc_Fails()
    {
        var slide = NewSlide();
        await using var a = await ConnectAsync();
        await using var b = await ConnectAsync();
        await Join(a, slide, "a");
        await Join(b, slide, "b");
        await OpenDoc(a, "ann-1", [1]);

        var ex = await Assert.ThrowsAsync<HubException>(() =>
            b.InvokeAsync("SendDocUpdate", "ann-1", new byte[] { 2 }));
        Assert.Contains("Open the doc first", ex.Message);
    }

    [Fact]
    public async Task ClosingTheLastEditor_DropsTheDoc()
    {
        var slide = NewSlide();
        await using var a = await ConnectAsync();
        await using var b = await ConnectAsync();
        var aId = (await Join(a, slide, "a")).Me.ConnectionId;
        await Join(b, slide, "b");

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
        var slide = NewSlide();
        await using var a = await ConnectAsync();
        var b = await ConnectAsync();
        var aId = (await Join(a, slide, "a")).Me.ConnectionId;
        await Join(b, slide, "b");
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
        var slide = NewSlide();
        await using var a = await ConnectAsync();
        await using var b = await ConnectAsync();
        var aId = (await Join(a, slide, "a")).Me.ConnectionId;
        await Join(b, slide, "b");
        await OpenDoc(a, "ann-1", [1]);

        var bOpened = Listen<DocEditors>(a, nameof(ISlideClient.DocEditorsChanged));
        await OpenDoc(b, "ann-1", [2]);
        await bOpened.Task.WaitAsync(Timeout);

        var bGone = Listen<DocEditors>(a, nameof(ISlideClient.DocEditorsChanged));
        await Join(b, NewSlide(), "b");
        Assert.Equal([aId], (await bGone.Task.WaitAsync(Timeout)).Editors);

        var toB = Listen<DocUpdate>(b, nameof(ISlideClient.DocUpdated));
        await a.InvokeAsync("SendDocUpdate", "ann-1", new byte[] { 3 });
        await AssertNothing(toB);
    }

    [Fact]
    public async Task BadDocIdsAndUpdates_AreRejected()
    {
        await using var a = await ConnectAsync();
        await Join(a, NewSlide(), "a");

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
        var slide = NewSlide();
        await using var a = await ConnectAsync();
        await using var b = await ConnectAsync();
        await Join(a, slide, "a");
        await Join(b, slide, "b");

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
        var slide = NewSlide();
        await using var a = await ConnectAsync();
        await using var b = await ConnectAsync();
        await Join(a, slide, "a");
        await Join(b, slide, "b");
        var state = await OpenDoc(a, "ann-1", [1, 2, 3]);
        await a.InvokeAsync("SendDocUpdate", "ann-1", new byte[] { 4, 5, 6, 7, 8 });
        await OpenDoc(b, "ann-1", [9]);

        var docs = await _factory.CreateClient()
            .GetFromJsonAsync<List<DocSummary>>($"/rooms/{slide}/docs");

        var doc = Assert.Single(docs!);
        Assert.Equal(new DocSummary("ann-1", state.InstanceId, 2, 2, 8), doc);
    }
}
