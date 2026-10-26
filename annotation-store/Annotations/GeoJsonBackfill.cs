using AnnotationStore.CellCounts;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.Annotations;

// Rounds the shapes saved before GeoJsonRounding, once:
//
//     dotnet run -- round-geojson
//
// Straight to the rows rather than through a change set - it isn't anyone's
// change, and the History tab shouldn't show it. Reads a page of shapes at
// a time, so it never holds the whole table; run it again and it finds
// nothing to do.
public static class GeoJsonBackfill
{
    private const int Page = 1000;

    public static async Task<(int Annotations, int Regions)> RunAsync(AnnotationDbContext db, CancellationToken cancellationToken = default)
    {
        var annotations = 0;
        var annotationIds = await db.Annotations.Select(a => a.Id).ToListAsync(cancellationToken);
        foreach (var page in annotationIds.Chunk(Page))
        {
            var rows = await db.Annotations.AsNoTracking().Where(a => page.Contains(a.Id)).Select(a => new { a.Id, a.GeoJson }).ToListAsync(cancellationToken);
            foreach (var row in rows)
            {
                var rounded = GeoJsonRounding.Round(row.GeoJson);
                if (ReferenceEquals(rounded, row.GeoJson)) continue;
                await db.Annotations.Where(a => a.Id == row.Id).ExecuteUpdateAsync(s => s.SetProperty(a => a.GeoJson, rounded), cancellationToken);
                annotations++;
            }
        }

        var regions = 0;
        var regionIds = await db.RegionsOfInterest.Select(r => r.Id).ToListAsync(cancellationToken);
        foreach (var page in regionIds.Chunk(Page))
        {
            var rows = await db.RegionsOfInterest.AsNoTracking().Where(r => page.Contains(r.Id)).Select(r => new { r.Id, r.GeoJson }).ToListAsync(cancellationToken);
            foreach (var row in rows)
            {
                var rounded = GeoJsonRounding.Round(row.GeoJson);
                if (ReferenceEquals(rounded, row.GeoJson)) continue;
                await db.RegionsOfInterest.Where(r => r.Id == row.Id).ExecuteUpdateAsync(s => s.SetProperty(r => r.GeoJson, rounded), cancellationToken);
                regions++;
            }
        }
        return (annotations, regions);
    }
}
