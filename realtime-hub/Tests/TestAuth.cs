using System.Net;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RealtimeHub.Auth;
using RealtimeHub.Presence;
using RealtimeHub.Slides;

namespace RealtimeHub.Tests;

// Stands in for Keycloak in tests: the user is whoever ?test-user= says.
// Query rather than a header, since the tests' WebSockets can't carry headers.
public class TestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public new const string Scheme = "Test";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var userId = Request.Query["test-user"].FirstOrDefault();
        if (string.IsNullOrEmpty(userId)) return Task.FromResult(AuthenticateResult.NoResult());
        var identity = new ClaimsIdentity([new Claim("sub", userId), new Claim("name", $"User {userId}")], Scheme);
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme)));
    }
}

public class HubFactory : WebApplicationFactory<Program>
{
    // Everything the app logs, at the levels appsettings.json allows, plus
    // anything from the hub's own code at any level.
    public CapturingLoggerProvider Logs { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureLogging(logging =>
        {
            logging.AddProvider(Logs);
            logging.AddFilter<CapturingLoggerProvider>("RealtimeHub", LogLevel.Trace);
        });
        builder.ConfigureServices(services =>
        {
            services.AddAuthentication(TestAuthHandler.Scheme)
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.Scheme, _ => { });
            services.AddSingleton<ISessionAccess, TestSessionAccess>();
            services.AddSingleton<IUserDirectory, TestUserDirectory>();
            services.AddSingleton<IGuestInvites, TestGuestInvites>();
            services.AddSingleton<IStartupFilter, TestRemoteAddress>();
        });
    }
}

// The test server has no client address, so every request would share one
// rate limit. X-Test-Ip gives each test its own.
public class TestRemoteAddress : IStartupFilter
{
    public const string Header = "X-Test-Ip";

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use((context, nextMiddleware) =>
        {
            if (IPAddress.TryParse(context.Request.Headers[Header].FirstOrDefault(), out var address))
                context.Connection.RemoteIpAddress = address;
            return nextMiddleware(context);
        });
        next(app);
    };

    // A different made up address every call.
    public static string NewAddress() => new IPAddress(Random.Shared.NextInt64(1, uint.MaxValue)).ToString();
}

// Stands in for annotation-store's GET /invites/{code}/guest. A code is
// "{kind}_{session id, N format}". Kind "open" runs out in 10 hours,
// "soon" in 1, "late" says open but ran out a minute ago, and "expired",
// "stopped" and "ended" are that status, and "down" is annotation-store
// not answering. Anything else isn't an invite.
public class TestGuestInvites : IGuestInvites
{
    public Task<GuestInvite?> FindAsync(string code, CancellationToken cancellationToken)
    {
        var parts = code.Split('_', 2);
        if (parts.Length != 2 || !Guid.TryParseExact(parts[1], "N", out var sessionId))
            return Task.FromResult<GuestInvite?>(null);
        if (parts[0] == "down") throw new HttpRequestException("annotation-store is down");
        var now = DateTimeOffset.UtcNow;
        (string Status, DateTimeOffset Expires)? found = parts[0] switch
        {
            "open" => ("open", now.AddHours(10)),
            "soon" => ("open", now.AddHours(1)),
            "late" => ("open", now.AddMinutes(-1)),
            "expired" => ("expired", now.AddMinutes(-1)),
            "stopped" => ("stopped", now.AddHours(1)),
            "ended" => ("ended", now.AddHours(1)),
            _ => null,
        };
        return Task.FromResult(found is { } f
            ? new GuestInvite(sessionId, "slide-1", "Test session", "User host", f.Status, f.Expires)
            : null);
    }

    public static string Code(string kind, Guid sessionId) => $"{kind}_{sessionId:N}";
}

// Keeps every log line, formatted and with its values, so tests can check
// what does and doesn't end up in the logs.
public class CapturingLoggerProvider : ILoggerProvider
{
    public System.Collections.Concurrent.ConcurrentQueue<string> Lines { get; } = new();

    public ILogger CreateLogger(string categoryName) => new Capturing(categoryName, Lines);

    public void Dispose() { }

    private class Capturing(string category, System.Collections.Concurrent.ConcurrentQueue<string> lines) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull
        {
            lines.Enqueue($"{category} scope: {state}");
            return null;
        }

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            var values = state is IEnumerable<KeyValuePair<string, object?>> pairs
                ? string.Join(", ", pairs.Select(p => $"{p.Key}={p.Value}"))
                : "";
            lines.Enqueue($"{logLevel} {category}: {formatter(state, exception)} [{values}] {exception}");
        }
    }
}

// Stands in for annotation-store: every session is open to everyone, apart
// from ids starting "locked", which nobody can join, and ids in Ended.
// Users whose id starts "host" own whatever they join, "viewer" can only
// view, anyone else can edit - guests included, so the tests show the hub
// makes them view only itself. Roles can be changed for a user, like the
// host would.
public class TestSessionAccess : ISessionAccess
{
    public static readonly System.Collections.Concurrent.ConcurrentDictionary<string, SessionRole> Changed = new();
    public static readonly System.Collections.Concurrent.ConcurrentDictionary<string, bool> Ended = new();

    public Task<SessionRole?> RoleInAsync(string sessionId, string userId, string accessToken, CancellationToken cancellationToken) =>
        Task.FromResult<SessionRole?>(
            sessionId.StartsWith("locked", StringComparison.Ordinal) || Ended.ContainsKey(sessionId) ? null
            : Changed.TryGetValue(userId, out var changed) ? changed
            : userId.StartsWith("host", StringComparison.Ordinal) ? SessionRole.Owner
            : userId.StartsWith("viewer", StringComparison.Ordinal) ? SessionRole.Viewer
            : SessionRole.Editor);
}

// Stands in for Keycloak's user list. Fails once Fail is set, like Keycloak
// being down with nothing fetched yet.
public class TestUserDirectory : IUserDirectory
{
    public static readonly IReadOnlyList<DirectoryUser> Everyone =
    [
        new("alice", "alice", "User alice"),
        new("bob", "bob", "User bob"),
        new("carol", "carol", "User carol"),
    ];

    public static volatile bool Fail;

    public Task<IReadOnlyList<DirectoryUser>> AllAsync(CancellationToken cancellationToken) =>
        Fail ? throw new HttpRequestException("Keycloak is down") : Task.FromResult(Everyone);
}
