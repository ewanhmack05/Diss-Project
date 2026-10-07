using System.Net;
using System.Net.Http.Json;
using AnnotationStore.Annotations;
using AnnotationStore.Collections;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AnnotationStore.Tests;

// Sessions - collections people work in together, joined through invite links.
public class SessionsTests : IClassFixture<CellCountApiFactory>
{
    private static readonly System.Text.Json.JsonSerializerOptions Json = TestJson.Options;

    private readonly CellCountApiFactory _factory;

    public SessionsTests(CellCountApiFactory factory)
    {
        _factory = factory;
    }

    private HttpClient As(string userId) => TestAuthHandler.As(_factory.CreateClient(), userId, $"User {userId}");

    private static string NewSlide() => Guid.NewGuid().ToString();

    private static async Task<CollectionView> StartAsync(HttpClient host, string slideId, string? name = null)
    {
        var response = await host.PostAsJsonAsync("/sessions", new EnsureRequest(slideId, name));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CollectionView>(Json))!;
    }

    private static async Task<InviteView> InviteAsync(HttpClient host, Guid sessionId, CollectionRole role = CollectionRole.Editor, int hours = 24)
    {
        var response = await host.PostAsJsonAsync($"/collections/{sessionId}/invites", new InviteRequest(role, hours), Json);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<InviteView>(Json))!;
    }

    private static Task<HttpResponseMessage> AcceptAsync(HttpClient who, string code) =>
        who.PostAsync($"/invites/{code}/accept", null);

    private static Task<InvitePreview?> PreviewAsync(HttpClient who, string code) =>
        who.GetFromJsonAsync<InvitePreview>($"/invites/{code}", Json);

    private static Task<HttpResponseMessage> PostAnnotationAsync(HttpClient who, Guid collectionId) =>
        who.PostAsJsonAsync("/annotations", new Annotation { CollectionId = collectionId, Label = "a" });

    [Fact]
    public async Task Start_MakesASessionYouHost_AlongsideYourOwnCollection()
    {
        var alice = As("alice");
        var slideId = NewSlide();
        await TestJson.EnsureCollectionAsync(alice, slideId);

        var session = await StartAsync(alice, slideId);
        var second = await StartAsync(alice, slideId, "Ki-67 review");

        Assert.Equal(CollectionKind.Session, session.Kind);
        Assert.Equal(CollectionRole.Owner, session.MyRole);
        Assert.Equal("User alice's session", session.CollectionName);
        var list = await alice.GetFromJsonAsync<List<CollectionView>>($"/collections?slideId={slideId}", Json);
        Assert.Equal(
            [CollectionKind.Personal, CollectionKind.Session, CollectionKind.Session],
            list!.Select(c => c.Kind));
        Assert.Equal(second.CollectionId, list[1].CollectionId);
    }

    [Fact]
    public async Task AnInvite_LetsSomeoneJoin_WithItsRole()
    {
        var alice = As("alice");
        var bob = As("bob");
        var session = await StartAsync(alice, NewSlide(), "Ki-67 review");
        var invite = await InviteAsync(alice, session.CollectionId, CollectionRole.Editor);

        // Not in yet - can't see anything in it.
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/annotations?collectionId={session.CollectionId}")).StatusCode);

        var preview = (await PreviewAsync(bob, invite.Code))!;
        Assert.Equal("open", preview.Status);
        Assert.Equal("Ki-67 review", preview.CollectionName);
        Assert.Equal("User alice", preview.HostName);
        Assert.Equal(CollectionRole.Editor, preview.Role);
        Assert.False(preview.AlreadyMember);
        Assert.Equal(["User alice"], preview.People);

        var accept = await AcceptAsync(bob, invite.Code);
        Assert.Equal(HttpStatusCode.OK, accept.StatusCode);
        var joined = (await accept.Content.ReadFromJsonAsync<CollectionView>(Json))!;
        Assert.Equal(CollectionRole.Editor, joined.MyRole);
        Assert.Equal(HttpStatusCode.Created, (await PostAnnotationAsync(bob, session.CollectionId)).StatusCode);
    }

    [Fact]
    public async Task AViewOnlyInvite_CantChangeAnything()
    {
        var alice = As("alice");
        var carol = As("carol");
        var session = await StartAsync(alice, NewSlide());
        var invite = await InviteAsync(alice, session.CollectionId, CollectionRole.Viewer);

        (await AcceptAsync(carol, invite.Code)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.OK, (await carol.GetAsync($"/annotations?collectionId={session.CollectionId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await PostAnnotationAsync(carol, session.CollectionId)).StatusCode);
    }

    [Fact]
    public async Task AcceptingAgain_KeepsTheHigherRole()
    {
        var alice = As("alice");
        var bob = As("bob");
        var session = await StartAsync(alice, NewSlide());
        (await AcceptAsync(bob, (await InviteAsync(alice, session.CollectionId, CollectionRole.Editor)).Code)).EnsureSuccessStatusCode();

        var again = await AcceptAsync(bob, (await InviteAsync(alice, session.CollectionId, CollectionRole.Viewer)).Code);

        Assert.Equal(CollectionRole.Editor, (await again.Content.ReadFromJsonAsync<CollectionView>(Json))!.MyRole);
    }

    [Fact]
    public async Task ChangingALink_ChangesWhoItLetsIn()
    {
        var alice = As("alice");
        var bob = As("bob");
        var session = await StartAsync(alice, NewSlide());
        var invite = await InviteAsync(alice, session.CollectionId, CollectionRole.Editor);
        var url = $"/collections/{session.CollectionId}/invites/{invite.Code}";

        var response = await alice.PutAsJsonAsync(url, new InviteRequest(CollectionRole.Viewer, 1), Json);
        response.EnsureSuccessStatusCode();
        var changed = (await response.Content.ReadFromJsonAsync<InviteView>(Json))!;
        Assert.Equal(invite.Code, changed.Code);
        Assert.Equal(CollectionRole.Viewer, changed.Role);
        Assert.True(changed.Expires < invite.Expires);

        var accept = await AcceptAsync(bob, invite.Code);
        Assert.Equal(CollectionRole.Viewer, (await accept.Content.ReadFromJsonAsync<CollectionView>(Json))!.MyRole);

        Assert.Equal(HttpStatusCode.Forbidden, (await bob.PutAsJsonAsync(url, new InviteRequest(CollectionRole.Editor, 1), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.PutAsJsonAsync(url, new InviteRequest(CollectionRole.Owner, 1), Json)).StatusCode);
        (await alice.DeleteAsync(url)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Gone, (await alice.PutAsJsonAsync(url, new InviteRequest(CollectionRole.Editor, 1), Json)).StatusCode);
    }

    [Fact]
    public async Task ANewLink_StopsTheOldOne_AndStoppedLinksDontWork()
    {
        var alice = As("alice");
        var bob = As("bob");
        var session = await StartAsync(alice, NewSlide());
        var first = await InviteAsync(alice, session.CollectionId);
        var second = await InviteAsync(alice, session.CollectionId);

        Assert.Equal("stopped", (await PreviewAsync(bob, first.Code))!.Status);
        Assert.Equal(HttpStatusCode.Gone, (await AcceptAsync(bob, first.Code)).StatusCode);
        var open = await alice.GetFromJsonAsync<List<InviteView>>($"/collections/{session.CollectionId}/invites", Json);
        Assert.Equal([second.Code], open!.Select(i => i.Code));

        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/collections/{session.CollectionId}/invites/{second.Code}")).StatusCode);
        Assert.Equal(HttpStatusCode.Gone, (await AcceptAsync(bob, second.Code)).StatusCode);
    }

    [Fact]
    public async Task AnExpiredLink_DoesntWork()
    {
        var alice = As("alice");
        var bob = As("bob");
        var session = await StartAsync(alice, NewSlide());
        var invite = await InviteAsync(alice, session.CollectionId, hours: 1);
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
            var stored = await db.CollectionInvites.FirstAsync(i => i.Code == invite.Code);
            stored.Expires = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }

        Assert.Equal("expired", (await PreviewAsync(bob, invite.Code))!.Status);
        Assert.Equal(HttpStatusCode.Gone, (await AcceptAsync(bob, invite.Code)).StatusCode);
    }

    [Fact]
    public async Task UnknownCodes_AreNotFound()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await As("bob").GetAsync("/invites/nope")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await AcceptAsync(As("bob"), "nope")).StatusCode);
    }

    [Fact]
    public async Task InviteLengths_AreLimited()
    {
        var alice = As("alice");
        var session = await StartAsync(alice, NewSlide());

        foreach (var hours in new[] { 0, CollectionEndpoints.MaxInviteHours + 1 })
        {
            var response = await alice.PostAsJsonAsync($"/collections/{session.CollectionId}/invites",
                new InviteRequest(CollectionRole.Editor, hours), Json);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
    }

    [Fact]
    public async Task Ending_MakesItReadOnly_AndStopsItsLinks()
    {
        var alice = As("alice");
        var bob = As("bob");
        var session = await StartAsync(alice, NewSlide());
        var invite = await InviteAsync(alice, session.CollectionId);
        (await AcceptAsync(bob, invite.Code)).EnsureSuccessStatusCode();

        var end = await alice.PostAsync($"/collections/{session.CollectionId}/end", null);
        Assert.Equal(HttpStatusCode.OK, end.StatusCode);
        Assert.NotNull((await end.Content.ReadFromJsonAsync<CollectionView>(Json))!.Ended);

        Assert.Equal(HttpStatusCode.OK, (await bob.GetAsync($"/annotations?collectionId={session.CollectionId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await PostAnnotationAsync(bob, session.CollectionId)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await PostAnnotationAsync(alice, session.CollectionId)).StatusCode);
        Assert.Equal("ended", (await PreviewAsync(As("carol"), invite.Code))!.Status);
        Assert.Equal(HttpStatusCode.Gone, (await AcceptAsync(As("carol"), invite.Code)).StatusCode);
    }

    [Fact]
    public async Task OnlyTheHost_ManagesPeopleAndLinks()
    {
        var alice = As("alice");
        var bob = As("bob");
        var session = await StartAsync(alice, NewSlide());
        (await AcceptAsync(bob, (await InviteAsync(alice, session.CollectionId)).Code)).EnsureSuccessStatusCode();
        var id = session.CollectionId;

        Assert.Equal(HttpStatusCode.Forbidden,
            (await bob.PostAsJsonAsync($"/collections/{id}/invites", new InviteRequest(CollectionRole.Editor, 1), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await bob.PutAsJsonAsync($"/collections/{id}/members/alice", new MemberRequest("", CollectionRole.Viewer), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.PostAsync($"/collections/{id}/end", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.PutAsJsonAsync($"/collections/{id}", new RenameRequest("mine"))).StatusCode);

        // The host turns bob down to view only, then takes him out.
        (await alice.PutAsJsonAsync($"/collections/{id}/members/bob", new MemberRequest("", CollectionRole.Viewer), Json))
            .EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await PostAnnotationAsync(bob, id)).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/collections/{id}/members/bob")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/annotations?collectionId={id}")).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest,
            (await alice.PutAsJsonAsync($"/collections/{id}/members/carol", new MemberRequest("", CollectionRole.Owner), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.DeleteAsync($"/collections/{id}/members/alice")).StatusCode);
    }

    [Fact]
    public async Task SomeoneCanLeave_AndIsThenLockedOut()
    {
        var alice = As("alice");
        var bob = As("bob");
        var session = await StartAsync(alice, NewSlide());
        (await AcceptAsync(bob, (await InviteAsync(alice, session.CollectionId)).Code)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.NoContent, (await bob.DeleteAsync($"/collections/{session.CollectionId}/members/bob")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/annotations?collectionId={session.CollectionId}")).StatusCode);
    }

    [Fact]
    public async Task Membership_IsForTheHub_AndOnlyForMembers()
    {
        var alice = As("alice");
        var session = await StartAsync(alice, NewSlide());

        var mine = await alice.GetFromJsonAsync<MembershipView>($"/collections/{session.CollectionId}/membership", Json);

        Assert.Equal(CollectionRole.Owner, mine!.Role);
        Assert.Equal(CollectionKind.Session, mine.Kind);
        Assert.Null(mine.Ended);
        Assert.Equal(HttpStatusCode.NotFound, (await As("bob").GetAsync($"/collections/{session.CollectionId}/membership")).StatusCode);
    }

    [Fact]
    public async Task Deleting_TakesItsPeopleAndLinksWithIt()
    {
        var alice = As("alice");
        var session = await StartAsync(alice, NewSlide());
        var invite = await InviteAsync(alice, session.CollectionId);
        (await AcceptAsync(As("bob"), invite.Code)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/collections/{session.CollectionId}")).StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
        Assert.False(await db.CollectionMembers.AnyAsync(m => m.CollectionId == session.CollectionId));
        Assert.False(await db.CollectionInvites.AnyAsync(i => i.CollectionId == session.CollectionId));
    }
}
