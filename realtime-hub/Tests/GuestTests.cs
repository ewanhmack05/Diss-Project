using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using RealtimeHub.Auth;
using RealtimeHub.Slides;

namespace RealtimeHub.Tests;

// Guests from an invite link (docs/guests.md). Tokens are minted through
// the real POST /guests and checked by the real guest scheme - only
// annotation-store is faked (TestGuestInvites, TestSessionAccess).
public class GuestTests : IClassFixture<HubFactory>
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);
    private readonly HubFactory _factory;

    public GuestTests(HubFactory factory)
    {
        _factory = factory;
    }

    private async Task<HttpResponseMessage> PostGuests(string? code, string? address = null)
    {
        using var client = _factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/guests")
        {
            Content = JsonContent.Create(new { inviteCode = code }),
        };
        request.Headers.Add(TestRemoteAddress.Header, address ?? TestRemoteAddress.NewAddress());
        return await client.SendAsync(request);
    }

    private async Task<GuestResponse> Mint(Guid sessionId, string kind = "open")
    {
        using var response = await PostGuests(TestGuestInvites.Code(kind, sessionId));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<GuestResponse>())!;
    }

    private async Task<HubConnection> Connect(string pathAndQuery)
    {
        var server = _factory.Server;
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, pathAndQuery), options =>
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

    private Task<HubConnection> ConnectGuest(string token) => Connect($"/hubs/slides?access_token={token}");

    private Task<HubConnection> ConnectUser(string userId) => Connect($"/hubs/slides?test-user={userId}");

    // The negotiate call is the plain HTTP way in to a hub, so it shows
    // whether a token is let in without opening a socket.
    private async Task<HttpStatusCode> Negotiate(string hub, string token)
    {
        using var client = _factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, $"/hubs/{hub}/negotiate?negotiateVersion=1");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await client.SendAsync(request);
        return response.StatusCode;
    }

    private static TaskCompletionSource<T> Listen<T>(HubConnection c, string method)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        c.On<T>(method, value => tcs.TrySetResult(value));
        return tcs;
    }

    private static AnnotationOp CreateOp() => new(
        OpKind.Create, OpEntity.Annotation, Guid.NewGuid(),
        JsonSerializer.SerializeToElement(new { label = "test" }));

    private SymmetricSecurityKey RealKey() =>
        GuestTokens.SigningKey(_factory.Services.GetRequiredService<IConfiguration>()["GuestTokens:SigningKey"]);

    private static string Room(Guid sessionId) => sessionId.ToString("D");

    [Fact]
    public async Task Mint_GivesATokenWithOnlyTheContractsClaims()
    {
        var sessionId = Guid.NewGuid();
        var before = DateTimeOffset.UtcNow;

        var guest = await Mint(sessionId);

        Assert.Equal(Room(sessionId), guest.SessionId);
        Assert.Equal("slide-1", guest.SlideId);
        Assert.Matches("^guest-[A-Za-z0-9_-]{22}$", guest.GuestId);

        var token = new JsonWebTokenHandler().ReadJsonWebToken(guest.Token);
        Assert.Equal("HS256", token.Alg);
        Assert.Equal("realtime-hub", token.Issuer);
        Assert.Equal("diss-guest", Assert.Single(token.Audiences));
        Assert.Equal(guest.GuestId, token.Subject);
        Assert.Equal(Room(sessionId), token.GetClaim("guest_session").Value);
        // Nothing else - no name, ever.
        Assert.Equal(
            ["aud", "exp", "guest_session", "iat", "iss", "nbf", "sub"],
            token.Claims.Select(c => c.Type).Order().ToArray());

        Assert.InRange(token.IssuedAt, before.UtcDateTime.AddSeconds(-1), DateTime.UtcNow.AddSeconds(1));
        Assert.Equal(token.IssuedAt, token.ValidFrom);
        // The invite runs for 10 hours, so the 4 hour cap wins.
        Assert.Equal(token.IssuedAt.AddHours(4), token.ValidTo);
        Assert.Equal(guest.Expires.UtcDateTime, token.ValidTo);
    }

    [Fact]
    public async Task Mint_StopsWhenTheInviteDoes()
    {
        var guest = await Mint(Guid.NewGuid(), "soon");

        var token = new JsonWebTokenHandler().ReadJsonWebToken(guest.Token);
        // TestGuestInvites' "soon" runs out an hour from now.
        Assert.InRange(token.ValidTo, DateTime.UtcNow.AddMinutes(59), DateTime.UtcNow.AddMinutes(61));
        Assert.Equal(guest.Expires.UtcDateTime, token.ValidTo);
    }

    [Fact]
    public async Task Mint_GivesEveryoneTheirOwnId()
    {
        var sessionId = Guid.NewGuid();
        var first = await Mint(sessionId);
        var second = await Mint(sessionId);

        Assert.NotEqual(first.GuestId, second.GuestId);
    }

    [Theory]
    [InlineData("nope_00000000000000000000000000000000")]
    [InlineData("not a code")]
    [InlineData("<script>")]
    public async Task Mint_UnknownCode_Is404(string code)
    {
        using var response = await PostGuests(code);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task Mint_NoCode_Is400(string? code)
    {
        using var response = await PostGuests(code);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("expired", "expired")]
    [InlineData("stopped", "stopped")]
    [InlineData("ended", "ended")]
    // Says open but has run out - the clocks disagree.
    [InlineData("late", "expired")]
    public async Task Mint_InviteNotOpen_Is410WithItsStatus(string kind, string status)
    {
        using var response = await PostGuests(TestGuestInvites.Code(kind, Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.Gone, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(status, body.GetProperty("status").GetString());
        Assert.False(body.TryGetProperty("token", out _));
    }

    [Fact]
    public async Task Mint_AnnotationStoreDown_Is502()
    {
        using var response = await PostGuests(TestGuestInvites.Code("down", Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
    }

    [Fact]
    public async Task Mint_SixtyAMinuteFromOneAddress_ThenRefused()
    {
        var address = TestRemoteAddress.NewAddress();
        var code = TestGuestInvites.Code("open", Guid.NewGuid());

        for (var i = 0; i < GuestEndpoints.MintsPerMinute; i++)
        {
            using var ok = await PostGuests(code, address);
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        }
        using var refused = await PostGuests(code, address);
        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);

        // Failed ones count too, so guessing codes is just as slow.
        using var guess = await PostGuests("nope_00000000000000000000000000000000", address);
        Assert.Equal(HttpStatusCode.TooManyRequests, guess.StatusCode);

        // Someone else isn't held up by it.
        using var other = await PostGuests(code);
        Assert.Equal(HttpStatusCode.OK, other.StatusCode);
    }

    private async Task<HttpResponseMessage> PostGuestsVia(string proxy, string forwardedFor, string code)
    {
        using var client = _factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/guests")
        {
            Content = JsonContent.Create(new { inviteCode = code }),
        };
        request.Headers.Add(TestRemoteAddress.Header, proxy);
        request.Headers.Add("X-Forwarded-For", forwardedFor);
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task Mint_ThroughTheViewersProxy_EachBrowserHasItsOwnLimit()
    {
        var code = TestGuestInvites.Code("open", Guid.NewGuid());
        var first = TestRemoteAddress.NewAddress();

        for (var i = 0; i < GuestEndpoints.MintsPerMinute; i++)
        {
            using var ok = await PostGuestsVia("127.0.0.1", first, code);
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        }
        using var refused = await PostGuestsVia("127.0.0.1", first, code);
        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);

        // Another browser through the same proxy still gets in.
        using var second = await PostGuestsVia("127.0.0.1", TestRemoteAddress.NewAddress(), code);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
    }

    [Fact]
    public async Task Mint_ForwardedForFromAnywhereButLocalhost_IsIgnored()
    {
        var code = TestGuestInvites.Code("open", Guid.NewGuid());
        var caller = TestRemoteAddress.NewAddress();

        // A made up X-Forwarded-For each time can't get round the limit.
        for (var i = 0; i < GuestEndpoints.MintsPerMinute; i++)
        {
            using var ok = await PostGuestsVia(caller, TestRemoteAddress.NewAddress(), code);
            Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        }
        using var refused = await PostGuestsVia(caller, TestRemoteAddress.NewAddress(), code);
        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
    }

    [Fact]
    public async Task Guest_JoinsTheirSession_AsAViewOnlyGuest_UnderTheTidiedName()
    {
        var sessionId = Guid.NewGuid();
        var room = Room(sessionId);
        await using var host = await ConnectUser("host-a");
        await host.InvokeAsync<JoinResult>("JoinSession", room);
        var joined = Listen<Participant>(host, nameof(ISlideClient.UserJoined));

        var guest = await Mint(sessionId);
        await using var g = await ConnectGuest(guest.Token);
        // NFC, trimmed, and the run of spaces made one. "Zoe" is typed with a
        // separate combining accent, so it's 5 chars before NFC and 4 after.
        var result = await g.InvokeAsync<JoinResult>("JoinAsGuest", room, "  Zoë   Lee ");

        Assert.Equal("Zoë Lee", result.Me.DisplayName);
        Assert.Equal(guest.GuestId, result.Me.UserId);
        Assert.True(result.Me.Guest);
        // TestSessionAccess says editor for a guest - the hub makes it view only anyway.
        Assert.False(result.Me.CanEdit);
        Assert.False(result.Me.Host);
        Assert.Single(result.Others, p => p.UserId == "host-a" && !p.Guest);

        var seen = await joined.Task.WaitAsync(Timeout);
        Assert.Equal("Zoë Lee", seen.DisplayName);
        Assert.True(seen.Guest);
        Assert.False(seen.CanEdit);
    }

    [Fact]
    public async Task Guest_GoesOverTheWireAsGuestTrue()
    {
        var sessionId = Guid.NewGuid();
        var guest = await Mint(sessionId);
        await using var g = await ConnectGuest(guest.Token);
        await g.InvokeAsync<JoinResult>("JoinAsGuest", Room(sessionId), "Ann");

        using var client = _factory.CreateClient();
        var participants = await client.GetFromJsonAsync<JsonElement>($"/rooms/{Room(sessionId)}");

        Assert.True(participants[0].GetProperty("guest").GetBoolean());
    }

    [Fact]
    public async Task Guest_IsntAskedIntoCounts()
    {
        var sessionId = Guid.NewGuid();
        var room = Room(sessionId);
        await using var host = await ConnectUser("host-a");
        await host.InvokeAsync<JoinResult>("JoinSession", room);
        var guest = await Mint(sessionId);
        await using var g = await ConnectGuest(guest.Token);
        var joined = await g.InvokeAsync<JoinResult>("JoinAsGuest", room, "Ann");

        var shared = await host.InvokeAsync<SharedCount>("StartSharedCount", new SharedCountSettings(null, 8, 10));

        Assert.DoesNotContain(shared.Contributors, c => c.ConnectionId == joined.Me.ConnectionId);
        await Assert.ThrowsAsync<HubException>(() =>
            g.InvokeAsync<SharedCount>("StartSharedCount", new SharedCountSettings(null, 8, 10)));
    }

    [Fact]
    public async Task Guest_CantJoinAnotherSession()
    {
        var guest = await Mint(Guid.NewGuid());
        await using var g = await ConnectGuest(guest.Token);

        var ex = await Assert.ThrowsAsync<HubException>(() =>
            g.InvokeAsync<JoinResult>("JoinAsGuest", Room(Guid.NewGuid()), "Ann"));

        Assert.Contains("different session", ex.Message);
    }

    [Fact]
    public async Task Guest_CantUseJoinSession()
    {
        var sessionId = Guid.NewGuid();
        var guest = await Mint(sessionId);
        await using var g = await ConnectGuest(guest.Token);

        var ex = await Assert.ThrowsAsync<HubException>(() => g.InvokeAsync<JoinResult>("JoinSession", Room(sessionId)));

        Assert.Contains("JoinAsGuest", ex.Message);
    }

    [Fact]
    public async Task SignedInUser_CantUseJoinAsGuest()
    {
        await using var alice = await ConnectUser("alice");

        var ex = await Assert.ThrowsAsync<HubException>(() =>
            alice.InvokeAsync<JoinResult>("JoinAsGuest", Room(Guid.NewGuid()), "Alice"));

        Assert.Contains("JoinSession", ex.Message);
    }

    [Fact]
    public async Task Guest_CantJoinOnceTheSessionHasEnded()
    {
        var sessionId = Guid.NewGuid();
        var guest = await Mint(sessionId);
        await using var g = await ConnectGuest(guest.Token);
        TestSessionAccess.Ended[Room(sessionId)] = true;

        var ex = await Assert.ThrowsAsync<HubException>(() => g.InvokeAsync<JoinResult>("JoinAsGuest", Room(sessionId), "Ann"));

        Assert.Contains("ended", ex.Message);
    }

    [Theory]
    [InlineData("a", "At least 2")]
    [InlineData("   ", "At least 2")]
    [InlineData("abcdefghijklmnopqrstuvwxy", "At most 24")]
    [InlineData("<b>Ann</b>", "Letters, numbers")]
    [InlineData("Ann;--", "Letters, numbers")]
    [InlineData("Ann​Lee", "Letters, numbers")]
    [InlineData("Ann \U0001F600", "Letters, numbers")]
    [InlineData("...", "at least one letter")]
    public async Task Guest_BadName_IsRefused(string name, string why)
    {
        var sessionId = Guid.NewGuid();
        var guest = await Mint(sessionId);
        await using var g = await ConnectGuest(guest.Token);

        var ex = await Assert.ThrowsAsync<HubException>(() => g.InvokeAsync<JoinResult>("JoinAsGuest", Room(sessionId), name));

        Assert.Contains(why, ex.Message);
        Assert.Empty(_factory.Services.GetRequiredService<SlideRooms>().InRoom(Room(sessionId)));
    }

    [Fact]
    public async Task Guest_CantUsePresence()
    {
        var guest = await Mint(Guid.NewGuid());

        Assert.Equal(HttpStatusCode.OK, await Negotiate("slides", guest.Token));
        Assert.Equal(HttpStatusCode.Unauthorized, await Negotiate("presence", guest.Token));
        await Assert.ThrowsAnyAsync<Exception>(() => Connect($"/hubs/presence?access_token={guest.Token}"));
    }

    [Fact]
    public async Task BadGuestTokens_AreRefused()
    {
        var sessionId = Guid.NewGuid();
        var key = RealKey();
        var far = DateTimeOffset.UtcNow.AddDays(1);

        var expired = new GuestTokenIssuer(key, new FixedTime(DateTimeOffset.UtcNow.AddHours(-5))).Mint(sessionId, far)!;
        var wrongKey = new GuestTokenIssuer(new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(32)), TimeProvider.System)
            .Mint(sessionId, far)!;
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = GuestTokens.Issuer,
            Audience = "diss-api",
            Claims = new Dictionary<string, object> { ["sub"] = "guest-x", [GuestTokens.SessionClaim] = sessionId.ToString("D") },
            Expires = DateTime.UtcNow.AddHours(1),
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
        };
        var wrongAudience = new JsonWebTokenHandler().CreateToken(descriptor);
        descriptor.Audience = GuestTokens.Audience;
        descriptor.SigningCredentials = null;
        var unsigned = new JsonWebTokenHandler().CreateToken(descriptor);

        // The same key and clock let a real one in, so it's the token that's wrong.
        var good = new GuestTokenIssuer(key, TimeProvider.System).Mint(sessionId, far)!;
        Assert.Equal(HttpStatusCode.OK, await Negotiate("slides", good.Token));

        foreach (var token in new[] { expired.Token, wrongKey.Token, wrongAudience, unsigned, "not.a.token" })
        {
            Assert.Equal(HttpStatusCode.Unauthorized, await Negotiate("slides", token));
            await Assert.ThrowsAnyAsync<Exception>(() => ConnectGuest(token));
        }
    }

    [Fact]
    public async Task ViewOnly_CantSendOpsOrDocUpdates_ButEditorsStillCan()
    {
        var sessionId = Guid.NewGuid();
        var room = Room(sessionId);
        await using var editor = await ConnectUser("editor-e");
        await using var viewer = await ConnectUser("viewer-v");
        var guest = await Mint(sessionId);
        await using var g = await ConnectGuest(guest.Token);
        await editor.InvokeAsync<JoinResult>("JoinSession", room);
        await viewer.InvokeAsync<JoinResult>("JoinSession", room);
        await g.InvokeAsync<JoinResult>("JoinAsGuest", room, "Ann");

        foreach (var viewOnly in new[] { viewer, g })
        {
            var op = await Assert.ThrowsAsync<HubException>(() => viewOnly.InvokeAsync<StampedOp>("SendAnnotationOp", CreateOp()));
            Assert.Contains("only view", op.Message);
            // Not even the nudge that the session changed.
            await Assert.ThrowsAsync<HubException>(() => viewOnly.InvokeAsync<StampedOp>("SendAnnotationOp",
                new AnnotationOp(OpKind.Update, OpEntity.Collection, sessionId)));
        }

        // Opening a doc to watch it is fine, changing it isn't.
        await editor.InvokeAsync<DocState>("OpenDoc", "annotation:1", new byte[] { 1 });
        var guestDoc = await g.InvokeAsync<DocState>("OpenDoc", "annotation:1", new byte[] { 9 });
        Assert.Equal(new byte[] { 1 }, Assert.Single(guestDoc.Updates));
        await viewer.InvokeAsync<DocState>("OpenDoc", "annotation:1", new byte[] { 9 });
        foreach (var viewOnly in new[] { viewer, g })
        {
            var doc = await Assert.ThrowsAsync<HubException>(() => viewOnly.InvokeAsync("SendDocUpdate", "annotation:1", new byte[] { 2 }));
            Assert.Contains("only view", doc.Message);
        }

        var opToGuest = Listen<StampedOp>(g, nameof(ISlideClient.AnnotationOp));
        var opToViewer = Listen<StampedOp>(viewer, nameof(ISlideClient.AnnotationOp));
        var docToGuest = Listen<DocUpdate>(g, nameof(ISlideClient.DocUpdated));
        var sent = await editor.InvokeAsync<StampedOp>("SendAnnotationOp", CreateOp());
        await editor.InvokeAsync("SendDocUpdate", "annotation:1", new byte[] { 3 });

        Assert.Equal(sent.Seq, (await opToGuest.Task.WaitAsync(Timeout)).Seq);
        Assert.Equal(sent.Seq, (await opToViewer.Task.WaitAsync(Timeout)).Seq);
        Assert.Equal(new byte[] { 3 }, (await docToGuest.Task.WaitAsync(Timeout)).Update);
        // The refused ones never got a seq, so the editor's is the room's first.
        Assert.Equal(1, sent.Seq);
        var docs = _factory.Services.GetRequiredService<SlideRooms>().DocsInRoom(room);
        Assert.Equal(2, docs.Single().Updates);
    }

    [Fact]
    public async Task Guest_RefreshRole_ChangesNothing()
    {
        var sessionId = Guid.NewGuid();
        var room = Room(sessionId);
        await using var host = await ConnectUser("host-a");
        await host.InvokeAsync<JoinResult>("JoinSession", room);
        var guest = await Mint(sessionId);
        await using var g = await ConnectGuest(guest.Token);
        var joined = await g.InvokeAsync<JoinResult>("JoinAsGuest", room, "Ann");
        var toHost = Listen<Participant>(host, nameof(ISlideClient.ParticipantUpdated));
        var toGuest = Listen<Participant>(g, nameof(ISlideClient.ParticipantUpdated));
        // Even if annotation-store somehow said editor.
        TestSessionAccess.Changed[guest.GuestId] = SessionRole.Editor;

        await g.InvokeAsync("RefreshRole");

        await Task.Delay(200);
        Assert.False(toHost.Task.IsCompleted);
        Assert.False(toGuest.Task.IsCompleted);
        var me = _factory.Services.GetRequiredService<SlideRooms>().Get(joined.Me.ConnectionId)!;
        Assert.False(me.CanEdit);
        Assert.True(me.Guest);
    }

    [Fact]
    public async Task GuestsName_IsNeverLogged_ButTheirIdIs()
    {
        const string name = "Zebedee Quux";
        var sessionId = Guid.NewGuid();
        var room = Room(sessionId);
        await using var host = await ConnectUser("host-a");
        await host.InvokeAsync<JoinResult>("JoinSession", room);
        var guest = await Mint(sessionId);

        await using (var g = await ConnectGuest(guest.Token))
        {
            // A bad name first, then the real one, then the usual things.
            await Assert.ThrowsAsync<HubException>(() => g.InvokeAsync<JoinResult>("JoinAsGuest", room, name + ";--"));
            await g.InvokeAsync<JoinResult>("JoinAsGuest", room, name);
            await g.InvokeAsync<DocState>("OpenDoc", "annotation:1", new byte[] { 1 });
            await g.InvokeAsync("UpdateViewport", new Viewport([0, 0], 1, 0, [0, 0, 1, 1]));
            await Assert.ThrowsAsync<HubException>(() => g.InvokeAsync<StampedOp>("SendAnnotationOp", CreateOp()));
            await g.InvokeAsync("RefreshRole");
        }

        // Dropping is logged once the hub notices the socket closed.
        var deadline = DateTime.UtcNow + Timeout;
        while (!_factory.Logs.Lines.Any(l => l.Contains(guest.GuestId) && l.Contains("dropped")) && DateTime.UtcNow < deadline)
            await Task.Delay(50);

        var lines = _factory.Logs.Lines.ToList();
        Assert.Contains(lines, l => l.Contains(guest.GuestId) && l.Contains("let in as a guest"));
        Assert.Contains(lines, l => l.Contains(guest.GuestId) && l.Contains("joined session"));
        Assert.Contains(lines, l => l.Contains(guest.GuestId) && l.Contains("dropped"));
        Assert.DoesNotContain(lines, l => l.Contains("Zebedee") || l.Contains("Quux"));
    }

    private class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}

public class GuestNameTests
{
    [Theory]
    [InlineData("Ann", "Ann")]
    [InlineData("  Ann  ", "Ann")]
    [InlineData("Ann \t\n Lee", "Ann Lee")]
    [InlineData("O'Brien-Smith", "O'Brien-Smith")]
    [InlineData("J. R. R_T", "J. R. R_T")]
    [InlineData("Zoë", "Zoë")]
    [InlineData("李小龍", "李小龍")]
    [InlineData("محمد", "محمد")]
    [InlineData("42", "42")]
    // A letter outside the BMP - two UTF-16 units, still a letter.
    [InlineData("\U0002000Bx", "\U0002000Bx")]
    [InlineData("abcdefghijklmnopqrstuvwx", "abcdefghijklmnopqrstuvwx")]
    public void GoodNames_AreTidied(string raw, string expected)
    {
        var (name, problem) = GuestName.Check(raw);

        Assert.Null(problem);
        Assert.Equal(expected, name);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("a")]
    [InlineData("abcdefghijklmnopqrstuvwxy")]
    [InlineData("<b>")]
    [InlineData(";--")]
    [InlineData("Ann​Lee")]
    [InlineData("Ann‮Lee")]
    [InlineData("\U0001F600\U0001F600")]
    [InlineData("Ann\u0000")]
    [InlineData("--")]
    [InlineData(". _ '")]
    public void BadNames_AreRefused(string? raw)
    {
        var (name, problem) = GuestName.Check(raw);

        Assert.Null(name);
        Assert.NotNull(problem);
    }

    // Kept out of the theory above - half a surrogate pair doesn't survive
    // being a test case name.
    [Fact]
    public void HalfASurrogatePair_IsRefused()
    {
        var (name, problem) = GuestName.Check("Ann" + (char)0xD800);

        Assert.Null(name);
        Assert.Contains("Letters, numbers", problem);
    }

    [Fact]
    public void HugeInput_IsRefusedWithoutTidying()
    {
        var (name, problem) = GuestName.Check(new string(' ', 10_000) + "Ann");

        Assert.Null(name);
        Assert.Contains("At most", problem);
    }
}
