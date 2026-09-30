using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AnnotationStore.Tests;

// Stands in for Keycloak in tests: whoever the X-Test-User header says, or
// "001" with no header. X-Test-Name sets their display name.
public class TestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string Scheme = "Test";
    public const string DefaultUser = "001";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var userId = Request.Headers["X-Test-User"].FirstOrDefault() ?? DefaultUser;
        var name = Request.Headers["X-Test-Name"].FirstOrDefault() ?? $"User {userId}";
        var identity = new ClaimsIdentity([new Claim("sub", userId), new Claim("name", name)], Scheme);
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme)));
    }

    public static HttpClient As(HttpClient client, string userId, string? name = null)
    {
        client.DefaultRequestHeaders.Add("X-Test-User", userId);
        if (name is not null) client.DefaultRequestHeaders.Add("X-Test-Name", name);
        return client;
    }
}
