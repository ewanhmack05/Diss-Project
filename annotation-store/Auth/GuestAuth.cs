using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace AnnotationStore.Auth;

// Guest tokens, made by realtime-hub for someone without an account who
// opened an invite link - see docs/guests.md. A guest is view only on the one
// session in the token, and only on the endpoints marked with Policy. Every
// other endpoint stays Keycloak only, so a guest token gets a 401 there.
// There's no name in the token, so nothing here can ever save it.
public static class GuestAuth
{
    public const string Scheme = "Guest";
    public const string Policy = "KeycloakOrGuest";
    public const string Issuer = "realtime-hub";
    public const string Audience = "diss-guest";
    public const string SessionClaim = "guest_session";
    public const string IdPrefix = "guest-";

    public static void AddGuestAuth(this WebApplicationBuilder builder)
    {
        var key = SigningKey(builder.Configuration["GuestTokens:SigningKey"]);

        builder.Services.AddAuthentication().AddJwtBearer(Scheme, options =>
        {
            options.MapInboundClaims = false;
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidIssuer = Issuer,
                ValidAudience = Audience,
                IssuerSigningKey = key,
                ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                RequireExpirationTime = true,
                // The hub and the store share a clock near enough.
                ClockSkew = TimeSpan.FromSeconds(30),
                NameClaimType = "sub",
                AuthenticationType = Scheme,
            };
            options.Events = new JwtBearerEvents
            {
                OnTokenValidated = context =>
                {
                    if (!IsGuestShaped(context.Principal)) context.Fail("Not a guest token");
                    return Task.CompletedTask;
                },
            };
        });

        // Keycloak's scheme is whichever is the default - read once the
        // options are built, so the tests' stand-in for Keycloak counts too.
        builder.Services.AddOptions<AuthorizationOptions>()
            .Configure<IOptions<AuthenticationOptions>>((authorization, authentication) =>
                authorization.AddPolicy(Policy, policy => policy
                    .AddAuthenticationSchemes(authentication.Value.DefaultScheme ?? JwtBearerDefaults.AuthenticationScheme, Scheme)
                    .RequireAuthenticatedUser()));
    }

    public static SymmetricSecurityKey SigningKey(string? base64)
    {
        if (string.IsNullOrWhiteSpace(base64))
            throw new InvalidOperationException("GuestTokens:SigningKey isn't set");
        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(base64);
        }
        catch (FormatException)
        {
            throw new InvalidOperationException("GuestTokens:SigningKey isn't base64");
        }
        if (bytes.Length != 32)
            throw new InvalidOperationException($"GuestTokens:SigningKey has to be 32 bytes, not {bytes.Length}");
        return new SymmetricSecurityKey(bytes);
    }

    // A guest id, one session, and no name - anything else isn't a token the
    // hub would make.
    public static bool IsGuestShaped(ClaimsPrincipal? principal) =>
        principal is not null
        && principal.FindFirstValue("sub") is { } sub && sub.StartsWith(IdPrefix, StringComparison.Ordinal)
        && Guid.TryParse(principal.FindFirstValue(SessionClaim), out _)
        && principal.FindFirst("name") is null;

    public static bool IsGuest(this ClaimsPrincipal user) =>
        user.Identities.Any(i => i.IsAuthenticated && i.AuthenticationType == Scheme);

    // The one session a guest can see. Null for anyone signed in.
    public static Guid? GuestSessionId(this ClaimsPrincipal user) =>
        user.IsGuest() && Guid.TryParse(user.FindFirstValue(SessionClaim), out var id) ? id : null;

    // For the endpoints a guest can read.
    public static TBuilder AllowGuests<TBuilder>(this TBuilder builder) where TBuilder : IEndpointConventionBuilder =>
        builder.RequireAuthorization(Policy);
}
