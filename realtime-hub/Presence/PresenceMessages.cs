namespace RealtimeHub.Presence;

// What the viewer says about where it is. SessionId is the room it's in, if
// any - not a secret, since getting into a room still needs annotation-store
// to say yes. Hosting is whether it's that session's host.
public record PresenceWhere(string? SlideId, string? SessionId, bool Hosting);

// Someone signed in with the viewer open, however many tabs. Where is
// whichever of their tabs last said. Version only goes up, across everyone,
// so a client can tell which of two messages about someone is newer.
public record OnlineUser(
    string UserId,
    string DisplayName,
    string? SlideId,
    string? SessionId,
    bool Hosting,
    DateTimeOffset Since,
    long Version);

public record UserOffline(string UserId, long Version);

// Everyone online as of Version.
public record OnlineSnapshot(IReadOnlyList<OnlineUser> Users, long Version);

// One person asking another into their session. The code is an ordinary
// invite code - whoever gets it still sees annotation-store's preview of
// what it's for before joining.
public record UserInvite(string FromUserId, string FromName, string Code, DateTimeOffset Sent);

// Someone with an account in Keycloak, online or not. DisplayName is made
// the same way as the token's name claim, so it matches what OnlineUser says.
public record DirectoryUser(string UserId, string Username, string DisplayName);
