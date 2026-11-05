namespace Messaging.Conversations;

public enum ConversationKind { Direct, Session }

public enum AttachmentKind { Annotations, Group, CellCount, Collection, Invite, Area }

// Either two people or a session. Two people's ids are kept in a fixed order
// with a unique index, so they only ever have the one between them. Neither
// kind of id is a foreign key - users are Keycloak's, and sessions are in
// annotation-store's database.
public class Conversation
{
    public Guid Id { get; set; }
    public ConversationKind Kind { get; set; }
    public string? UserA { get; set; }
    public string? UserB { get; set; }
    public Guid? SessionId { get; set; }
    public DateTimeOffset Created { get; set; }
}

// One person's place in a conversation. A session's are made as people read it.
public class ConversationRead
{
    public Guid ConversationId { get; set; }
    public string UserId { get; set; } = "";
    public DateTimeOffset? LastRead { get; set; }
    // Direct only - they've deleted it for themselves.
    public bool Hidden { get; set; }
}

public class Message
{
    // Made by the viewer, so sending again after a dropped connection is the
    // same message.
    public Guid Id { get; set; }
    public Guid ConversationId { get; set; }
    public string FromUserId { get; set; } = "";
    public string FromName { get; set; } = "";
    public string Body { get; set; } = "";
    public DateTimeOffset Sent { get; set; }
    public Attachment? Attachment { get; set; }
}

// What was sent with a message, as it was when it was sent. It's a copy, so it
// stays the same if the original changes or goes, and whoever gets it doesn't
// need access to the original. The rows are in Payload, which is the viewer's -
// only annotation-store knows what's valid.
public class Attachment
{
    public Guid MessageId { get; set; }
    public AttachmentKind Kind { get; set; }
    public string Name { get; set; } = "";
    public string? SlideId { get; set; }
    public Guid? SourceCollectionId { get; set; }
    public string? InviteCode { get; set; }
    public string? Payload { get; set; }
    public int Bytes { get; set; }
}

// Someone adding what was sent to a collection of theirs. Per person, since
// everyone in a session's chat can add the same thing.
public class AttachmentAdd
{
    public Guid MessageId { get; set; }
    public string UserId { get; set; } = "";
    public DateTimeOffset LastAdded { get; set; }
}
