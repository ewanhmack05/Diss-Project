using System.Diagnostics.Metrics;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Messaging.Auth;
using Messaging.Sessions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Messaging.Conversations;

public record AttachmentRequest(AttachmentKind Kind, string Name, string? SlideId = null, Guid? SourceCollectionId = null, string? InviteCode = null, JsonElement? Payload = null);

public record SendRequest(Guid Id, string? ToUserId, Guid? SessionId, string? Body, AttachmentRequest? Attachment = null);

public record AttachmentView(AttachmentKind Kind, string Name, string? SlideId, Guid? SourceCollectionId, string? InviteCode, int Bytes, DateTimeOffset? LastAddedByMe);

public record AttachmentWithPayload(AttachmentKind Kind, string Name, string? SlideId, Guid? SourceCollectionId, string? InviteCode, int Bytes, DateTimeOffset? LastAddedByMe, JsonElement? Payload);

public record MessageView(Guid Id, Guid ConversationId, string FromUserId, string FromName, string Body, DateTimeOffset Sent, AttachmentView? Attachment);

public record ConversationView(Guid Id, ConversationKind Kind, string? WithUserId, Guid? SessionId, DateTimeOffset Created, MessageView? LastMessage, int Unread);

public record MessagePage(List<MessageView> Messages, int Total);

public static partial class Endpoints
{
    public const int MaxBodyLength = 4000;
    public const int MaxNameLength = 200;
    public const int MaxInviteCodeLength = 64;
    public const int MaxTake = 100;
    public const int DefaultTake = 50;
    // A message isn't the place for a big collection - a session is. 5,000
    // annotations is about this much. A starting guess, worth changing once
    // it's been used.
    public const int MaxPayloadBytes = 5 * 1024 * 1024;

    public const string MeterName = "Messaging";
    private static readonly Meter Meter = new(MeterName);
    private static readonly Counter<long> Sent = Meter.CreateCounter<long>(
        "messaging.messages_sent", description: "Messages sent, by what's attached and whether it's direct or a session's");
    private static readonly Counter<long> Added = Meter.CreateCounter<long>(
        "messaging.attachments_added", description: "Things sent that someone added to a collection, by what they were");

    // Invite codes are url-safe base64 - see annotation-store's CollectionEndpoints.
    [GeneratedRegex("^[A-Za-z0-9_-]+$")]
    private static partial Regex CodeShape();

    public static void MapMessagingEndpoints(this WebApplication app)
    {
        app.MapGet("/conversations", ListAsync);
        app.MapGet("/sessions/{id:guid}/conversation", SessionConversationAsync);
        app.MapGet("/conversations/{id:guid}/messages", MessagesAsync);
        app.MapPost("/conversations/{id:guid}/read", ReadAsync);
        app.MapDelete("/conversations/{id:guid}", DeleteAsync);
        // Room for a full attachment, with its JSON escaped and the rest of the
        // message round it. What's over the limit itself gets told how big it was.
        app.MapPost("/messages", SendAsync).WithMetadata(new RequestSizeLimitAttribute(MaxPayloadBytes * 2L));
        app.MapGet("/messages/{id:guid}/attachment", AttachmentAsync);
        app.MapPost("/messages/{id:guid}/added", AddedAsync);
    }

    private static string Token(HttpContext http) =>
        http.Request.Headers.Authorization.ToString().Replace("Bearer ", "", StringComparison.OrdinalIgnoreCase);

    // Your direct ones, most recent first. A session's are reached from the session.
    private static async Task<IResult> ListAsync(ClaimsPrincipal user, MessagingDbContext db)
    {
        var me = user.UserId();
        var hidden = await db.ConversationReads.Where(r => r.UserId == me && r.Hidden).Select(r => r.ConversationId).ToListAsync();
        var conversations = await db.Conversations
            .Where(c => c.Kind == ConversationKind.Direct && (c.UserA == me || c.UserB == me) && !hidden.Contains(c.Id))
            .ToListAsync();
        var views = new List<ConversationView>();
        foreach (var conversation in conversations) views.Add(await ViewAsync(db, conversation, me));
        return Results.Ok(views.OrderByDescending(v => v.LastMessage?.Sent ?? v.Created).ToList());
    }

