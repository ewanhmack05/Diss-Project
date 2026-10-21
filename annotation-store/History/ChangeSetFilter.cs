using AnnotationStore.Paging;

namespace AnnotationStore.History;

// What the History list can be narrowed to - who made the change, what kind
// of change, and when. Same query names as the Saved lists' filters, so the
// viewer's filter popout and query string work for both. Kind is the
// viewer's icon for it (changeKind in collections/history/history.ts).
public record ChangeSetFilter(string[]? CreatedBy, string[]? Kind, DateTimeOffset? From, DateTimeOffset? To);

public record KindCount(string Kind, int Count);

public record ChangeSetFacets(List<SavedAuthor> Authors, List<KindCount> Kinds);

public static class ChangeKinds
{
    public const string Add = "add";
    public const string Change = "change";
    public const string Delete = "delete";
    public const string Merge = "merge";
    public const string Import = "import";
    public const string Restore = "restore";

    public static readonly string[] All = [Add, Change, Delete, Merge, Import, Restore];

    // What a change set's What counts as. Anything new that isn't one of
    // these reads as a change, the same as in the viewer.
    public static string Of(string what) => what switch
    {
        "import" => Import,
        "restore" => Restore,
        "merge groups" => Merge,
        _ when what.StartsWith("add") => Add,
        _ when what.StartsWith("delete") => Delete,
        _ => Change,
    };

    public static IResult? Invalid(ChangeSetFilter filter) =>
        filter.Kind?.FirstOrDefault(k => !All.Contains(k)) is { } unknown
            ? Results.BadRequest($"kind \"{unknown}\" isn't one of {string.Join(", ", All)}")
            : null;

    public static IQueryable<ChangeSet> Filtered(this IQueryable<ChangeSet> query, ChangeSetFilter filter)
    {
        if (filter.CreatedBy is { Length: > 0 } people) query = query.Where(c => people.Contains(c.UserId));
        if (filter.From is { } from) query = query.Where(c => c.Created >= from);
        if (filter.To is { } to) query = query.Where(c => c.Created < to);
        if (filter.Kind is { Length: > 0 } kinds)
        {
            var add = kinds.Contains(Add);
            var delete = kinds.Contains(Delete);
            var merge = kinds.Contains(Merge);
            var import = kinds.Contains(Import);
            var restore = kinds.Contains(Restore);
            var change = kinds.Contains(Change);
            // Of() in SQL - a change is anything none of the others is.
            query = query.Where(c =>
                (add && c.What.StartsWith("add"))
                || (delete && c.What.StartsWith("delete"))
                || (merge && c.What == "merge groups")
                || (import && c.What == "import")
                || (restore && c.What == "restore")
                || (change && !c.What.StartsWith("add") && !c.What.StartsWith("delete")
                    && c.What != "merge groups" && c.What != "import" && c.What != "restore"));
        }
        return query;
    }
}
