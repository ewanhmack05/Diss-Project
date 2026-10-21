using System.Text.Json;
using AnnotationStore.Annotations;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.CellCounts;

public record ColourCount(string Colour, int Count);

public record PlacedByCount(string UserId, string Name, int Count);

// How many dots of each colour, and how many each person placed - what the
// viewer's Saved list shows for a count without needing the dots
// themselves. Worked out once, when a count is saved, and kept on the row
// (CellCount.ColourCountsJson / PlacedByCountsJson). Same order the
// viewer's own colourBreakdownFromDots / placedByBreakdown give: the order
// each first turns up in.
public static class CellCountSummary
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public static (List<ColourCount> Colours, List<PlacedByCount> PlacedBy) FromDots(string? dots)
    {
        var colours = new List<ColourCount>();
        var placedBy = new List<PlacedByCount>();
        if (string.IsNullOrWhiteSpace(dots)) return (colours, placedBy);

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(dots);
        }
        catch (JsonException)
        {
            // The viewer treats unreadable dots as none - same here.
            return (colours, placedBy);
        }

        using (document)
        {
            if (document.RootElement.ValueKind != JsonValueKind.Array) return (colours, placedBy);
            var colourIndex = new Dictionary<string, int>();
            var personIndex = new Dictionary<string, int>();
            foreach (var dot in document.RootElement.EnumerateArray())
            {
                if (dot.ValueKind != JsonValueKind.Object) continue;

                if (dot.TryGetProperty("colour", out var colour) && colour.ValueKind == JsonValueKind.String)
                {
                    var key = colour.GetString()!;
                    if (colourIndex.TryGetValue(key, out var i)) colours[i] = colours[i] with { Count = colours[i].Count + 1 };
                    else
                    {
                        colourIndex[key] = colours.Count;
                        colours.Add(new ColourCount(key, 1));
                    }
                }

                if (dot.TryGetProperty("placedBy", out var person) && person.ValueKind == JsonValueKind.Object
                    && person.TryGetProperty("userId", out var userId) && userId.ValueKind == JsonValueKind.String)
                {
                    var id = userId.GetString()!;
                    if (personIndex.TryGetValue(id, out var i)) placedBy[i] = placedBy[i] with { Count = placedBy[i].Count + 1 };
                    else
                    {
                        var name = person.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString()! : id;
                        personIndex[id] = placedBy.Count;
                        placedBy.Add(new PlacedByCount(id, name, 1));
                    }
                }
            }
        }
        return (colours, placedBy);
    }

    // Sets the stored summary on a count from its dots.
    public static void Stamp(CellCount cellCount)
    {
        var (colours, placedBy) = FromDots(cellCount.Dots);
        cellCount.ColourCountsJson = JsonSerializer.Serialize(colours, Web);
        cellCount.PlacedByCountsJson = JsonSerializer.Serialize(placedBy, Web);
    }

    public static List<T> Read<T>(string? json) =>
        string.IsNullOrEmpty(json) ? [] : JsonSerializer.Deserialize<List<T>>(json, Web) ?? [];

    // The Saved list's rows for these counts, in the order given. Every
    // column but Dots, so the database never reads them.
    public static async Task<List<CellCountListItem>> ListItemsAsync(this IQueryable<CellCount> counts, AnnotationDbContext db)
    {
        var rows = await counts
            .Select(c => new
            {
                c.Id,
                c.CollectionId,
                c.SlideId,
                c.Label,
                c.Notes,
                c.WithAnnotation,
                c.WithRoi,
                c.Count,
                c.DotSize,
                c.LocationX,
                c.LocationY,
                c.Created,
                c.CreatedById,
                c.CreatedByName,
                c.RegionOfInterest,
                c.ColourCountsJson,
                c.PlacedByCountsJson,
            })
            .ToListAsync();

        // Counts saved before the summary existed get it worked out once, the
        // first time they're listed, and kept.
        var unsummarised = rows.Where(r => r.ColourCountsJson is null || r.PlacedByCountsJson is null).Select(r => r.Id).ToList();
        var filledIn = new Dictionary<Guid, (string Colours, string PlacedBy)>();
        if (unsummarised.Count > 0)
        {
            foreach (var cellCount in await db.CellCounts.Where(c => unsummarised.Contains(c.Id)).ToListAsync())
            {
                Stamp(cellCount);
                filledIn[cellCount.Id] = (cellCount.ColourCountsJson!, cellCount.PlacedByCountsJson!);
            }
            await db.SaveChangesAsync();
        }

        return rows.Select(r =>
        {
            var (colours, placedBy) = filledIn.TryGetValue(r.Id, out var stamped) ? stamped : (r.ColourCountsJson, r.PlacedByCountsJson);
            return new CellCountListItem(
                r.Id, r.CollectionId, r.SlideId, r.Label, r.Notes, r.WithAnnotation, r.WithRoi, r.Count, r.DotSize,
                r.LocationX, r.LocationY, r.Created, r.CreatedById, r.CreatedByName, r.RegionOfInterest,
                Read<ColourCount>(colours), Read<PlacedByCount>(placedBy));
        }).ToList();
    }
}

// A count as the Saved list gets it - everything but the dots, which can
// run to tens of megabytes, plus their summary. Dots is always null here;
// GET /cellcounts/{id} has them.
public record CellCountListItem(
    Guid Id,
    Guid CollectionId,
    string SlideId,
    string Label,
    string Notes,
    bool WithAnnotation,
    bool WithRoi,
    int Count,
    int DotSize,
    double? LocationX,
    double? LocationY,
    DateTimeOffset Created,
    string CreatedById,
    string CreatedByName,
    RegionOfInterest? RegionOfInterest,
    List<ColourCount> ColourCounts,
    List<PlacedByCount> PlacedByCounts)
{
    public string? Dots => null;
}