    private static async Task<IResult> SessionConversationAsync(Guid id, HttpContext http, ClaimsPrincipal user, MessagingDbContext db, ISessionAccess sessions, CancellationToken cancellationToken)
    {
        var membership = await sessions.MembershipAsync(id, Token(http), cancellationToken);
        if (membership is null) return Results.NotFound();
        var conversation = await FindOrMakeAsync(db, c => c.SessionId == id,
            () => new Conversation { Id = Guid.NewGuid(), Kind = ConversationKind.Session, SessionId = id, Created = DateTimeOffset.UtcNow });
        return Results.Ok(await ViewAsync(db, conversation, user.UserId()));
    }

    private static async Task<IResult> MessagesAsync(Guid id, int? skip, int? take, HttpContext http, ClaimsPrincipal user, MessagingDbContext db, ISessionAccess sessions, CancellationToken cancellationToken)
    {
        if (skip is < 0) return Results.BadRequest("skip can't be negative");
        if (take is < 1 or > MaxTake) return Results.BadRequest($"take must be between 1 and {MaxTake}");
        var conversation = await InConversationAsync(id, http, user, db, sessions, cancellationToken);
        if (conversation is null) return Results.NotFound();

        var me = user.UserId();
        var inConversation = db.Messages.Where(m => m.ConversationId == id);
        var messages = await inConversation
            .OrderByDescending(m => m.Sent).ThenByDescending(m => m.Id)
            .Skip(skip ?? 0).Take(take ?? DefaultTake)
            .Select(WithoutPayload)
            .ToListAsync();
        return Results.Ok(new MessagePage(await ViewsAsync(db, messages, me), await inConversation.CountAsync()));
    }

