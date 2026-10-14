using System.Security.Claims;
using AnnotationStore.Annotations;
using AnnotationStore.Auth;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.Collections;

// Whether the signed-in user can see or change something in a collection.
public static class CollectionAccess
{
    // Null if they aren't a member (or the collection doesn't exist). Someone
    // else's personal collection they've shared counts as Viewer.
    public static async Task<CollectionRole?> RoleAsync(this AnnotationDbContext db, Guid collectionId, string userId)
    {
        var role = await db.CollectionMembers
            .Where(m => m.CollectionId == collectionId && m.UserId == userId)
            .Select(m => (CollectionRole?)m.Role)
            .FirstOrDefaultAsync();
        if (role is not null) return role;
        var shared = await db.Collections.AnyAsync(c =>
            c.CollectionId == collectionId && c.Kind == CollectionKind.Personal && c.Shared);
        return shared ? CollectionRole.Viewer : null;
    }

    // Null means go ahead, otherwise it's the response to send. Not a member
    // is a 404 rather than a 403, so it doesn't say whether it exists. An
    // ended session can still be read, but nothing in it can change.
    public static async Task<IResult?> RequireAsync(
        this AnnotationDbContext db, Guid collectionId, ClaimsPrincipal user, CollectionRole atLeast)
    {
        var role = await db.RoleAsync(collectionId, user.UserId());
        if (role is null) return Results.NotFound();
        if (role < atLeast) return Results.Forbid();
        if (atLeast > CollectionRole.Viewer && await db.HasEndedAsync(collectionId))
            return Results.Conflict("This session has ended");
        return null;
    }

    public static Task<bool> HasEndedAsync(this AnnotationDbContext db, Guid collectionId) =>
        db.Collections.AnyAsync(c => c.CollectionId == collectionId && c.Ended != null);
}
