namespace AnnotationStore.Collections;

// Small vs large sessions. A session can have at most its MaxEditors people
// who can change things, the host included - set when it's started, from
// the viewer's maxEditors option. Anyone joining once that's full comes in
// view only, even on an edit link, so a big audience can watch without
// everyone drawing over each other. Nobody already editing is moved down,
// and when an editor leaves or is made view only, there's room again - the
// session is "small" again as soon as everyone in it could edit.
public static class SessionSize
{
    public const int DefaultMaxEditors = 6;
    // 1 is the host alone - presenting to everyone else.
    public const int LeastMaxEditors = 1;
    public const int MostMaxEditors = 50;

    public static bool IsValidMax(int maxEditors) => maxEditors is >= LeastMaxEditors and <= MostMaxEditors;

    public static int Editors(IEnumerable<CollectionMember> members) =>
        members.Count(m => m.Role >= CollectionRole.Editor);

    // More people than could all edit - some of them are only watching
    // because of the cap.
    public static bool IsLarge(IEnumerable<CollectionMember> members, int maxEditors) => members.Count() > maxEditors;

    // The role someone gets for an invite. `current` is their role if
    // they're in already - accepting again never moves anyone down.
    public static CollectionRole RoleOnJoin(CollectionRole invited, CollectionRole? current, int editors, int maxEditors)
    {
        var wanted = current is { } had && had > invited ? had : invited;
        if (wanted < CollectionRole.Editor || current >= CollectionRole.Editor) return wanted;
        return editors >= maxEditors ? current ?? CollectionRole.Viewer : wanted;
    }

    // Whether the host can make someone an editor right now.
    public static bool HasRoomFor(CollectionRole from, CollectionRole to, int editors, int maxEditors) =>
        to < CollectionRole.Editor || from >= CollectionRole.Editor || editors < maxEditors;
}
