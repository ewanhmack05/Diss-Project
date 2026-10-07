using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.IdentityModel.Tokens;

namespace AnnotationStore.Auth;

// Every endpoint needs a Keycloak access token (see auth/), apart from the
// ones marked AllowAnonymous. Settings are under "Auth" in appsettings.json.
public static class KeycloakAuth
{
    public static void AddKeycloakAuth(this WebApplicationBuilder builder)
    {
        var settings = builder.Configuration.GetSection("Auth");
        var realm = settings["Realm"] ?? "diss";

        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                // Keycloak's own address, for its signing keys - not the
                // address the browser used, which is only in the issuer.
                options.MetadataAddress = settings["MetadataAddress"] ?? "";
                options.RequireHttpsMetadata = false;
                // Keep claim names as Keycloak sends them ("sub", "name").
                options.MapInboundClaims = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidAudience = settings["Audience"] ?? "diss-api",
                    NameClaimType = "name",
                    IssuerValidator = (issuer, _, _) => IsRealmIssuer(issuer, realm)
                        ? issuer
                        : throw new SecurityTokenInvalidIssuerException($"Not a token from the {realm} realm: {issuer}"),
                };
            });

        builder.Services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
    }

    // The issuer is whatever address the browser reached Keycloak on -
    // localhost, the LAN or the VPN, all through the viewer's dev server -
    // so only the realm part of it is fixed. The token's signature is still
    // checked against the realm's own keys, so this can't be faked.
    public static bool IsRealmIssuer(string issuer, string realm) =>
        Uri.TryCreate(issuer, UriKind.Absolute, out var uri)
        && uri.Scheme is "http" or "https"
        && uri.AbsolutePath.TrimEnd('/').EndsWith($"/realms/{realm}", StringComparison.Ordinal);
}

public static class UserClaims
{
    // Keycloak's id for the user - what collections and memberships key on.
    public static string UserId(this ClaimsPrincipal user) =>
        user.FindFirstValue("sub") ?? throw new InvalidOperationException("Token has no sub claim");

    public static string DisplayName(this ClaimsPrincipal user) =>
        user.FindFirstValue("name") ?? user.FindFirstValue("preferred_username") ?? user.UserId();
}
