namespace RealtimeHub.Presence;

// Who's online, kept in memory like the rooms. Tracked per connection and
// shown per user, so someone with two tabs open is one person, online until
// their last tab goes. Every change gets the next Version.
public class OnlineUsers
{
    private sealed class Connection(string userId, string displayName, DateTimeOffset connected)
    {
        public string UserId { get; } = userId;
        public string DisplayName { get; } = displayName;
        public DateTimeOffset Connected { get; } = connected;
        public PresenceWhere? Where { get; set; }
        // When Where was last set, as a Version - the newest one wins.
        public long WhereSet { get; set; }
    }

    private readonly Lock _lock = new();
    private readonly Dictionary<string, Connection> _connections = [];
    private readonly Dictionary<string, OnlineUser> _users = [];
    private long _version;

    // The user as they are now, if that's changed - always for their first tab.
    public OnlineUser? Connect(string connectionId, string userId, string displayName)
    {
        lock (_lock)
        {
            _connections[connectionId] = new Connection(userId, displayName, DateTimeOffset.UtcNow);
            return Restamp(userId);
        }
    }

    // Null if the connection isn't known, or nothing about the user changed.
    public OnlineUser? SetWhere(string connectionId, PresenceWhere where)
    {
        lock (_lock)
        {
            if (!_connections.TryGetValue(connectionId, out var connection)) return null;
            connection.Where = where;
            connection.WhereSet = ++_version;
            return Restamp(connection.UserId);
        }
    }

    // Offline if that was their last tab, otherwise how they look now (or
    // nothing, if the tab that went made no difference).
    public (OnlineUser? Changed, UserOffline? Offline) Disconnect(string connectionId)
    {
        lock (_lock)
        {
            if (!_connections.Remove(connectionId, out var connection)) return (null, null);
            if (_connections.Values.Any(c => c.UserId == connection.UserId))
                return (Restamp(connection.UserId), null);
            _users.Remove(connection.UserId);
            return (null, new UserOffline(connection.UserId, ++_version));
        }
    }

    public OnlineSnapshot Snapshot()
    {
        lock (_lock)
        {
            return new OnlineSnapshot([.. _users.Values.OrderBy(u => u.DisplayName, StringComparer.OrdinalIgnoreCase)], _version);
        }
    }

    public IReadOnlyList<string> ConnectionsOf(string userId)
    {
        lock (_lock)
        {
            return [.. _connections.Where(c => c.Value.UserId == userId).Select(c => c.Key)];
        }
    }

    public string? UserOf(string connectionId)
    {
        lock (_lock)
        {
            return _connections.TryGetValue(connectionId, out var connection) ? connection.UserId : null;
        }
    }

    // Works the user out again from their tabs, and gives it a new Version
    // only if something a client would see is different.
    private OnlineUser? Restamp(string userId)
    {
        var tabs = _connections.Values.Where(c => c.UserId == userId).ToList();
        var latest = tabs.Where(c => c.Where is not null).MaxBy(c => c.WhereSet);
        var where = latest?.Where;
        // Newest tab's name, in case it was changed in Keycloak since.
        var name = tabs.MaxBy(c => c.Connected)!.DisplayName;
        // Online since their first tab, even once that tab's gone - they
        // haven't been away.
        _users.TryGetValue(userId, out var current);
        var since = current?.Since ?? tabs.Min(c => c.Connected);

        var next = new OnlineUser(userId, name, where?.SlideId, where?.SessionId, where?.Hosting ?? false, since, 0);
        if (current is not null && current with { Version = 0 } == next) return null;
        next = next with { Version = ++_version };
        _users[userId] = next;
        return next;
    }
}
