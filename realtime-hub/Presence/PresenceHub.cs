using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR;
using RealtimeHub.Auth;

namespace RealtimeHub.Presence;

public interface IPresenceClient
{
    // Someone came online, or where they are changed.
    Task UserOnline(OnlineUser user);
    Task UserOffline(UserOffline user);
    Task InviteReceived(UserInvite invite);
}

// Who's online, and everyone with an account, for the viewer's Users tab.
// Separate from SlideHub, since the viewer stays connected here the whole
// time it's open, in a session or not.
public partial class PresenceHub(OnlineUsers online, IUserDirectory directory, ILogger<PresenceHub> logger) : Hub<IPresenceClient>
{
    public const int MaxIdLength = 128;
    public const int MaxCodeLength = 64;

    // Invite codes are url-safe base64 - see annotation-store's CollectionEndpoints.
    [GeneratedRegex("^[A-Za-z0-9_-]+$")]
    private static partial Regex CodeShape();

    public override async Task OnConnectedAsync()
    {
        var user = Context.User!;
        var changed = online.Connect(Context.ConnectionId, user.UserId(), user.DisplayName());
        if (changed is not null) await Clients.Others.UserOnline(changed);
        await base.OnConnectedAsync();
    }

    // Everyone online right now, you included - the client leaves itself out.
    public OnlineSnapshot Online() => online.Snapshot();

    // Everyone with an account in Keycloak, online or not, you included.
    public async Task<IReadOnlyList<DirectoryUser>> Users()
    {
        try
        {
            return await directory.AllAsync(Context.ConnectionAborted);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            logger.LogWarning(e, "Couldn't get the user list");
            throw new HubException("Couldn't get the user list from Keycloak");
        }
    }

    public async Task SetWhere(PresenceWhere where)
    {
        if (where is null) throw new HubException("where is required");
        if (where.SlideId?.Length > MaxIdLength || where.SessionId?.Length > MaxIdLength)
            throw new HubException($"slideId and sessionId are up to {MaxIdLength} characters");
        var changed = online.SetWhere(Context.ConnectionId, where);
        if (changed is not null) await Clients.Others.UserOnline(changed);
    }

    // Goes to every tab they have open. The hub doesn't check the code -
    // annotation-store does when they open it.
    public async Task InviteUser(string userId, string code)
    {
        if (string.IsNullOrWhiteSpace(userId)) throw new HubException("userId is required");
        if (string.IsNullOrEmpty(code) || code.Length > MaxCodeLength || !CodeShape().IsMatch(code))
            throw new HubException("That isn't an invite code");
        var me = Context.User!;
        if (userId == me.UserId()) throw new HubException("You can't invite yourself");

        var targets = online.ConnectionsOf(userId);
        if (targets.Count == 0) throw new HubException("They're not online any more");

        await Clients.Clients(targets).InviteReceived(new UserInvite(me.UserId(), me.DisplayName(), code, DateTimeOffset.UtcNow));
        logger.LogInformation("{From} invited {To} to a session", me.UserId(), userId);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var (changed, offline) = online.Disconnect(Context.ConnectionId);
        if (changed is not null) await Clients.All.UserOnline(changed);
        if (offline is not null) await Clients.All.UserOffline(offline);
        await base.OnDisconnectedAsync(exception);
    }
}
