using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using RealtimeHub.Presence;
using RealtimeHub.Slides;

namespace RealtimeHub.Tests;

// OnlineUsers on its own - who counts as online, and the versions clients
// use to tell which message about someone is newer.
public class OnlineUsersTests
{
    private static readonly PresenceWhere OnSlide = new("003", null, false);

    [Fact]
    public void FirstTab_BringsSomeoneOnline()
    {
        var online = new OnlineUsers();

        var alice = online.Connect("c1", "alice", "Alice");

        Assert.NotNull(alice);
        Assert.Equal("Alice", alice.DisplayName);
        Assert.Null(alice.SlideId);
        Assert.Single(online.Snapshot().Users);
    }

    [Fact]
    public void TwoTabs_AreOnePerson_OnlineUntilTheLastGoes()
    {
        var online = new OnlineUsers();
        online.Connect("c1", "alice", "Alice");

        // A second tab that hasn't said where it is changes nothing anyone sees.
        Assert.Null(online.Connect("c2", "alice", "Alice"));
        Assert.Single(online.Snapshot().Users);

        var (changed, offline) = online.Disconnect("c1");
        Assert.Null(changed);
        Assert.Null(offline);
        Assert.Single(online.Snapshot().Users);

        (changed, offline) = online.Disconnect("c2");
        Assert.Null(changed);
        Assert.Equal("alice", offline!.UserId);
        Assert.Empty(online.Snapshot().Users);
    }

    [Fact]
    public void Where_IsWhicheverTabLastSaid()
    {
        var online = new OnlineUsers();
        online.Connect("c1", "alice", "Alice");
        online.Connect("c2", "alice", "Alice");

        online.SetWhere("c1", new PresenceWhere("001", null, false));
        var later = online.SetWhere("c2", new PresenceWhere("003", "s1", true));
        Assert.Equal("003", later!.SlideId);
        Assert.True(later.Hosting);

        // The tab that last said goes - back to the other one's.
        var (changed, _) = online.Disconnect("c2");
        Assert.Equal("001", changed!.SlideId);
        Assert.Null(changed.SessionId);
        Assert.False(changed.Hosting);
    }

    [Fact]
    public void SayingTheSameThingAgain_ChangesNothing()
    {
        var online = new OnlineUsers();
        online.Connect("c1", "alice", "Alice");

        Assert.NotNull(online.SetWhere("c1", OnSlide));
        Assert.Null(online.SetWhere("c1", OnSlide));
    }

    [Fact]
    public void Versions_OnlyGoUp_AndTheSnapshotIsAtLeastAsNew()
    {
        var online = new OnlineUsers();
        var a = online.Connect("c1", "alice", "Alice")!;
        var b = online.Connect("c2", "bob", "Bob")!;
        var moved = online.SetWhere("c1", OnSlide)!;
        var (_, gone) = online.Disconnect("c2");

        Assert.True(a.Version < b.Version);
        Assert.True(b.Version < moved.Version);
        Assert.True(moved.Version < gone!.Version);
        Assert.Equal(gone.Version, online.Snapshot().Version);
    }

    [Fact]
    public void UnknownConnections_AreIgnored()
    {
        var online = new OnlineUsers();

        Assert.Null(online.SetWhere("nope", OnSlide));
        Assert.Equal((null, null), online.Disconnect("nope"));
        Assert.Empty(online.ConnectionsOf("alice"));
    }
}

