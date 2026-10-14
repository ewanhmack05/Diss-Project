using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;

namespace AnnotationStore.Paging;

// The viewer's Saved lists ask for one page at a time - skip/take plus an
// optional search and filters (SavedFilter) - and GET .../total with the
// same search and filters for the page count. Leave all three out and you get everything, which is what the map
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

    // The Saved lists' filter popout - see SavedFilter. Each one left out
    // (or empty) doesn't narrow anything.
    public static IQueryable<Annotation> Filtered(this IQueryable<Annotation> query, SavedFilter filter)
    {
        if (filter.CreatedBy is { Length: > 0 } people) query = query.Where(a => people.Contains(a.CreatedById));
        if (filter.Shape is { Length: > 0 } shapes) query = query.Where(a => shapes.Contains(a.Shape));
        // The viewer saves palette colours upper case and custom ones lower,
        // so case is ignored. Picked colours and "anything but these" (the
        // viewer's Custom, with its palette as otherThan) are either/or.
        var colours = filter.Colour?.Select(c => c.ToLower()).ToArray() ?? [];
        var otherThan = filter.OtherThan?.Select(c => c.ToLower()).ToArray() ?? [];
        if (colours.Length > 0 && otherThan.Length > 0)
            query = query.Where(a => colours.Contains(a.Colour.ToLower()) || !otherThan.Contains(a.Colour.ToLower()));
        else if (colours.Length > 0)
            query = query.Where(a => colours.Contains(a.Colour.ToLower()));
        else if (otherThan.Length > 0)
            query = query.Where(a => !otherThan.Contains(a.Colour.ToLower()));
        if (filter.HasNotes is { } hasNotes) query = query.Where(a => (a.Notes != "") == hasNotes);
        if (filter.Group is { Length: > 0 } groups)
        {
            // Group ids, and "none" for ones not in a group. Anything that
            // isn't either matches nothing.
            var ids = groups.Select(g => Guid.TryParse(g, out var id) ? id : (Guid?)null).OfType<Guid>().ToList();
            var ungrouped = groups.Contains(SavedFilter.NoGroup);
            query = query.Where(a => (a.GroupId != null && ids.Contains(a.GroupId.Value)) || (ungrouped && a.GroupId == null));
        }
        if (filter.From is { } from) query = query.Where(a => a.Created >= from);
        if (filter.To is { } to) query = query.Where(a => a.Created < to);
        return query;
    }

    public static IQueryable<CellCount> Filtered(this IQueryable<CellCount> query, SavedFilter filter)
    {
        if (filter.CreatedBy is { Length: > 0 } people) query = query.Where(c => people.Contains(c.CreatedById));
        if (filter.HasNotes is { } hasNotes) query = query.Where(c => (c.Notes != "") == hasNotes);
        if (filter.WithRoi is { } withRoi) query = query.Where(c => c.WithRoi == withRoi);
        if (filter.From is { } from) query = query.Where(c => c.Created >= from);
        if (filter.To is { } to) query = query.Where(c => c.Created < to);
        return query;
    }

    // Colours with the same hex in different case are one colour.
    public static List<SavedColour> Colours(IEnumerable<SavedColour> byColour) =>
        byColour
            .Where(c => c.Colour != "")
            .GroupBy(c => c.Colour.ToLowerInvariant())
            .Select(g => new SavedColour(g.Key, g.Sum(c => c.Count)))
            .OrderByDescending(c => c.Count)
            .ThenBy(c => c.Colour)
            .ToList();

    // One per person, by name. Grouped by id and name in SQL, so someone
    // who's changed their name since shows up twice - this folds them back
    // into one under the name they've saved the most under.
    public static List<SavedAuthor> Authors(IEnumerable<SavedAuthor> byIdAndName) =>
        byIdAndName
            .GroupBy(a => a.Id)
            .Select(g => new SavedAuthor(g.Key, g.MaxBy(a => a.Count)!.Name, g.Sum(a => a.Count)))
            .OrderBy(a => a.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(a => a.Id)
            .ToList();

    public static IQueryable<T> Page<T>(this IQueryable<T> query, int? skip, int? take)
    {
        if (skip is > 0) query = query.Skip(skip.Value);
        if (take is not null) query = query.Take(take.Value);
        return query;
    }
}

// What the Saved lists can be filtered by, from the query string -
// createdBy, shape and colour can each be given more than once and match
// any of them. otherThan matches any colour not in it, alongside colour. From is inclusive and To exclusive, so the viewer sends the
// start of the first day and the start of the day after the last. Shape,
// colour and group are annotations only, withRoi cell counts only. Group is
// group ids, or "none" for ones not in a group, and can be repeated too.
public record SavedFilter(
    string[]? CreatedBy,
    string[]? Shape,
    string[]? Colour,
    string[]? OtherThan,
    bool? HasNotes,
    bool? WithRoi,
    DateTimeOffset? From,
    DateTimeOffset? To,
    string[]? Group = null)
{
    public const string NoGroup = "none";
}

// Someone who's saved something in a collection, for the "Saved by" filter.
// Rows from before sign-in have no id and aren't listed.
public record SavedAuthor(string Id, string Name, int Count);

// A colour used in a collection and how often, for the colour filter.
public record SavedColour(string Colour, int Count);

// The choices the filter popout offers that depend on what's saved - who
// saved things and, for annotations, which colours are used. Colours is
// empty for cell counts.
public record SavedFacets(List<SavedAuthor> Authors, List<SavedColour> Colours);
