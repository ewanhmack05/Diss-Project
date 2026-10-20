using System.Net.Http.Headers;
using System.Security.Cryptography;
using AnnotationStore.Auth;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace AnnotationStore.Tests;

// Real HS256 guest tokens, made the way realtime-hub makes them (see
// docs/guests.md), so tests go through the real Guest scheme.
public static class GuestTokens
{
    public static string Key(CellCountApiFactory factory) =>
        factory.Services.GetRequiredService<IConfiguration>()["GuestTokens:SigningKey"]!;

    public static string NewGuestId() =>
        GuestAuth.IdPrefix + Base64UrlEncoder.Encode(RandomNumberGenerator.GetBytes(16));

    public static string Make(
        string base64Key,
        Guid sessionId,
        string? guestId = null,
        DateTime? expires = null,
        string issuer = GuestAuth.Issuer,
        string audience = GuestAuth.Audience,
        IDictionary<string, object>? extraClaims = null,
        string? sessionClaim = null)
    {
        var until = expires ?? DateTime.UtcNow.AddHours(4);
        var claims = new Dictionary<string, object>
        {
            ["sub"] = guestId ?? NewGuestId(),
            [GuestAuth.SessionClaim] = sessionClaim ?? sessionId.ToString("D"),
        };
        foreach (var (name, value) in extraClaims ?? new Dictionary<string, object>()) claims[name] = value;

        var from = until < DateTime.UtcNow ? until.AddHours(-1) : DateTime.UtcNow;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            Claims = claims,
            IssuedAt = from,
            NotBefore = from,
            Expires = until,
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Convert.FromBase64String(base64Key)), SecurityAlgorithms.HmacSha256),
        });
    }

    public static HttpClient With(HttpClient client, string token)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
}
