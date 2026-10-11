using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace RealtimeHub.Presence;

// Everyone with an account, for the viewer's Users tab - online or not.
public interface IUserDirectory
{
    // Throws if there's no list to give - nothing fetched yet and Keycloak
    // can't be reached.
    Task<IReadOnlyList<DirectoryUser>> AllAsync(CancellationToken cancellationToken);
}

// Reads the realm's users from Keycloak's admin API, signed in as the
// realtime-hub client's service account, which can only view users (see
// auth/README.md). Kept for a minute - accounts don't change often, and
// every viewer asks when it connects. If Keycloak goes away, the last list
// is used until it's back.
public class KeycloakUserDirectory(IHttpClientFactory httpClients, IConfiguration config, TimeProvider clock, ILogger<KeycloakUserDirectory> logger)
    : IUserDirectory
{
    public const string HttpClientName = "keycloak-admin";
    public static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(1);
    public const int PageSize = 500;

    private readonly SemaphoreSlim _refreshing = new(1, 1);
    private IReadOnlyList<DirectoryUser>? _users;
    private DateTimeOffset _usersExpire;
    private string? _token;
    private DateTimeOffset _tokenExpires;

    public async Task<IReadOnlyList<DirectoryUser>> AllAsync(CancellationToken cancellationToken)
    {
        if (_users is not null && clock.GetUtcNow() < _usersExpire) return _users;

        await _refreshing.WaitAsync(cancellationToken);
        try
        {
            // Someone else may have just fetched it while this waited.
            if (_users is not null && clock.GetUtcNow() < _usersExpire) return _users;
            try
            {
                _users = await FetchAsync(cancellationToken);
                _usersExpire = clock.GetUtcNow() + CacheFor;
            }
            catch (Exception e) when (_users is not null && e is not OperationCanceledException)
            {
                logger.LogWarning(e, "Couldn't refresh the user list from Keycloak - using the last one");
            }
            return _users;
        }
        finally
        {
            _refreshing.Release();
        }
    }

    private async Task<IReadOnlyList<DirectoryUser>> FetchAsync(CancellationToken cancellationToken)
    {
        var (baseUrl, realm) = KeycloakAddress(config);
        var http = httpClients.CreateClient(HttpClientName);
        var token = await TokenAsync(http, baseUrl, realm, cancellationToken);

        var users = new List<DirectoryUser>();
        for (var first = 0; ; first += PageSize)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get,
                $"{baseUrl}/admin/realms/{Uri.EscapeDataString(realm)}/users?briefRepresentation=true&first={first}&max={PageSize}");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = await http.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
                throw new HttpRequestException($"Keycloak said {(int)response.StatusCode} to the user list - does the realtime-hub client have view-users?");
            var page = await response.Content.ReadFromJsonAsync<List<KeycloakUser>>(cancellationToken) ?? [];
            users.AddRange(page.Where(u => u.Enabled && !string.IsNullOrEmpty(u.Id)).Select(ToDirectoryUser));
            if (page.Count < PageSize) break;
        }

        logger.LogInformation("Loaded {Count} users from Keycloak", users.Count);
        return [.. users.OrderBy(u => u.DisplayName, StringComparer.OrdinalIgnoreCase)];
    }

    private async Task<string> TokenAsync(HttpClient http, string baseUrl, string realm, CancellationToken cancellationToken)
    {
        if (_token is not null && clock.GetUtcNow() < _tokenExpires) return _token;

        var clientId = config["Auth:AdminClientId"] ?? "realtime-hub";
        var secret = config["Auth:AdminClientSecret"];
        if (string.IsNullOrEmpty(secret)) throw new InvalidOperationException("Auth:AdminClientSecret isn't set");

        using var response = await http.PostAsync(
            $"{baseUrl}/realms/{Uri.EscapeDataString(realm)}/protocol/openid-connect/token",
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "client_credentials",
                ["client_id"] = clientId,
                ["client_secret"] = secret,
            }),
            cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"Keycloak said {(int)response.StatusCode} to the {clientId} client signing in - see auth/README.md");
        var token = await response.Content.ReadFromJsonAsync<TokenResponse>(cancellationToken)
            ?? throw new HttpRequestException("Keycloak sent back no token");

        _token = token.AccessToken;
        // A little early, so it never runs out part way through a fetch.
        _tokenExpires = clock.GetUtcNow() + TimeSpan.FromSeconds(Math.Max(0, token.ExpiresIn - 30));
        return _token;
    }

    // Keycloak's address and realm, from the sign-in metadata address the
    // hub already has - everything before /realms/.
    public static (string BaseUrl, string Realm) KeycloakAddress(IConfiguration config)
    {
        var metadata = config["Auth:MetadataAddress"] ?? "";
        var at = metadata.IndexOf("/realms/", StringComparison.Ordinal);
        if (at < 0) throw new InvalidOperationException("Auth:MetadataAddress isn't a Keycloak realm address");
        return (metadata[..at], config["Auth:Realm"] ?? "diss");
    }

    // Same as Keycloak's name claim: first and last name, or the username
    // if there's neither.
    public static DirectoryUser ToDirectoryUser(KeycloakUser user)
    {
        var name = $"{user.FirstName} {user.LastName}".Trim();
        return new DirectoryUser(user.Id, user.Username ?? "", name.Length > 0 ? name : user.Username ?? user.Id);
    }

    public record KeycloakUser(string Id, string? Username, string? FirstName, string? LastName, bool Enabled);

    private record TokenResponse(
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("expires_in")] int ExpiresIn);
}