// The hub end to end, over real WebSockets against the test server. The
// OnlineUsers singleton is shared by every test here, so each test uses its
// own user ids and only looks for those.
public class PresenceHubTests : IClassFixture<HubFactory>
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);
    private readonly HubFactory _factory;

    public PresenceHubTests(HubFactory factory)
    {
        _factory = factory;
    }

    private async Task<HubConnection> ConnectAsync(string userId)
    {
        var server = _factory.Server;
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, $"/hubs/presence?test-user={userId}"), options =>
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

    private static string NewUser(string name) => $"{name}-{Guid.NewGuid():N}";

    // Waits for the first message that matches.
    private static TaskCompletionSource<T> Listen<T>(HubConnection c, string method, Func<T, bool> match)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        c.On<T>(method, value =>
        {
            if (match(value)) tcs.TrySetResult(value);
        });
        return tcs;
    }

    [Fact]
    public async Task Connecting_ShowsYouOnline_ToEveryoneElse()
    {
        var aliceId = NewUser("alice");
        var bobId = NewUser("bob");
        await using var alice = await ConnectAsync(aliceId);
        var bobOnline = Listen<OnlineUser>(alice, nameof(IPresenceClient.UserOnline), u => u.UserId == bobId);

        await using var bob = await ConnectAsync(bobId);

        var seen = await bobOnline.Task.WaitAsync(Timeout);
        Assert.Equal($"User {bobId}", seen.DisplayName);
        var snapshot = await bob.InvokeAsync<OnlineSnapshot>("Online");
        Assert.Contains(snapshot.Users, u => u.UserId == aliceId);
        Assert.Contains(snapshot.Users, u => u.UserId == bobId);
        Assert.True(snapshot.Version >= seen.Version);
    }

    [Fact]
    public async Task SetWhere_TellsEveryoneElse()
    {
        var aliceId = NewUser("alice");
        await using var alice = await ConnectAsync(aliceId);
        await using var bob = await ConnectAsync(NewUser("bob"));
        var moved = Listen<OnlineUser>(bob, nameof(IPresenceClient.UserOnline), u => u.UserId == aliceId && u.SlideId == "003");

        await alice.InvokeAsync("SetWhere", new PresenceWhere("003", "session-1", true));

        var seen = await moved.Task.WaitAsync(Timeout);
        Assert.Equal("session-1", seen.SessionId);
        Assert.True(seen.Hosting);
    }

    [Fact]
    public async Task Leaving_TellsEveryone_YoureOffline()
    {
        var aliceId = NewUser("alice");
        await using var bob = await ConnectAsync(NewUser("bob"));
        var alice = await ConnectAsync(aliceId);
        var gone = Listen<UserOffline>(bob, nameof(IPresenceClient.UserOffline), u => u.UserId == aliceId);

        await alice.DisposeAsync();

        await gone.Task.WaitAsync(Timeout);
        var snapshot = await bob.InvokeAsync<OnlineSnapshot>("Online");
        Assert.DoesNotContain(snapshot.Users, u => u.UserId == aliceId);
    }

    [Fact]
    public async Task InviteUser_ReachesEveryTabTheyHave_FromWhoTheTokenSays()
    {
        var aliceId = NewUser("alice");
        var bobId = NewUser("bob");
        await using var alice = await ConnectAsync(aliceId);
        await using var bobTab1 = await ConnectAsync(bobId);
        await using var bobTab2 = await ConnectAsync(bobId);
        var got1 = Listen<UserInvite>(bobTab1, nameof(IPresenceClient.InviteReceived), _ => true);
        var got2 = Listen<UserInvite>(bobTab2, nameof(IPresenceClient.InviteReceived), _ => true);
        var aliceGot = Listen<UserInvite>(alice, nameof(IPresenceClient.InviteReceived), _ => true);

        await alice.InvokeAsync("InviteUser", bobId, "juyhsUFHC4gB");

        var invite = await got1.Task.WaitAsync(Timeout);
        Assert.Equal("juyhsUFHC4gB", invite.Code);
        Assert.Equal(aliceId, invite.FromUserId);
        Assert.Equal($"User {aliceId}", invite.FromName);
        Assert.Equal(invite.Code, (await got2.Task.WaitAsync(Timeout)).Code);
        await Task.Delay(200);
        Assert.False(aliceGot.Task.IsCompleted);
    }

    [Fact]
    public async Task InviteUser_TurnsDownBadAsks()
    {
        var aliceId = NewUser("alice");
        var bobId = NewUser("bob");
        await using var alice = await ConnectAsync(aliceId);
        await using var bob = await ConnectAsync(bobId);

        var notACode = await Assert.ThrowsAsync<HubException>(() => alice.InvokeAsync("InviteUser", bobId, "not a code!"));
        Assert.Contains("isn't an invite code", notACode.Message);
        var tooLong = await Assert.ThrowsAsync<HubException>(() =>
            alice.InvokeAsync("InviteUser", bobId, new string('a', PresenceHub.MaxCodeLength + 1)));
        Assert.Contains("isn't an invite code", tooLong.Message);
        var self = await Assert.ThrowsAsync<HubException>(() => alice.InvokeAsync("InviteUser", aliceId, "juyhsUFHC4gB"));
        Assert.Contains("yourself", self.Message);
        var offline = await Assert.ThrowsAsync<HubException>(() => alice.InvokeAsync("InviteUser", NewUser("carol"), "juyhsUFHC4gB"));
        Assert.Contains("not online", offline.Message);
    }

    [Fact]
    public async Task SetWhere_LimitsIdLengths()
    {
        await using var alice = await ConnectAsync(NewUser("alice"));

        var ex = await Assert.ThrowsAsync<HubException>(() =>
            alice.InvokeAsync("SetWhere", new PresenceWhere(new string('a', PresenceHub.MaxIdLength + 1), null, false)));

        Assert.Contains("characters", ex.Message);
    }

    [Fact]
    public async Task NotSignedIn_CantConnect()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => ConnectAsync(""));
    }

    [Fact]
    public async Task Users_IsEveryoneWithAnAccount_OnlineOrNot()
    {
        await using var alice = await ConnectAsync(NewUser("alice"));

        var users = await alice.InvokeAsync<List<DirectoryUser>>("Users");

        Assert.Equal(["alice", "bob", "carol"], users.Select(u => u.UserId));
        Assert.Equal("User bob", users[1].DisplayName);
    }

    [Fact]
    public async Task Users_SaysSo_WhenKeycloakCantBeReached()
    {
        await using var alice = await ConnectAsync(NewUser("alice"));
        TestUserDirectory.Fail = true;
        try
        {
            var ex = await Assert.ThrowsAsync<HubException>(() => alice.InvokeAsync<List<DirectoryUser>>("Users"));
            Assert.Contains("user list", ex.Message);
            // The connection is still fine for everything else.
            Assert.NotNull(await alice.InvokeAsync<OnlineSnapshot>("Online"));
        }
        finally
        {
            TestUserDirectory.Fail = false;
        }
    }
}
