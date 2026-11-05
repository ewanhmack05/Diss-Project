using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Messaging.Sessions;

public enum SessionRole { Viewer, Editor, Owner }

// Someone's place in a session. Ended means its chat is read only.
public record SessionMembership(SessionRole Role, bool Ended);

// Whether someone's in a session, and as what. annotation-store owns who's in
// which session, so this asks it every time rather than keeping a list, and
// someone taken out of a session loses its chat straight away.
public interface ISessionAccess
{
    // Null if they're not in it, or it isn't a session. Throws
    // SessionAccessUnavailable if nobody can say.
    Task<SessionMembership?> MembershipAsync(Guid sessionId, string accessToken, CancellationToken cancellationToken);
}

public class SessionAccessUnavailable(string message, Exception? inner = null) : Exception(message, inner);

// Asks with the person's own token, so it answers for them.
public class AnnotationStoreSessionAccess(HttpClient http) : ISessionAccess
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    private enum Kind { Personal, Session }

    private record Membership(Kind Kind, SessionRole Role, DateTimeOffset? Ended);

    public async Task<SessionMembership?> MembershipAsync(Guid sessionId, string accessToken, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"collections/{sessionId}/membership");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        try
        {
            using var response = await http.SendAsync(request, cancellationToken);
            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden) return null;
            if (!response.IsSuccessStatusCode) throw new SessionAccessUnavailable($"annotation-store said {(int)response.StatusCode}");
            var membership = await response.Content.ReadFromJsonAsync<Membership>(Json, cancellationToken);
            return membership?.Kind == Kind.Session ? new SessionMembership(membership.Role, membership.Ended is not null) : null;
        }
        catch (Exception problem) when (problem is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            throw new SessionAccessUnavailable("Couldn't reach annotation-store", problem);
        }
    }
}
