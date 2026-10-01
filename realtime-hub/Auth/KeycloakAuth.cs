using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.IdentityModel.Tokens;

namespace RealtimeHub.Auth;

// Same Keycloak check as annotation-store (see its Auth/KeycloakAuth.cs) -
// kept as its own copy so the hub stays a separate, portable service.
// Settings are under "Auth" in appsettings.json.
public static class KeycloakAuth
{
    public static void AddKeycloakAuth(this WebApplicationBuilder builder)
    {
        var settings = builder.Configuration.GetSection("Auth");
        var realm = settings["Realm"] ?? "diss";

        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.MetadataAddress = settings["MetadataAddress"] ?? "";
                options.RequireHttpsMetadata = false;
                options.MapInboundClaims = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidAudience = settings["Audience"] ?? "diss-api",
                    NameClaimType = "name",
                    IssuerValidator = (issuer, _, _) => IsRealmIssuer(issuer, realm)
                        ? issuer
                        : throw new SecurityTokenInvalidIssuerException($"Not a token from the {realm} realm: {issuer}"),
                };
                // Browsers can't set headers on a WebSocket, so SignalR sends
                // the token as ?access_token= instead - only taken for the hub.
                options.Events = new JwtBearerEvents
                {
                    OnMessageReceived = context =>
                    {
                        var token = context.Request.Query["access_token"];
                        if (!string.IsNullOrEmpty(token) && context.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                            context.Token = token;
                        return Task.CompletedTask;
                    },
                };
            });

        builder.Services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
    }

    // See annotation-store's copy - the issuer follows the address the
    // browser used, so only the realm is fixed. The signature is still checked.
    public static bool IsRealmIssuer(string issuer, string realm) =>
        Uri.TryCreate(issuer, UriKind.Absolute, out var uri)
        && uri.Scheme is "http" or "https"
        && uri.AbsolutePath.TrimEnd('/').EndsWith($"/realms/{realm}", StringComparison.Ordinal);
}

public static class UserClaims
{
    public static string UserId(this ClaimsPrincipal user) =>
        user.FindFirstValue("sub") ?? throw new InvalidOperationException("Token has no sub claim");

    public static string DisplayName(this ClaimsPrincipal user) =>
        user.FindFirstValue("name") ?? user.FindFirstValue("preferred_username") ?? user.UserId();
}
