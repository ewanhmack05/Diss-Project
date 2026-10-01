using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RealtimeHub.Slides;

namespace RealtimeHub.Tests;

// Stands in for Keycloak in tests: the user is whoever ?test-user= says.
// Query rather than a header, since the tests' WebSockets can't carry headers.
public class TestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string Scheme = "Test";

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
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureServices(services =>
        {
            services.AddAuthentication(TestAuthHandler.Scheme)
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.Scheme, _ => { });
            services.AddSingleton<ISessionAccess, TestSessionAccess>();
        });
    }
}

// Stands in for annotation-store: every session is open to everyone, apart
// from ids starting "locked", which nobody can join.
public class TestSessionAccess : ISessionAccess
{
    public Task<bool> CanJoinAsync(string sessionId, string accessToken, CancellationToken cancellationToken) =>
        Task.FromResult(!sessionId.StartsWith("locked", StringComparison.Ordinal));
}
