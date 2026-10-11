using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using RealtimeHub.Presence;

namespace RealtimeHub.Tests;

// KeycloakUserDirectory against a pretend Keycloak - what it asks for, what
// it does with the answer, and how it copes when Keycloak isn't there.
public class UserDirectoryTests
{
    private const string Metadata = "http://kc:8080/auth/realms/diss/.well-known/openid-configuration";

    // Answers the token and users endpoints, and writes down every request.
    private sealed class FakeKeycloak : HttpMessageHandler
    {
        public List<HttpRequestMessage> Requests { get; } = [];
        public List<string> TokenForms { get; } = [];
        public List<object> Users { get; set; } = [];
        public HttpStatusCode UsersStatus { get; set; } = HttpStatusCode.OK;
        public HttpStatusCode TokenStatus { get; set; } = HttpStatusCode.OK;
        public bool Down { get; set; }
        public int TokenExpiresIn { get; set; } = 300;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            if (Down) throw new HttpRequestException("Connection refused");
            var path = request.RequestUri!.AbsolutePath;
            if (path == "/auth/realms/diss/protocol/openid-connect/token")
            {
                TokenForms.Add(await request.Content!.ReadAsStringAsync(cancellationToken));
                return Json(TokenStatus, new { access_token = $"token-{TokenForms.Count}", expires_in = TokenExpiresIn });
            }
            if (path == "/auth/admin/realms/diss/users")
            {
                var query = System.Web.HttpUtility.ParseQueryString(request.RequestUri.Query);
                var first = int.Parse(query["first"]!);
                var max = int.Parse(query["max"]!);
                return Json(UsersStatus, Users.Skip(first).Take(max));
            }
            return new HttpResponseMessage(HttpStatusCode.NotFound);
        }

