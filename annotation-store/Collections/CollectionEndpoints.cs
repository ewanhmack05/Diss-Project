using System.Security.Claims;
using System.Security.Cryptography;
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
    CollectionKind Kind,
    DateTimeOffset? Ended,
    CollectionRole MyRole,
    IReadOnlyList<MemberView> Members);

public record EnsureRequest(string SlideId, string? CollectionName = null);

public record RenameRequest(string CollectionName);

public record MemberRequest(string DisplayName, CollectionRole Role);

public record InviteRequest(CollectionRole Role, int Hours);

public record InviteView(string Code, CollectionRole Role, DateTimeOffset Created, DateTimeOffset Expires);

// What someone who's been sent a link sees before joining. Status is
// "open", "expired", "stopped" (the host stopped the link) or "ended" (the
// session is over).
public record InvitePreview(
    string Code,
    Guid CollectionId,
    string SlideId,
    string CollectionName,
    string HostName,
    CollectionRole Role,
    DateTimeOffset Expires,
    string Status,
    bool AlreadyMember,
    IReadOnlyList<string> People);

// Just enough for the realtime hub to decide whether someone can join a
// session's room - see realtime-hub's SessionAccess.
public record MembershipView(Guid CollectionId, string SlideId, CollectionKind Kind, CollectionRole Role, DateTimeOffset? Ended);

// Every Annotation/CellCount/ImageAdjustments row belongs to exactly one
// collection. Everyone has their own per slide (personal), and can start
// sessions to work with others, who join through invite links. The user
// always comes from the token, never from the request.
public static class CollectionEndpoints
{
    public const int MaxInviteHours = 24 * 7;