    private static async Task<IResult> ReadAsync(Guid id, HttpContext http, ClaimsPrincipal user, MessagingDbContext db, ISessionAccess sessions, CancellationToken cancellationToken)
    {
        var conversation = await InConversationAsync(id, http, user, db, sessions, cancellationToken);
        if (conversation is null) return Results.NotFound();
        var read = await ReadOfAsync(db, id, user.UserId());
        read.LastRead = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> DeleteAsync(Guid id, HttpContext http, ClaimsPrincipal user, MessagingDbContext db, ISessionAccess sessions, CancellationToken cancellationToken)
    {
        var conversation = await InConversationAsync(id, http, user, db, sessions, cancellationToken);
        if (conversation is null) return Results.NotFound();

        if (conversation.Kind == ConversationKind.Session)
        {
            var membership = await sessions.MembershipAsync(conversation.SessionId!.Value, Token(http), cancellationToken);
            if (membership?.Role != SessionRole.Owner) return Results.Forbid();
            db.Conversations.Remove(conversation);
            await db.SaveChangesAsync(cancellationToken);
            return Results.NoContent();
        }

        var me = user.UserId();
        (await ReadOfAsync(db, id, me)).Hidden = true;
        await db.SaveChangesAsync(cancellationToken);
        var other = conversation.UserA == me ? conversation.UserB! : conversation.UserA!;
        // Kept until both have deleted it, since it's the other person's as well.
        if (await db.ConversationReads.AnyAsync(r => r.ConversationId == id && r.UserId == other && r.Hidden, cancellationToken))
        {
            db.Conversations.Remove(conversation);
            await db.SaveChangesAsync(cancellationToken);
        }
        return Results.NoContent();
    }

    private static async Task<IResult> SendAsync(SendRequest request, HttpContext http, ClaimsPrincipal user, MessagingDbContext db, ISessionAccess sessions, ILogger<Message> logger, CancellationToken cancellationToken)
    {
        var me = user.UserId();
        var body = request.Body ?? "";
        if (request.Id == Guid.Empty) return Results.BadRequest("id has to be a GUID");
        if (body.Length > MaxBodyLength) return Results.BadRequest($"A message is up to {MaxBodyLength:N0} characters");
        if (string.IsNullOrWhiteSpace(body) && request.Attachment is null) return Results.BadRequest("There's nothing to send");
        if ((request.ToUserId is null) == (request.SessionId is null)) return Results.BadRequest("Send to toUserId or sessionId, not both or neither");
        if (request.ToUserId == me) return Results.BadRequest("You can't message yourself");
        if (string.IsNullOrWhiteSpace(request.ToUserId) && request.SessionId is null) return Results.BadRequest("toUserId can't be empty");

        var payload = request.Attachment?.Payload?.GetRawText();
        if (request.Attachment is { } attachment)
        {
            var bytes = Encoding.UTF8.GetByteCount(payload ?? "");
            if (bytes > MaxPayloadBytes)
                return Results.Json($"That's {bytes / 1024.0 / 1024.0:N1}MB, and a message can carry up to {MaxPayloadBytes / 1024 / 1024}MB", statusCode: StatusCodes.Status413PayloadTooLarge);
            if (Invalid(attachment) is { } problem) return Results.BadRequest(problem);
        }

        var existing = await db.Messages.AsNoTracking().Include(m => m.Attachment).FirstOrDefaultAsync(m => m.Id == request.Id, cancellationToken);
        if (existing is not null)
        {
            if (existing.FromUserId != me) return Results.Conflict("That message id is someone else's");
            return Results.Ok(View(existing, null));
        }

        Conversation conversation;
        if (request.SessionId is { } sessionId)
        {
            var membership = await sessions.MembershipAsync(sessionId, Token(http), cancellationToken);
            if (membership is null) return Results.NotFound();
            if (membership.Ended) return Results.Conflict("That session's ended, so its chat is read only");
            conversation = await FindOrMakeAsync(db, c => c.SessionId == sessionId,
                () => new Conversation { Id = Guid.NewGuid(), Kind = ConversationKind.Session, SessionId = sessionId, Created = DateTimeOffset.UtcNow });
        }
        else
        {
            var (a, b) = InOrder(me, request.ToUserId!);
            conversation = await FindOrMakeAsync(db, c => c.UserA == a && c.UserB == b,
                () => new Conversation { Id = Guid.NewGuid(), Kind = ConversationKind.Direct, UserA = a, UserB = b, Created = DateTimeOffset.UtcNow });
        }

        var message = new Message
        {
            Id = request.Id,
            ConversationId = conversation.Id,
            FromUserId = me,
            FromName = user.DisplayName(),
            Body = body,
            Sent = DateTimeOffset.UtcNow,
            Attachment = request.Attachment is { } sent
                ? new Attachment
                {
                    MessageId = request.Id,
                    Kind = sent.Kind,
                    Name = sent.Name.Trim(),
                    SlideId = sent.SlideId,
                    SourceCollectionId = sent.SourceCollectionId,
                    InviteCode = sent.InviteCode,
                    Payload = payload,
                    Bytes = Encoding.UTF8.GetByteCount(payload ?? ""),
                }
                : null,
        };
        db.Messages.Add(message);
        // A new message brings it back for anyone who'd deleted it.
        var hidden = await db.ConversationReads.Where(r => r.ConversationId == conversation.Id && r.Hidden).ToListAsync(cancellationToken);
        foreach (var read in hidden) read.Hidden = false;
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // The same id at the same moment, after a retry - the first one stands.
            db.ChangeTracker.Clear();
            var first = await db.Messages.AsNoTracking().Include(m => m.Attachment).FirstOrDefaultAsync(m => m.Id == request.Id, cancellationToken);
            if (first is null) throw;
            return first.FromUserId == me ? Results.Ok(View(first, null)) : Results.Conflict("That message id is someone else's");
        }

        Sent.Add(1, new KeyValuePair<string, object?>("attachment", request.Attachment?.Kind.ToString() ?? "none"),
            new KeyValuePair<string, object?>("conversation", conversation.Kind.ToString()));
        logger.LogInformation("{From} sent a message in {Conversation}", me, conversation.Id);
        return Results.Created($"/messages/{message.Id}", View(message, null));
    }

