using System.Buffers.Text;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace RealtimeHub.Auth;

// Tokens for people joining from an invite link without an account - see
// docs/guests.md for the contract. Minted here (POST /guests, see
// GuestEndpoints.cs), checked here and by annotation-store. A token is a
// random guest id and one session id. The name they type is never in it.
public static class GuestTokens
{
    public const string Scheme = "Guest";
    // Picks Keycloak or guest by who issued the token. Only /hubs/slides uses it.
    public const string EitherScheme = "KeycloakOrGuest";
    public const string SlideHubPolicy = "SlideHub";

    public const string Issuer = "realtime-hub";
    public const string Audience = "diss-guest";
    public const string SessionClaim = "guest_session";
    public const string IdPrefix = "guest-";
    public static readonly TimeSpan MaxLifetime = TimeSpan.FromHours(4);

    private static readonly JsonWebTokenHandler Reader = new();

    public static void AddGuestAuth(this WebApplicationBuilder builder)
    {
        // Read when first used rather than now, so the tests' config gets a say.
        builder.Services.AddSingleton(services => new GuestTokenIssuer(
            SigningKey(services.GetRequiredService<IConfiguration>()["GuestTokens:SigningKey"]),
            services.GetRequiredService<TimeProvider>()));

        builder.Services.AddAuthentication()
            .AddJwtBearer(Scheme, _ => { })
            .AddPolicyScheme(EitherScheme, null, options =>
                options.ForwardDefaultSelector = context =>
                    IsGuestToken(TokenFrom(context.Request)) ? Scheme : DefaultScheme(context));

        builder.Services.AddOptions<JwtBearerOptions>(Scheme).Configure<IConfiguration>((options, config) =>
        {
            options.MapInboundClaims = false;
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidIssuer = Issuer,
                ValidAudience = Audience,
                IssuerSigningKey = SigningKey(config["GuestTokens:SigningKey"]),
                ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                NameClaimType = "sub",
            };
            options.Events = new JwtBearerEvents { OnMessageReceived = KeycloakAuth.TakeHubQueryToken };
        });

        builder.Services.AddAuthorizationBuilder()
            .AddPolicy(SlideHubPolicy, policy => policy.AddAuthenticationSchemes(EitherScheme).RequireAuthenticatedUser());
    }

    public static SymmetricSecurityKey SigningKey(string? base64)
    {
        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(base64 ?? "");
        }
        catch (FormatException)
        {
            bytes = [];
        }
        if (bytes.Length != 32) throw new InvalidOperationException("GuestTokens:SigningKey has to be 32 bytes, base64");
        return new SymmetricSecurityKey(bytes);
    }

    public static bool IsGuest(this ClaimsPrincipal user) =>
        user.FindFirstValue("iss") == Issuer && user.HasClaim(c => c.Type == SessionClaim);

    // The one session this guest's token is for.
    public static string? GuestSessionId(this ClaimsPrincipal user) =>
        user.IsGuest() ? user.FindFirstValue(SessionClaim) : null;

    // Only peeks at the issuer to pick a scheme - the guest scheme still
    // checks the signature and everything else.
    private static bool IsGuestToken(string? token) =>
        !string.IsNullOrEmpty(token) && Reader.CanReadToken(token) && ReadIssuer(token) == Issuer;

    private static string? ReadIssuer(string token)
    {
        try
        {
            return Reader.ReadJsonWebToken(token).Issuer;
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    // Same places JwtBearer looks: ?access_token= on the hubs, otherwise the header.
    private static string? TokenFrom(HttpRequest request)
    {
        if (request.Path.StartsWithSegments("/hubs"))
        {
            var fromQuery = request.Query["access_token"].FirstOrDefault();
            if (!string.IsNullOrEmpty(fromQuery)) return fromQuery;
        }
        var header = request.Headers.Authorization.FirstOrDefault() ?? "";
        return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header["Bearer ".Length..].Trim() : null;
    }

    // Keycloak normally, or whatever stands in for it in the tests.
    private static string? DefaultScheme(HttpContext context)
    {
        var options = context.RequestServices.GetRequiredService<IOptions<AuthenticationOptions>>().Value;
        return options.DefaultAuthenticateScheme ?? options.DefaultScheme;
    }
}

public record GuestToken(string Token, string GuestId, DateTimeOffset Expires);

public class GuestTokenIssuer(SymmetricSecurityKey key, TimeProvider time)
{
    private static readonly JsonWebTokenHandler Writer = new() { SetDefaultTimesOnTokenCreation = false };

    // Lasts until the invite runs out, or 4 hours, whichever is sooner. Null
    // if the invite has already run out.
    public GuestToken? Mint(Guid sessionId, DateTimeOffset inviteExpires)
    {
        // Whole seconds, so what's sent back matches what's in the token.
        var now = DateTimeOffset.FromUnixTimeSeconds(time.GetUtcNow().ToUnixTimeSeconds());
        var cap = now + GuestTokens.MaxLifetime;
        var expires = DateTimeOffset.FromUnixTimeSeconds((inviteExpires < cap ? inviteExpires : cap).ToUnixTimeSeconds());
        if (expires <= now) return null;

        var guestId = GuestTokens.IdPrefix + Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(16));
        var token = Writer.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = GuestTokens.Issuer,
            Audience = GuestTokens.Audience,
            Claims = new Dictionary<string, object>
            {
                ["sub"] = guestId,
                [GuestTokens.SessionClaim] = sessionId.ToString("D"),
            },
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = expires.UtcDateTime,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
        });
        return new GuestToken(token, guestId, expires);
    }
}
