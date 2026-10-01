using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RealtimeHub.Slides;

// Whether someone can join a session's room. annotation-store owns who's in
// which session (see its Collections/CollectionEndpoints.cs), so the hub asks
// it rather than keeping its own list.
public interface ISessionAccess
{
    Task<bool> CanJoinAsync(string sessionId, string accessToken, CancellationToken cancellationToken);
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

    private record Membership(Kind Kind, DateTimeOffset? Ended);

    public async Task<bool> CanJoinAsync(string sessionId, string accessToken, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(sessionId, out var id) || string.IsNullOrEmpty(accessToken)) return false;

        using var request = new HttpRequestMessage(HttpMethod.Get, $"collections/{id}/membership");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var response = await http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) return false;

        var membership = await response.Content.ReadFromJsonAsync<Membership>(Json, cancellationToken);
        return membership is { Kind: Kind.Session, Ended: null };
    }
}