    private static string? Invalid(AttachmentRequest attachment)
    {
        if (!Enum.IsDefined(attachment.Kind)) return "That isn't a kind of attachment";
        if (string.IsNullOrWhiteSpace(attachment.Name)) return "An attachment needs a name";
        if (attachment.Name.Length > MaxNameLength) return $"An attachment's name is up to {MaxNameLength} characters";
        if (attachment.Kind == AttachmentKind.Invite)
        {
            if (string.IsNullOrEmpty(attachment.InviteCode) || attachment.InviteCode.Length > MaxInviteCodeLength || !CodeShape().IsMatch(attachment.InviteCode))
                return "That isn't an invite code";
            return attachment.Payload is null ? null : "An invite doesn't carry rows";
        }
        if (attachment.Payload is not { ValueKind: JsonValueKind.Object }) return "An attachment needs its rows, as a JSON object";
        return attachment.InviteCode is null ? null : "Only an invite has a code";
    }

    private static async Task<IResult> AttachmentAsync(Guid id, HttpContext http, ClaimsPrincipal user, MessagingDbContext db, ISessionAccess sessions, CancellationToken cancellationToken)
    {
        var message = await db.Messages.AsNoTracking().Include(m => m.Attachment).FirstOrDefaultAsync(m => m.Id == id, cancellationToken);
        if (message?.Attachment is null) return Results.NotFound();
        if (await InConversationAsync(message.ConversationId, http, user, db, sessions, cancellationToken) is null) return Results.NotFound();

        var me = user.UserId();
        var added = await db.AttachmentAdds.Where(a => a.MessageId == id && a.UserId == me).Select(a => (DateTimeOffset?)a.LastAdded).FirstOrDefaultAsync(cancellationToken);
        var attachment = message.Attachment;
        JsonElement? payload = null;
        if (attachment.Payload is { } text)
        {
            using var document = JsonDocument.Parse(text);
            payload = document.RootElement.Clone();
        }
        return Results.Ok(new AttachmentWithPayload(attachment.Kind, attachment.Name, attachment.SlideId, attachment.SourceCollectionId, attachment.InviteCode, attachment.Bytes, added, payload));
    }

    private static async Task<IResult> AddedAsync(Guid id, HttpContext http, ClaimsPrincipal user, MessagingDbContext db, ISessionAccess sessions, CancellationToken cancellationToken)
    {
        var message = await db.Messages.Where(m => m.Id == id).Select(WithoutPayload).FirstOrDefaultAsync(cancellationToken);
        if (message?.Attachment is null) return Results.NotFound();
        if (await InConversationAsync(message.ConversationId, http, user, db, sessions, cancellationToken) is null) return Results.NotFound();

        var me = user.UserId();
        var now = DateTimeOffset.UtcNow;
        var add = await db.AttachmentAdds.FirstOrDefaultAsync(a => a.MessageId == id && a.UserId == me, cancellationToken);
        if (add is null) db.AttachmentAdds.Add(new AttachmentAdd { MessageId = id, UserId = me, LastAdded = now });
        else add.LastAdded = now;
        await db.SaveChangesAsync(cancellationToken);
        Added.Add(1, new KeyValuePair<string, object?>("attachment", message.Attachment.Kind.ToString()));
        return Results.Ok(View(message, now).Attachment);
    }

    // The conversation, if they're in it. Null otherwise, which is a 404 either
    // way, so nobody can find out what exists by asking.
    private static async Task<Conversation?> InConversationAsync(Guid id, HttpContext http, ClaimsPrincipal user, MessagingDbContext db, ISessionAccess sessions, CancellationToken cancellationToken)
    {
        var conversation = await db.Conversations.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        if (conversation is null) return null;
        if (conversation.Kind == ConversationKind.Session)
            return await sessions.MembershipAsync(conversation.SessionId!.Value, Token(http), cancellationToken) is null ? null : conversation;
        var me = user.UserId();
        return conversation.UserA == me || conversation.UserB == me ? conversation : null;
    }

    private static (string, string) InOrder(string first, string second) =>
        string.CompareOrdinal(first, second) < 0 ? (first, second) : (second, first);

