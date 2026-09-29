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
}
