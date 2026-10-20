using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace RealtimeHub.Auth;

public record GuestRequest(string? InviteCode);

public record GuestResponse(string Token, string GuestId, string SessionId, string SlideId, DateTimeOffset Expires);

public record GuestRefused(string Status);

// POST /guests - swaps an invite code for a guest token (see GuestTokens.cs
// and docs/guests.md). No sign-in, so it's rate limited per address. A code
// is 72 random bits, so this is only there to stop a flood, not guessing -
// and a whole class can join from behind one school address.
public static partial class GuestEndpoints
{
    public const string RateLimitPolicy = "guests";
    public const int MintsPerMinute = 60;
    public const int MaxCodeLength = 64;

    // Invite codes are url-safe base64 - see annotation-store's CollectionEndpoints.
    [GeneratedRegex("^[A-Za-z0-9_-]+$")]
    private static partial Regex CodeShape();

    public static void AddGuestRateLimit(this IServiceCollection services) =>
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.AddPolicy(RateLimitPolicy, context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = MintsPerMinute,
                    Window = TimeSpan.FromMinutes(1),
                    QueueLimit = 0,
                }));
        });

    public static void MapGuests(this WebApplication app)
    {
        app.MapPost("/guests", async (GuestRequest? request, IGuestInvites invites, GuestTokenIssuer issuer,
            ILoggerFactory loggers, CancellationToken ct) =>
        {
            var logger = loggers.CreateLogger(typeof(GuestEndpoints));
            var code = request?.InviteCode;
            if (string.IsNullOrWhiteSpace(code)) return Results.BadRequest(new { error = "inviteCode is required" });
            // Can't be a real code, so no need to ask.
            if (code.Length > MaxCodeLength || !CodeShape().IsMatch(code)) return Results.NotFound();

            GuestInvite? invite;
            try
            {
                invite = await invites.FindAsync(code, ct);
            }
            catch (Exception e) when (e is HttpRequestException or JsonException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                logger.LogWarning(e, "Couldn't check a guest invite with annotation-store");
                return Results.Problem("Couldn't check the invite right now", statusCode: StatusCodes.Status502BadGateway);
            }

            if (invite is null) return Results.NotFound();
            if (invite.Status != "open") return Results.Json(new GuestRefused(invite.Status), statusCode: StatusCodes.Status410Gone);
            // Open but already past its expiry - annotation-store's clock and ours disagree.
            if (issuer.Mint(invite.CollectionId, invite.Expires) is not { } token)
                return Results.Json(new GuestRefused("expired"), statusCode: StatusCodes.Status410Gone);

            logger.LogInformation("{GuestId} let in as a guest to session {SessionId} until {Expires}",
                token.GuestId, invite.CollectionId, token.Expires);
            return Results.Ok(new GuestResponse(token.Token, token.GuestId, invite.CollectionId.ToString("D"),
                invite.SlideId, token.Expires));
        }).AllowAnonymous().RequireRateLimiting(RateLimitPolicy);
    }
}
