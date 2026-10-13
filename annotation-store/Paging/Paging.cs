using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;

namespace AnnotationStore.Paging;

// The viewer's Saved lists ask for one page at a time - skip/take plus an
// optional search - and GET .../total with the same search for the page
// count. Leave all three out and you get everything, which is what the map
// still loads. How big a page is is the viewer's call; MaxTake only stops a
// single request asking for something silly.
public static class SavedPaging
{
    public const int MaxTake = 500;

    // Null when the paging values are fine, otherwise the 400 to send back.
    public static IResult? Invalid(int? skip, int? take)
    {
        if (skip is < 0) return Results.BadRequest("skip can't be negative.");
        if (take is < 1 or > MaxTake) return Results.BadRequest($"take must be between 1 and {MaxTake}.");
        return null;
    }

    // Newest first, with the id breaking ties, so a row can't turn up on two
    // pages when several were saved in the same instant.
    public static IQueryable<Annotation> NewestFirst(this IQueryable<Annotation> query) =>
        query.OrderByDescending(a => a.Created).ThenByDescending(a => a.Id);

    public static IQueryable<CellCount> NewestFirst(this IQueryable<CellCount> query) =>
        query.OrderByDescending(c => c.Created).ThenByDescending(c => c.Id);

    // Same fields the Saved lists searched on before: label, notes and, for
    // annotations, the shape. Case doesn't matter. Contains becomes strpos /
    // instr in SQL, so % and _ in the search are matched literally.
    public static IQueryable<Annotation> Matching(this IQueryable<Annotation> query, string? search)
    {
        if (string.IsNullOrWhiteSpace(search)) return query;
        var term = search.Trim().ToLower();
        return query.Where(a => a.Label.ToLower().Contains(term)
            || a.Notes.ToLower().Contains(term)
            || a.Shape.ToLower().Contains(term));
    }

    public static IQueryable<CellCount> Matching(this IQueryable<CellCount> query, string? search)
    {
        if (string.IsNullOrWhiteSpace(search)) return query;
        var term = search.Trim().ToLower();
        return query.Where(c => c.Label.ToLower().Contains(term) || c.Notes.ToLower().Contains(term));
    }

    public static IQueryable<T> Page<T>(this IQueryable<T> query, int? skip, int? take)
    {
        if (skip is > 0) query = query.Skip(skip.Value);
        if (take is not null) query = query.Take(take.Value);
        return query;
    }
}