    public static void MapCollectionEndpoints(this WebApplication app)
    {
        // Every collection on this slide the user is in - their own first,
        // then sessions still going, newest first, then ended ones.
        app.MapGet("/collections", async (string slideId, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var me = user.UserId();
            var collections = await db.Collections
                .Where(c => c.SlideId == slideId && c.Members.Any(m => m.UserId == me))
                .Include(c => c.Members)
                .ToListAsync();
            return Results.Ok(collections
                .OrderBy(c => c.Kind == CollectionKind.Personal ? 0 : c.Ended is null ? 1 : 2)
                .ThenByDescending(c => c.Created)
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

        // For the realtime hub, checking someone's allowed in a session's room.
        app.MapGet("/collections/{id:guid}/membership", async (Guid id, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var me = user.UserId();
            var collection = await db.Collections.Include(c => c.Members).FirstOrDefaultAsync(c => c.CollectionId == id);
            var member = collection?.Members.FirstOrDefault(m => m.UserId == me);
            if (collection is null || member is null) return Results.NotFound();
            return Results.Ok(new MembershipView(collection.CollectionId, collection.SlideId, collection.Kind, member.Role, collection.Ended));
        });

        // Get-or-create the user's own collection for a slide - what the
        // viewer calls on load. Keeps their name up to date while it's there.
        app.MapPost("/collections/ensure", async (EnsureRequest request, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var me = user.UserId();
            var existing = await db.Collections
                .Include(c => c.Members)
                .FirstOrDefaultAsync(c => c.SlideId == request.SlideId && c.UserId == me && c.Kind == CollectionKind.Personal);
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

            var collection = await CreateAsync(db, user, request.SlideId, CollectionKind.Personal,
                string.IsNullOrWhiteSpace(request.CollectionName) ? $"{user.DisplayName()}'s collection" : request.CollectionName);
            return Results.Created($"/collections/{collection.CollectionId}", View(collection, me));
        });

        // Plain create of a personal collection, for completeness - ensure is
        // the one the viewer uses.
        app.MapPost("/collections", async (EnsureRequest request, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var me = user.UserId();
            // Checked up front rather than caught off the unique index, so
            // this doesn't depend on Postgres' or SQLite's error shape.
            if (await db.Collections.AnyAsync(c => c.SlideId == request.SlideId && c.UserId == me && c.Kind == CollectionKind.Personal))
                return Results.Conflict("You already have a collection for this slide - use POST /collections/ensure instead.");

            var collection = await CreateAsync(db, user, request.SlideId, CollectionKind.Personal,
                string.IsNullOrWhiteSpace(request.CollectionName) ? $"{user.DisplayName()}'s collection" : request.CollectionName);
            return Results.Created($"/collections/{collection.CollectionId}", View(collection, me));
        });

        // Starts a session on a slide, hosted by the caller. Nobody else is in
        // it until they open an invite link.
        app.MapPost("/sessions", async (EnsureRequest request, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var collection = await CreateAsync(db, user, request.SlideId, CollectionKind.Session,
                string.IsNullOrWhiteSpace(request.CollectionName) ? $"{user.DisplayName()}'s session" : request.CollectionName);
            return Results.Created($"/collections/{collection.CollectionId}", View(collection, user.UserId()));
        });

        app.MapPut("/collections/{id:guid}", async (Guid id, RenameRequest request, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(id, user, CollectionRole.Owner) is { } denied) return denied;
            if (string.IsNullOrWhiteSpace(request.CollectionName)) return Results.BadRequest("A name is needed");
            var collection = await db.Collections.Include(c => c.Members).FirstAsync(c => c.CollectionId == id);
            collection.CollectionName = request.CollectionName.Trim();
            await db.SaveChangesAsync();
            return Results.Ok(View(collection, user.UserId()));
        });

        app.MapDelete("/collections/{id:guid}", async (Guid id, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var role = await db.RoleAsync(id, user.UserId());
            if (role is null) return Results.NotFound();
            if (role != CollectionRole.Owner) return Results.Forbid();
            db.Collections.Remove(await db.Collections.FirstAsync(c => c.CollectionId == id));
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Host only. Stops its links and makes it read-only for everyone - it
        // stays so people can look back at it.
        app.MapPost("/collections/{id:guid}/end", async (Guid id, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(id, user, CollectionRole.Owner) is { } denied) return denied;
            var collection = await db.Collections.Include(c => c.Members).Include(c => c.Invites).FirstAsync(c => c.CollectionId == id);
            if (collection.Kind != CollectionKind.Session) return Results.BadRequest("Only a session can be ended");

            var now = DateTimeOffset.UtcNow;
            collection.Ended = now;
            foreach (var invite in collection.Invites.Where(i => i.Stopped is null)) invite.Stopped = now;
            await db.SaveChangesAsync();
            return Results.Ok(View(collection, user.UserId()));
        });

        // Host only, sessions only. Changes someone's role - never to Owner,
        // and never the host's own. People are added through invite links.
        app.MapPut("/collections/{id:guid}/members/{userId}",
            async (Guid id, string userId, MemberRequest request, ClaimsPrincipal user, AnnotationDbContext db) =>
            {
                if (await db.RequireAsync(id, user, CollectionRole.Owner) is { } denied) return denied;
                if (request.Role == CollectionRole.Owner) return Results.BadRequest("A collection has one owner");
                if (userId == user.UserId()) return Results.BadRequest("You're the owner already");
                if (!await IsSessionAsync(db, id)) return Results.BadRequest("Only a session can have other people in it");

                var member = await db.CollectionMembers.FindAsync(id, userId);
                if (member is null) return Results.NotFound();
                member.Role = request.Role;
                if (!string.IsNullOrWhiteSpace(request.DisplayName)) member.DisplayName = request.DisplayName;
                await db.SaveChangesAsync();

                var collection = await db.Collections.Include(c => c.Members).FirstAsync(c => c.CollectionId == id);
                return Results.Ok(View(collection, user.UserId()));
            });

        // The host taking someone out, or someone leaving. The host can't leave.
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

        // Host only. Makes a new link - any earlier one stops, so there's only
        // ever one working link per session.
        app.MapPost("/collections/{id:guid}/invites", async (Guid id, InviteRequest request, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(id, user, CollectionRole.Owner) is { } denied) return denied;
            if (!await IsSessionAsync(db, id)) return Results.BadRequest("Only a session can be joined");
            if (request.Role == CollectionRole.Owner) return Results.BadRequest("An invite can't make someone the host");
            if (request.Hours < 1 || request.Hours > MaxInviteHours)
                return Results.BadRequest($"Hours has to be between 1 and {MaxInviteHours}");

            var now = DateTimeOffset.UtcNow;
            foreach (var old in await db.CollectionInvites.Where(i => i.CollectionId == id && i.Stopped == null).ToListAsync())
                old.Stopped = now;

            var invite = new CollectionInvite
            {
                Code = NewCode(),
                CollectionId = id,
                Role = request.Role,
                CreatedById = user.UserId(),
                Created = now,
                Expires = now.AddHours(request.Hours),
            };
            db.CollectionInvites.Add(invite);
            await db.SaveChangesAsync();
            return Results.Created($"/invites/{invite.Code}", InviteViewOf(invite));
        });

        // Host only. The session's working links, newest first.
        app.MapGet("/collections/{id:guid}/invites", async (Guid id, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(id, user, CollectionRole.Owner) is { } denied) return denied;
            var now = DateTimeOffset.UtcNow;
            var invites = await db.CollectionInvites.Where(i => i.CollectionId == id && i.Stopped == null).ToListAsync();
            return Results.Ok(invites.Where(i => i.Expires > now).OrderByDescending(i => i.Created).Select(InviteViewOf));
        });

        app.MapDelete("/collections/{id:guid}/invites/{code}", async (Guid id, string code, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            if (await db.RequireAsync(id, user, CollectionRole.Owner) is { } denied) return denied;
            var invite = await db.CollectionInvites.FirstOrDefaultAsync(i => i.Code == code && i.CollectionId == id);
            if (invite is null) return Results.NotFound();
            invite.Stopped ??= DateTimeOffset.UtcNow;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Anyone signed in with the code can see what it's for before joining.
        app.MapGet("/invites/{code}", async (string code, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var found = await FindInviteAsync(db, code);
            if (found is null) return Results.NotFound();
            var (invite, collection) = found.Value;
            var me = user.UserId();
            var host = collection.Members.FirstOrDefault(m => m.Role == CollectionRole.Owner);
            return Results.Ok(new InvitePreview(
                invite.Code,
                collection.CollectionId,
                collection.SlideId,
                collection.CollectionName,
                host?.DisplayName ?? "",
                invite.Role,
                invite.Expires,
                StatusOf(invite, collection),
                collection.Members.Any(m => m.UserId == me),
                collection.Members.Where(m => m.UserId != me).Select(m => m.DisplayName).ToList()));
        });

        // Joins the session with the invite's role. Someone already in it
        // keeps whichever role is higher.
        app.MapPost("/invites/{code}/accept", async (string code, ClaimsPrincipal user, AnnotationDbContext db) =>
        {
            var found = await FindInviteAsync(db, code);
            if (found is null) return Results.NotFound();
            var (invite, collection) = found.Value;
            var status = StatusOf(invite, collection);
            if (status != "open") return Results.Problem($"This invite has {status}", statusCode: StatusCodes.Status410Gone);

            var me = user.UserId();
            var member = collection.Members.FirstOrDefault(m => m.UserId == me);
            if (member is null)
            {
                collection.Members.Add(new CollectionMember
                {
                    CollectionId = collection.CollectionId,
                    UserId = me,
                    DisplayName = user.DisplayName(),
                    Role = invite.Role,
                    Added = DateTimeOffset.UtcNow,
                });
            }
            else if (member.Role < invite.Role)
            {
                member.Role = invite.Role;
            }
            await db.SaveChangesAsync();
            return Results.Ok(View(collection, me));
        });
    }

    private static async Task<(CollectionInvite Invite, Collections Collection)?> FindInviteAsync(AnnotationDbContext db, string code)
    {
        var invite = await db.CollectionInvites.FirstOrDefaultAsync(i => i.Code == code);
        if (invite is null) return null;
        var collection = await db.Collections.Include(c => c.Members).FirstAsync(c => c.CollectionId == invite.CollectionId);
        return (invite, collection);
    }

    private static string StatusOf(CollectionInvite invite, Collections collection) =>
        collection.Ended is not null ? "ended"
        : invite.Stopped is not null ? "stopped"
        : invite.Expires <= DateTimeOffset.UtcNow ? "expired"
        : "open";

    private static Task<bool> IsSessionAsync(AnnotationDbContext db, Guid id) =>
        db.Collections.AnyAsync(c => c.CollectionId == id && c.Kind == CollectionKind.Session);

    // 12 url-safe characters, 72 random bits - the code is the only thing
    // standing between a link and the session, so it can't be guessable.
    private static string NewCode() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(9)).Replace('+', '-').Replace('/', '_');

    private static InviteView InviteViewOf(CollectionInvite invite) =>
        new(invite.Code, invite.Role, invite.Created, invite.Expires);

    private static async Task<Collections> CreateAsync(
        AnnotationDbContext db, ClaimsPrincipal user, string slideId, CollectionKind kind, string name)
    {
        var now = DateTimeOffset.UtcNow;
        var collection = new Collections
        {
            CollectionId = Guid.NewGuid(),
            SlideId = slideId,
            UserId = user.UserId(),
            Kind = kind,
            CollectionName = name,
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
        collection.Kind,
        collection.Ended,
        collection.Members.First(m => m.UserId == me).Role,
        collection.Members
            .OrderByDescending(m => m.Role)
            .ThenBy(m => m.DisplayName)
            .Select(m => new MemberView(m.UserId, m.DisplayName, m.Role))
            .ToList());
}
