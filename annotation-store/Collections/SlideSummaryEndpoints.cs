using System.Security.Claims;
using AnnotationStore.Annotations;
using AnnotationStore.Auth;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.Collections;

// One slide on the viewer's gallery. Collections is how many the user can
// open that have something in them, LiveSessions how many sessions they're
// in that haven't ended.
public record SlideSummary(string SlideId, int Collections, int LiveSessions);

// A count of something on one slide - what each of the two queries gives.
public record SlideCount(string SlideId, int Count);

public static class SlideSummaryEndpoints
{
    public static void MapSlideSummaryEndpoints(this WebApplication app)
    {
        // Every slide the user has something on, in one go - what GET
        // /collections would say slide by slide, as two numbers each. A slide
        // with neither isn't in it. Two queries however many slides there are.
        // Signed-in people only - a guest has one session and no gallery.
        app.MapGet("/slides/summary", async (ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var me = user.UserId();
            var withWork = await CollectionsWithWork(db, me).ToDictionaryAsync(s => s.SlideId, s => s.Count);
            var live = await LiveSessions(db, me).ToDictionaryAsync(s => s.SlideId, s => s.Count);

            // Sorted here rather than in SQL, where the order depends on the
            // database's collation.
            return Results.Ok(withWork.Keys.Union(live.Keys)
                .OrderBy(slideId => slideId, StringComparer.Ordinal)
                .Select(slideId => new SlideSummary(slideId, withWork.GetValueOrDefault(slideId), live.GetValueOrDefault(slideId))));
        });
    }

    // Empty ones are left out - opening a slide makes everyone an empty
    // collection there (POST /collections/ensure), so counting them would
    // only say who's looked at it.
    public static IQueryable<SlideCount> CollectionsWithWork(AnnotationDbContext db, string userId) =>
        db.Collections
            .VisibleTo(userId)
            .Where(c => c.Annotations.Any() || c.CellCounts.Any())
            .GroupBy(c => c.SlideId)
            .Select(g => new SlideCount(g.Key, g.Count()));

    // Membership only, whatever VisibleTo comes to let in - a live session
    // is one the user can go back into.
    public static IQueryable<SlideCount> LiveSessions(AnnotationDbContext db, string userId) =>
        db.Collections
            .Where(c => c.Kind == CollectionKind.Session && c.Ended == null && c.Members.Any(m => m.UserId == userId))
            .GroupBy(c => c.SlideId)
            .Select(g => new SlideCount(g.Key, g.Count()));
}
