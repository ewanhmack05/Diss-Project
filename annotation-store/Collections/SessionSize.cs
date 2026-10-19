namespace AnnotationStore.Collections;

// Small vs large sessions. The first MaxEditors people who can edit (the
// host included) are all an edit link lets in as editors - set when the
// session's started, from the viewer's maxEditors option. Anyone joining
// after that comes in view only, so a big audience can watch without
// everyone drawing over each other. It only limits joining: the host can
// still make anyone an editor, and nobody already editing is moved down.
// The session is "large" once it has more people than that.
public static class SessionSize
{
    public const int DefaultMaxEditors = 6;
    // 1 is the host alone - presenting to everyone else.
    public const int LeastMaxEditors = 1;
    public const int MostMaxEditors = 50;

    public static bool IsValidMax(int maxEditors) => maxEditors is >= LeastMaxEditors and <= MostMaxEditors;

    public static int Editors(IEnumerable<CollectionMember> members) =>
        members.Count(m => m.Role >= CollectionRole.Editor);

    // More people than an edit link lets in as editors.
    public static bool IsLarge(IEnumerable<CollectionMember> members, int maxEditors) => members.Count() > maxEditors;

    // The role someone gets for an invite. `current` is their role if
    // they're in already - accepting again never moves anyone down.
    public static CollectionRole RoleOnJoin(CollectionRole invited, CollectionRole? current, int editors, int maxEditors)
    {
        var wanted = current is { } had && had > invited ? had : invited;
        if (wanted < CollectionRole.Editor || current >= CollectionRole.Editor) return wanted;
        return editors >= maxEditors ? current ?? CollectionRole.Viewer : wanted;
    }
}