        private static HttpResponseMessage Json(HttpStatusCode status, object body) =>
            new(status) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };

        public int UserCalls => Requests.Count(r => r.RequestUri!.AbsolutePath.EndsWith("/users"));
    }

    private sealed class Clients(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 12, 9, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static KeycloakUserDirectory Directory(FakeKeycloak keycloak, Clock clock, string? secret = "shh") =>
        new(new Clients(keycloak),
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Auth:MetadataAddress"] = Metadata,
                ["Auth:Realm"] = "diss",
                ["Auth:AdminClientId"] = "realtime-hub",
                ["Auth:AdminClientSecret"] = secret,
            }).Build(),
            clock,
            NullLogger<KeycloakUserDirectory>.Instance);

    private static object KcUser(string id, string username, string? first = null, string? last = null, bool enabled = true) =>
        new { id, username, firstName = first, lastName = last, enabled };

    [Fact]
    public async Task SignsInAsItsServiceAccount_AndReadsTheRealmsUsers()
    {
        var keycloak = new FakeKeycloak { Users = [KcUser("u1", "bob", "Bob", "Hughes"), KcUser("u2", "alice", "Alice", "Moore")] };

        var users = await Directory(keycloak, new Clock()).AllAsync(CancellationToken.None);

        Assert.Equal(["Alice Moore", "Bob Hughes"], users.Select(u => u.DisplayName));
        Assert.Equal("u2", users[0].UserId);
        Assert.Equal("alice", users[0].Username);
        var form = Assert.Single(keycloak.TokenForms);
        Assert.Contains("grant_type=client_credentials", form);
        Assert.Contains("client_id=realtime-hub", form);
        Assert.Contains("client_secret=shh", form);
        var list = keycloak.Requests.Single(r => r.RequestUri!.AbsolutePath.EndsWith("/users"));
        Assert.Equal("Bearer token-1", list.Headers.Authorization!.ToString());
        Assert.Contains("briefRepresentation=true", list.RequestUri!.Query);
    }

    [Fact]
    public async Task LeavesOutDisabledAccounts_AndNamesThemLikeTheToken()
    {
        var keycloak = new FakeKeycloak
        {
            Users = [KcUser("u1", "dave"), KcUser("u2", "erin", "Erin"), KcUser("u3", "frank", "Frank", "Lee", enabled: false)],
        };

        var users = await Directory(keycloak, new Clock()).AllAsync(CancellationToken.None);

        Assert.Equal(["dave", "Erin"], users.Select(u => u.DisplayName));
    }

    [Fact]
    public async Task ReadsEveryPage()
    {
        var keycloak = new FakeKeycloak
        {
            Users = [.. Enumerable.Range(0, KeycloakUserDirectory.PageSize + 3).Select(i => KcUser($"u{i}", $"user{i:D4}"))],
        };

        var users = await Directory(keycloak, new Clock()).AllAsync(CancellationToken.None);

        Assert.Equal(KeycloakUserDirectory.PageSize + 3, users.Count);
        Assert.Equal(2, keycloak.UserCalls);
    }

    [Fact]
    public async Task KeepsTheListForAMinute_ThenFetchesAgain_ReusingTheToken()
    {
        var keycloak = new FakeKeycloak { Users = [KcUser("u1", "alice")] };
        var clock = new Clock();
        var directory = Directory(keycloak, clock);

        await directory.AllAsync(CancellationToken.None);
        clock.Now += TimeSpan.FromSeconds(59);
        await directory.AllAsync(CancellationToken.None);
        Assert.Equal(1, keycloak.UserCalls);

        keycloak.Users = [KcUser("u1", "alice"), KcUser("u2", "bob")];
        clock.Now += TimeSpan.FromSeconds(2);
        var later = await directory.AllAsync(CancellationToken.None);

        Assert.Equal(2, later.Count);
        Assert.Equal(2, keycloak.UserCalls);
        Assert.Single(keycloak.TokenForms);
    }

    [Fact]
    public async Task SignsInAgain_OnceTheTokenRunsOut()
    {
        var keycloak = new FakeKeycloak { Users = [KcUser("u1", "alice")], TokenExpiresIn = 60 };
        var clock = new Clock();
        var directory = Directory(keycloak, clock);

        await directory.AllAsync(CancellationToken.None);
        // Past the list's minute, and past the token's 60s less the 30s margin.
        clock.Now += TimeSpan.FromSeconds(61);
        await directory.AllAsync(CancellationToken.None);

        Assert.Equal(2, keycloak.TokenForms.Count);
    }

    [Fact]
    public async Task UsesTheLastList_WhileKeycloakIsDown()
    {
        var keycloak = new FakeKeycloak { Users = [KcUser("u1", "alice")] };
        var clock = new Clock();
        var directory = Directory(keycloak, clock);
        await directory.AllAsync(CancellationToken.None);

        keycloak.Down = true;
        clock.Now += TimeSpan.FromMinutes(5);
        var users = await directory.AllAsync(CancellationToken.None);

        Assert.Equal(["alice"], users.Select(u => u.DisplayName));
    }

    [Fact]
    public async Task Throws_WhenTheresNoListToGive()
    {
        await Assert.ThrowsAsync<HttpRequestException>(() =>
            Directory(new FakeKeycloak { Down = true }, new Clock()).AllAsync(CancellationToken.None));
        await Assert.ThrowsAsync<HttpRequestException>(() =>
            Directory(new FakeKeycloak { TokenStatus = HttpStatusCode.Unauthorized }, new Clock()).AllAsync(CancellationToken.None));
        // Signed in, but the client hasn't been given view-users.
        var forbidden = await Assert.ThrowsAsync<HttpRequestException>(() =>
            Directory(new FakeKeycloak { UsersStatus = HttpStatusCode.Forbidden }, new Clock()).AllAsync(CancellationToken.None));
        Assert.Contains("view-users", forbidden.Message);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Directory(new FakeKeycloak(), new Clock(), secret: null).AllAsync(CancellationToken.None));
    }

    [Fact]
    public void KeycloaksAddress_ComesFromTheMetadataAddress()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Auth:MetadataAddress"] = Metadata,
        }).Build();

        Assert.Equal(("http://kc:8080/auth", "diss"), KeycloakUserDirectory.KeycloakAddress(config));
    }
}
