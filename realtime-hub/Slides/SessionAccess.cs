using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RealtimeHub.Slides;

public enum SessionRole { Viewer, Editor, Owner }

// Whether someone can join a session's room, and as what. annotation-store
// owns who's in which session (see its Collections/CollectionEndpoints.cs),
// so the hub asks it rather than keeping its own list.
public interface ISessionAccess
{
    // Null if they can't join. userId is who the token belongs to.
    Task<SessionRole?> RoleInAsync(string sessionId, string userId, string accessToken, CancellationToken cancellationToken);
}

// Asks annotation-store with the user's own token, so it answers for them.
// Only a session that hasn't ended has a room - a personal collection never does.
public class AnnotationStoreSessionAccess(HttpClient http) : ISessionAccess
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private enum Kind { Personal, Session }

    private record Membership(Kind Kind, SessionRole Role, DateTimeOffset? Ended);

    public async Task<SessionRole?> RoleInAsync(string sessionId, string userId, string accessToken, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(sessionId, out var id) || string.IsNullOrEmpty(accessToken)) return null;

        using var request = new HttpRequestMessage(HttpMethod.Get, $"collections/{id}/membership");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var response = await http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) return null;

        var membership = await response.Content.ReadFromJsonAsync<Membership>(Json, cancellationToken);
        return membership is { Kind: Kind.Session, Ended: null } ? membership.Role : null;
    }
}