    // Two first messages at once both find nothing, and the unique index stops
    // the second, so it reads the first one's.
    private static async Task<Conversation> FindOrMakeAsync(MessagingDbContext db, System.Linq.Expressions.Expression<Func<Conversation, bool>> which, Func<Conversation> make)
    {
        var conversation = await db.Conversations.FirstOrDefaultAsync(which);
        if (conversation is not null) return conversation;
        conversation = make();
        db.Conversations.Add(conversation);
        try
        {
            await db.SaveChangesAsync();
            return conversation;
        }
        catch (DbUpdateException)
        {
            db.Entry(conversation).State = EntityState.Detached;
            return await db.Conversations.FirstAsync(which);
        }
    }

    private static async Task<ConversationRead> ReadOfAsync(MessagingDbContext db, Guid conversationId, string userId)
    {
        var read = await db.ConversationReads.FirstOrDefaultAsync(r => r.ConversationId == conversationId && r.UserId == userId);
        if (read is not null) return read;
        read = new ConversationRead { ConversationId = conversationId, UserId = userId };
        db.ConversationReads.Add(read);
        return read;
    }

    private static async Task<ConversationView> ViewAsync(MessagingDbContext db, Conversation conversation, string me)
    {
        var last = await db.Messages.Where(m => m.ConversationId == conversation.Id)
            .OrderByDescending(m => m.Sent).ThenByDescending(m => m.Id)
            .Select(WithoutPayload)
            .FirstOrDefaultAsync();
        var lastRead = await db.ConversationReads.Where(r => r.ConversationId == conversation.Id && r.UserId == me).Select(r => r.LastRead).FirstOrDefaultAsync();
        var fromOthers = db.Messages.Where(m => m.ConversationId == conversation.Id && m.FromUserId != me);
        var unread = await (lastRead is { } read ? fromOthers.Where(m => m.Sent > read) : fromOthers).CountAsync();
        var with = conversation.Kind == ConversationKind.Direct ? (conversation.UserA == me ? conversation.UserB : conversation.UserA) : null;
        var views = last is null ? [] : await ViewsAsync(db, [last], me);
        return new ConversationView(conversation.Id, conversation.Kind, with, conversation.SessionId, conversation.Created, views.FirstOrDefault(), unread);
    }

    // Without the rows, which can be megabytes - only GET /messages/{id}/attachment
    // sends those.
    private static readonly System.Linq.Expressions.Expression<Func<Message, Message>> WithoutPayload = m => new Message
    {
        Id = m.Id,
        ConversationId = m.ConversationId,
        FromUserId = m.FromUserId,
        FromName = m.FromName,
        Body = m.Body,
        Sent = m.Sent,
        Attachment = m.Attachment == null ? null : new Attachment
        {
            MessageId = m.Attachment.MessageId,
            Kind = m.Attachment.Kind,
            Name = m.Attachment.Name,
            SlideId = m.Attachment.SlideId,
            SourceCollectionId = m.Attachment.SourceCollectionId,
            InviteCode = m.Attachment.InviteCode,
            Bytes = m.Attachment.Bytes,
        },
    };

    private static async Task<List<MessageView>> ViewsAsync(MessagingDbContext db, List<Message> messages, string me)
    {
        var ids = messages.Where(m => m.Attachment is not null).Select(m => m.Id).ToList();
        var added = ids.Count == 0
            ? []
            : await db.AttachmentAdds.Where(a => a.UserId == me && ids.Contains(a.MessageId)).ToDictionaryAsync(a => a.MessageId, a => a.LastAdded);
        return messages.Select(m => View(m, added.TryGetValue(m.Id, out var at) ? at : null)).ToList();
    }

    private static MessageView View(Message message, DateTimeOffset? lastAddedByMe) =>
        new(message.Id, message.ConversationId, message.FromUserId, message.FromName, message.Body, message.Sent,
            message.Attachment is { } a ? new AttachmentView(a.Kind, a.Name, a.SlideId, a.SourceCollectionId, a.InviteCode, a.Bytes, lastAddedByMe) : null);
}
