using System.Net;
using System.Text.Json;

namespace RealtimeHub.Auth;

// What annotation-store's GET /invites/{code}/guest says about an invite.
// Status is "open", "expired", "stopped" or "ended".
public record GuestInvite(
    Guid CollectionId,
    string SlideId,
    string CollectionName,
    string HostName,
    string Status,
    DateTimeOffset Expires);

// annotation-store owns invites, so the hub asks it rather than keeping its own.
public interface IGuestInvites
{
    // Null if there's no invite with that code.
    Task<GuestInvite?> FindAsync(string code, CancellationToken cancellationToken);
}

// No token - the endpoint is open, since the code is the only thing a
// guest has. Throws if annotation-store can't be reached.
public class AnnotationStoreGuestInvites(HttpClient http) : IGuestInvites
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<GuestInvite?> FindAsync(string code, CancellationToken cancellationToken)
    {
        using var response = await http.GetAsync($"invites/{Uri.EscapeDataString(code)}/guest", cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound) return null;
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<GuestInvite>(Json, cancellationToken)
            ?? throw new HttpRequestException("annotation-store sent back an empty invite");
    }
}
