using System.Security.Claims;
using AnnotationStore.Annotations;
using AnnotationStore.Auth;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.Collections;

public record MemberView(string UserId, string DisplayName, CollectionRole Role);

// A collection as the signed-in user sees it - their own role, and who else
// is in it.
public record CollectionView(
    Guid CollectionId,
    string SlideId,
    string CollectionName,
    DateTimeOffset Created,
    string OwnerId,
    CollectionRole MyRole,
    IReadOnlyList<MemberView> Members);

public record EnsureRequest(string SlideId, string? CollectionName = null);

public record RenameRequest(string CollectionName);

public record MemberRequest(string DisplayName, CollectionRole Role);

// Every Annotation/CellCount/ImageAdjustments row belongs to exactly one
// collection. Everyone has their own per slide, and can add other people to
// it (see CollectionMember). The user always comes from the token, never
// from the request.
public static class CollectionEndpoints
{
    public static void MapCollectionEndpoints(this WebApplication app)
    {
        // Every collection on this slide the user is in - their own first.
        app.MapGet("/collections", async (string slideId, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var me = user.UserId();
            var collections = await db.Collections
                .Where(c => c.SlideId == slideId && c.Members.Any(m => m.UserId == me))
                .Include(c => c.Members)
                .ToListAsync();
            return Results.Ok(collections
                .OrderByDescending(c => c.UserId == me)
                .ThenBy(c => c.CollectionName)
                .Select(c => View(c, me)));
        });

        // Everything in one collection in one go - for Scalar, curl or an
        // export. The viewer reads and writes through the flat endpoints.
        app.MapGet("/collections/{id:guid}", async (Guid id, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(id, user, CollectionRole.Viewer) is { } denied) return denied;
            return Results.Ok(await db.Collections
                .Include(c => c.Members)
                .Include(c => c.Annotations)
                .Include(c => c.CellCounts).ThenInclude(cc => cc.RegionOfInterest)
                .Include(c => c.ImageAdjustments)
                .FirstAsync(c => c.CollectionId == id));
        });

        // Get-or-create the user's own collection for a slide - what the
        // viewer calls on load. Keeps their name up to date while it's there.
        app.MapPost("/collections/ensure", async (EnsureRequest request, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var me = user.UserId();
            var existing = await db.Collections
                .Include(c => c.Members)
                .FirstOrDefaultAsync(c => c.SlideId == request.SlideId && c.UserId == me);
            if (existing is not null)
            {
                var owner = existing.Members.FirstOrDefault(m => m.UserId == me);
                if (owner is not null && owner.DisplayName != user.DisplayName())
                {
                    owner.DisplayName = user.DisplayName();
                    await db.SaveChangesAsync();
                }
                return Results.Ok(View(existing, me));
            }

            var collection = await CreateAsync(db, user, request.SlideId, request.CollectionName);
            return Results.Created($"/collections/{collection.CollectionId}", View(collection, me));
        });

        // Plain create, for completeness - ensure is the one the viewer uses.
        app.MapPost("/collections", async (EnsureRequest request, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var me = user.UserId();
            // Checked up front rather than caught off the unique index, so
            // this doesn't depend on Postgres' or SQLite's error shape.
            if (await db.Collections.AnyAsync(c => c.SlideId == request.SlideId && c.UserId == me))
                return Results.Conflict("You already have a collection for this slide - use POST /collections/ensure instead.");

            var collection = await CreateAsync(db, user, request.SlideId, request.CollectionName);
            return Results.Created($"/collections/{collection.CollectionId}", View(collection, me));
        });

        app.MapPut("/collections/{id:guid}", async (Guid id, RenameRequest request, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(id, user, CollectionRole.Owner) is { } denied) return denied;
            var collection = await db.Collections.Include(c => c.Members).FirstAsync(c => c.CollectionId == id);
            collection.CollectionName = request.CollectionName;
            await db.SaveChangesAsync();
            return Results.Ok(View(collection, user.UserId()));
        });

        app.MapDelete("/collections/{id:guid}", async (Guid id, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(id, user, CollectionRole.Owner) is { } denied) return denied;
            db.Collections.Remove(await db.Collections.FirstAsync(c => c.CollectionId == id));
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Owner only. Adds someone, or changes their role - never to Owner,
        // and never the owner's own.
        app.MapPut("/collections/{id:guid}/members/{userId}",
            async (Guid id, string userId, MemberRequest request, ClaimsPrincipal user, AnnotationDbContext db) =>
            {
                if (await db.RequireAsync(id, user, CollectionRole.Owner) is { } denied) return denied;
                if (request.Role == CollectionRole.Owner) return Results.BadRequest("A collection has one owner");
                if (userId == user.UserId()) return Results.BadRequest("You're the owner already");

                var member = await db.CollectionMembers.FindAsync(id, userId);
                if (member is null)
                {
                    db.CollectionMembers.Add(new CollectionMember
                    {
                        CollectionId = id,
                        UserId = userId,
                        DisplayName = request.DisplayName,
                        Role = request.Role,
                        Added = DateTimeOffset.UtcNow,
                    });
                }
                else
                {
                    member.DisplayName = request.DisplayName;
                    member.Role = request.Role;
                }
                await db.SaveChangesAsync();

                var collection = await db.Collections.Include(c => c.Members).FirstAsync(c => c.CollectionId == id);
                return Results.Ok(View(collection, user.UserId()));
            });

        // The owner taking someone out, or someone leaving. The owner can't leave.
        app.MapDelete("/collections/{id:guid}/members/{userId}",
            async (Guid id, string userId, ClaimsPrincipal user, AnnotationDbContext db) =>
            {
                var me = user.UserId();
                var myRole = await db.RoleAsync(id, me);
                if (myRole is null) return Results.NotFound();
                if (myRole != CollectionRole.Owner && userId != me) return Results.Forbid();

                var member = await db.CollectionMembers.FindAsync(id, userId);
                if (member is null) return Results.NotFound();
                if (member.Role == CollectionRole.Owner) return Results.BadRequest("The owner can't be taken out");

                db.CollectionMembers.Remove(member);
                await db.SaveChangesAsync();
                return Results.NoContent();
            });
    }

    private static async Task<Collections> CreateAsync(
        AnnotationDbContext db, ClaimsPrincipal user, string slideId, string? name)
    {
        var now = DateTimeOffset.UtcNow;
        var collection = new Collections
        {
            CollectionId = Guid.NewGuid(),
            SlideId = slideId,
            UserId = user.UserId(),
            CollectionName = string.IsNullOrWhiteSpace(name) ? $"{user.DisplayName()}'s collection" : name,
            Created = now,
        };
        collection.Members.Add(new CollectionMember
        {
            CollectionId = collection.CollectionId,
            UserId = collection.UserId,
            DisplayName = user.DisplayName(),
            Role = CollectionRole.Owner,
            Added = now,
        });
        db.Collections.Add(collection);
        await db.SaveChangesAsync();
        return collection;
    }

    private static CollectionView View(Collections collection, string me) => new(
        collection.CollectionId,
        collection.SlideId,
        collection.CollectionName,
        collection.Created,
        collection.UserId,
        collection.Members.First(m => m.UserId == me).Role,
        collection.Members
            .OrderByDescending(m => m.Role)
            .ThenBy(m => m.DisplayName)
            .Select(m => new MemberView(m.UserId, m.DisplayName, m.Role))
            .ToList());
}
