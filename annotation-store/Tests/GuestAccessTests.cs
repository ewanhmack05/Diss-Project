using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AnnotationStore.Annotations;
using AnnotationStore.Auth;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using AnnotationStore.Paging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AnnotationStore.Tests;

// Guests - no account, view only, on the one session in their token. See
// docs/guests.md. Tokens are real HS256 ones through the real Guest scheme.
public class GuestAccessTests : IClassFixture<CellCountApiFactory>
{
    private static readonly JsonSerializerOptions Json = TestJson.Options;

    private readonly CellCountApiFactory _factory;

    public GuestAccessTests(CellCountApiFactory factory)
    {
        _factory = factory;
    }

    private HttpClient As(string userId) => TestAuthHandler.As(_factory.CreateClient(), userId, $"User {userId}");

    private HttpClient Guest(Guid sessionId, string? guestId = null) =>
        GuestTokens.With(_factory.CreateClient(), GuestTokens.Make(GuestTokens.Key(_factory), sessionId, guestId));

    private HttpClient WithToken(string token) => GuestTokens.With(_factory.CreateClient(), token);

    private static string NewSlide() => Guid.NewGuid().ToString();

    // A session alice hosts and bob edits in, with one of everything in it.
    private record Seeded(Guid SessionId, string SlideId, Guid AnnotationId, Guid CellCountId, Guid GroupId, Guid AdjustmentId, string InviteCode);

    private async Task<Seeded> SeedAsync(string? slideId = null)
    {
        var alice = As("alice");
        slideId ??= NewSlide();
        var start = await alice.PostAsJsonAsync("/sessions", new EnsureRequest(slideId, "Ki-67 review"));
        Assert.Equal(HttpStatusCode.Created, start.StatusCode);
        var session = (await start.Content.ReadFromJsonAsync<CollectionView>(Json))!;
        var id = session.CollectionId;

        var invite = await alice.PostAsJsonAsync($"/collections/{id}/invites", new InviteRequest(CollectionRole.Editor, 24), Json);
        var code = (await invite.Content.ReadFromJsonAsync<InviteView>(Json))!.Code;
        (await As("bob").PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();

        var group = await alice.PostAsJsonAsync("/annotationgroups", new NewGroupRequest(id, "Tumour"), Json);
        var groupId = (await group.Content.ReadFromJsonAsync<GroupView>(Json))!.Id;
        var annotation = await alice.PostAsJsonAsync("/annotations",
            new Annotation { CollectionId = id, Label = "a", Colour = "#ff0000", GroupId = groupId });
        var annotationId = (await annotation.Content.ReadFromJsonAsync<Annotation>(Json))!.Id;
        var cellCount = await alice.PostAsJsonAsync("/cellcounts",
            new CellCount { CollectionId = id, Label = "c", Dots = "[{\"x\":1,\"y\":2,\"colour\":\"#ff0000\"}]", Count = 1 });
        var cellCountId = (await cellCount.Content.ReadFromJsonAsync<CellCount>(Json))!.Id;
        var adjustment = await alice.PostAsJsonAsync("/imageadjustments",
            new ImageAdjustments.ImageAdjustments { CollectionId = id, AdjustmentName = "p", Adjustments = "{}" });
        var adjustmentId = (await adjustment.Content.ReadFromJsonAsync<ImageAdjustments.ImageAdjustments>(Json))!.ImageAdjustmentId;

        return new Seeded(id, slideId, annotationId, cellCountId, groupId, adjustmentId, code);
    }

    // Every read a guest is allowed, for one collection.
    private static string[] Reads(Guid collectionId, string slideId, Guid cellCountId) =>
    [
        $"/collections?slideId={slideId}",
        $"/collections/{collectionId}/membership",
        $"/annotations?collectionId={collectionId}",
        $"/annotations?collectionId={collectionId}&skip=0&take=10&search=a",
        $"/annotations/total?collectionId={collectionId}",
        $"/annotations/facets?collectionId={collectionId}",
        $"/cellcounts?collectionId={collectionId}",
        $"/cellcounts/total?collectionId={collectionId}",
        $"/cellcounts/facets?collectionId={collectionId}",
        $"/cellcounts/{cellCountId}",
        $"/annotationgroups?collectionId={collectionId}",
    ];

    private async Task<List<CollectionMember>> MembersAsync()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
        return await db.CollectionMembers.AsNoTracking().ToListAsync();
    }

    [Fact]
    public async Task AGuest_ReadsEverythingInTheirSession()
    {
        var seeded = await SeedAsync();
        var guest = Guest(seeded.SessionId);
        var id = seeded.SessionId;

        var annotations = (await guest.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={id}", Json))!;
        Assert.Equal([seeded.AnnotationId], annotations.Select(a => a.Id));
        Assert.Equal(1, await guest.GetFromJsonAsync<int>($"/annotations/total?collectionId={id}", Json));
        var facets = (await guest.GetFromJsonAsync<SavedFacets>($"/annotations/facets?collectionId={id}", Json))!;
        Assert.Equal(["alice"], facets.Authors.Select(a => a.Id));

        var counts = (await guest.GetFromJsonAsync<List<CellCountListItem>>($"/cellcounts?collectionId={id}", Json))!;
        Assert.Equal([seeded.CellCountId], counts.Select(c => c.Id));
        Assert.Equal(1, await guest.GetFromJsonAsync<int>($"/cellcounts/total?collectionId={id}", Json));
        Assert.Equal(HttpStatusCode.OK, (await guest.GetAsync($"/cellcounts/facets?collectionId={id}")).StatusCode);
        var one = (await guest.GetFromJsonAsync<CellCount>($"/cellcounts/{seeded.CellCountId}", Json))!;
        Assert.Contains("\"x\":1", one.Dots);

        var groups = (await guest.GetFromJsonAsync<List<GroupView>>($"/annotationgroups?collectionId={id}", Json))!;
        Assert.Equal([seeded.GroupId], groups.Select(g => g.Id));
    }

    [Fact]
    public async Task AGuest_SeesJustTheirSession_InTheList_AsAViewer()
    {
        var seeded = await SeedAsync();
        // Other things on the same slide a member would see - not the guest.
        var alice = As("alice");
        var personal = await TestJson.EnsureCollectionAsync(alice, seeded.SlideId);
        (await alice.PutAsJsonAsync($"/collections/{personal}/sharing", new SharingRequest(true))).EnsureSuccessStatusCode();
        var guest = Guest(seeded.SessionId);

        var list = (await guest.GetFromJsonAsync<List<CollectionView>>($"/collections?slideId={seeded.SlideId}", Json))!;

        var only = Assert.Single(list);
        Assert.Equal(seeded.SessionId, only.CollectionId);
        Assert.Equal(CollectionKind.Session, only.Kind);
        Assert.Equal(CollectionRole.Viewer, only.MyRole);
        Assert.Equal("Ki-67 review", only.CollectionName);
        Assert.Equal(["alice", "bob"], only.Members.Select(m => m.UserId));
        Assert.Equal(1, only.AnnotationCount);
        Assert.Equal(1, only.CellCountCount);
    }

    [Fact]
    public async Task AGuest_OnAnotherSlide_GetsAnEmptyList()
    {
        var seeded = await SeedAsync();

        var list = await Guest(seeded.SessionId).GetFromJsonAsync<List<CollectionView>>($"/collections?slideId={NewSlide()}", Json);

        Assert.Empty(list!);
    }

    [Fact]
    public async Task AGuest_IsAViewer_ForTheHub()
    {
        var seeded = await SeedAsync();

        var membership = (await Guest(seeded.SessionId).GetFromJsonAsync<MembershipView>(
            $"/collections/{seeded.SessionId}/membership", Json))!;

        Assert.Equal(new MembershipView(seeded.SessionId, seeded.SlideId, CollectionKind.Session, CollectionRole.Viewer, null), membership);
    }

    [Fact]
    public async Task AGuest_CantSeeAnotherSession()
    {
        var mine = await SeedAsync();
        var other = await SeedAsync();
        var guest = Guest(mine.SessionId);

        foreach (var url in Reads(other.SessionId, other.SlideId, other.CellCountId))
        {
            var response = await guest.GetAsync(url);
            if (url.StartsWith("/collections?"))
                Assert.Empty((await response.Content.ReadFromJsonAsync<List<CollectionView>>(Json))!);
            else
                Assert.True(response.StatusCode == HttpStatusCode.NotFound, $"{url} was {response.StatusCode}");
        }
    }

    [Fact]
    public async Task AGuest_CantSeeAPersonalCollection_EvenAShared_OrOneTheTokenNames()
    {
        var alice = As("alice");
        var slideId = NewSlide();
        var personal = await TestJson.EnsureCollectionAsync(alice, slideId);
        (await alice.PutAsJsonAsync($"/collections/{personal}/sharing", new SharingRequest(true))).EnsureSuccessStatusCode();
        var cellCount = await (await alice.PostAsJsonAsync("/cellcounts", new CellCount { CollectionId = personal, Label = "c", Dots = "[]" }))
            .Content.ReadFromJsonAsync<CellCount>(Json);
        // Anyone signed in can read it - a guest still can't, even with it
        // in their token.
        Assert.Equal(HttpStatusCode.OK, (await As("bob").GetAsync($"/annotations?collectionId={personal}")).StatusCode);
        var guest = Guest(personal);

        foreach (var url in Reads(personal, slideId, cellCount!.Id))
        {
            var response = await guest.GetAsync(url);
            if (url.StartsWith("/collections?"))
                Assert.Empty((await response.Content.ReadFromJsonAsync<List<CollectionView>>(Json))!);
            else
                Assert.True(response.StatusCode == HttpStatusCode.NotFound, $"{url} was {response.StatusCode}");
        }
    }

    [Fact]
    public async Task AGuest_ForASessionThatsGone_GetsNotFound()
    {
        var guest = Guest(Guid.NewGuid());

        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync($"/annotations?collectionId={Guid.NewGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await guest.GetAsync($"/cellcounts/{Guid.NewGuid()}")).StatusCode);
    }

    [Fact]
    public async Task AnEndedSession_CanStillBeReadByAGuest()
    {
        var seeded = await SeedAsync();
        (await As("alice").PostAsync($"/collections/{seeded.SessionId}/end", null)).EnsureSuccessStatusCode();
        var guest = Guest(seeded.SessionId);

        foreach (var url in Reads(seeded.SessionId, seeded.SlideId, seeded.CellCountId))
            Assert.True((await guest.GetAsync(url)).StatusCode == HttpStatusCode.OK, url);
        var membership = (await guest.GetFromJsonAsync<MembershipView>($"/collections/{seeded.SessionId}/membership", Json))!;
        Assert.NotNull(membership.Ended);
    }

    [Fact]
    public async Task AGuest_CantWriteAnything_OrReadAnythingElse()
    {
        var seeded = await SeedAsync();
        var guest = Guest(seeded.SessionId);
        var id = seeded.SessionId;
        var body = new Dictionary<string, object> { ["collectionId"] = id, ["label"] = "x", ["ids"] = new[] { seeded.AnnotationId } };

        (HttpMethod Method, string Url)[] refused =
        [
            (HttpMethod.Post, "/annotations"),
            (HttpMethod.Put, $"/annotations/{seeded.AnnotationId}"),
            (HttpMethod.Delete, $"/annotations/{seeded.AnnotationId}"),
            (HttpMethod.Put, "/annotations/bulk"),
            (HttpMethod.Post, "/annotations/bulk-delete"),
            (HttpMethod.Post, "/cellcounts"),
            (HttpMethod.Put, $"/cellcounts/{seeded.CellCountId}"),
            (HttpMethod.Delete, $"/cellcounts/{seeded.CellCountId}"),
            (HttpMethod.Post, "/annotationgroups"),
            (HttpMethod.Put, $"/annotationgroups/{seeded.GroupId}"),
            (HttpMethod.Delete, $"/annotationgroups/{seeded.GroupId}"),
            (HttpMethod.Post, $"/annotationgroups/{seeded.GroupId}/merge"),
            (HttpMethod.Get, $"/imageadjustments?collectionId={id}"),
            (HttpMethod.Post, "/imageadjustments"),
            (HttpMethod.Put, $"/imageadjustments/{seeded.AdjustmentId}"),
            (HttpMethod.Delete, $"/imageadjustments/{seeded.AdjustmentId}"),
            (HttpMethod.Get, $"/collections/{id}"),
            (HttpMethod.Get, $"/collections/{id}/export"),
            (HttpMethod.Post, "/collections/ensure"),
            (HttpMethod.Post, "/collections"),
            (HttpMethod.Post, "/sessions"),
            (HttpMethod.Put, $"/collections/{id}"),
            (HttpMethod.Put, $"/collections/{id}/sharing"),
            (HttpMethod.Post, $"/collections/{id}/import"),
            (HttpMethod.Delete, $"/collections/{id}"),
            (HttpMethod.Post, $"/collections/{id}/end"),
            (HttpMethod.Put, $"/collections/{id}/members/bob"),
            (HttpMethod.Delete, $"/collections/{id}/members/bob"),
            (HttpMethod.Post, $"/collections/{id}/invites"),
            (HttpMethod.Get, $"/collections/{id}/invites"),
            (HttpMethod.Put, $"/collections/{id}/invites/{seeded.InviteCode}"),
            (HttpMethod.Delete, $"/collections/{id}/invites/{seeded.InviteCode}"),
            (HttpMethod.Get, $"/invites/{seeded.InviteCode}"),
            (HttpMethod.Post, $"/invites/{seeded.InviteCode}/accept"),
        ];

        foreach (var (method, url) in refused)
        {
            using var request = new HttpRequestMessage(method, url);
            if (method != HttpMethod.Get && method != HttpMethod.Delete) request.Content = JsonContent.Create(body);
            var response = await guest.SendAsync(request);
            Assert.True(response.StatusCode == HttpStatusCode.Unauthorized, $"{method} {url} was {response.StatusCode}");
        }

        // And nothing changed.
        var alice = As("alice");
        Assert.Single((await alice.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={id}", Json))!);
        Assert.Single((await alice.GetFromJsonAsync<List<CellCountListItem>>($"/cellcounts?collectionId={id}", Json))!);
        Assert.Single((await alice.GetFromJsonAsync<List<GroupView>>($"/annotationgroups?collectionId={id}", Json))!);
        var session = Assert.Single((await alice.GetFromJsonAsync<List<CollectionView>>($"/collections?slideId={seeded.SlideId}", Json))!);
        Assert.Null(session.Ended);
        Assert.Equal(["alice", "bob"], session.Members.Select(m => m.UserId));
        Assert.Equal("open", (await alice.GetFromJsonAsync<InvitePreview>($"/invites/{seeded.InviteCode}", Json))!.Status);
    }

    [Fact]
    public async Task AGuestReading_NeverAddsAMember()
    {
        var seeded = await SeedAsync();
        var guestId = GuestTokens.NewGuestId();
        var guest = Guest(seeded.SessionId, guestId);
        var before = await MembersAsync();

        foreach (var url in Reads(seeded.SessionId, seeded.SlideId, seeded.CellCountId))
            Assert.True((await guest.GetAsync(url)).IsSuccessStatusCode, url);

        var after = await MembersAsync();
        Assert.Equal(before.Count, after.Count);
        Assert.DoesNotContain(after, m => m.UserId == guestId || m.UserId.StartsWith(GuestAuth.IdPrefix));
    }

    public static TheoryData<string> BadTokens => new()
    {
        "expired",
        "wrong key",
        "wrong issuer",
        "wrong audience",
        "not a guest id",
        "no session",
        "has a name",
        "not a token",
    };

    [Theory]
    [MemberData(nameof(BadTokens))]
    public async Task ABadToken_IsTurnedDown(string what)
    {
        var seeded = await SeedAsync();
        var key = GuestTokens.Key(_factory);
        var id = seeded.SessionId;
        var token = what switch
        {
            "expired" => GuestTokens.Make(key, id, expires: DateTime.UtcNow.AddMinutes(-5)),
            "wrong key" => GuestTokens.Make(Convert.ToBase64String(new byte[32]), id),
            "wrong issuer" => GuestTokens.Make(key, id, issuer: "someone-else"),
            "wrong audience" => GuestTokens.Make(key, id, audience: "diss-api"),
            "not a guest id" => GuestTokens.Make(key, id, guestId: "alice"),
            "no session" => GuestTokens.Make(key, id, sessionClaim: "not-a-guid"),
            "has a name" => GuestTokens.Make(key, id, extraClaims: new Dictionary<string, object> { ["name"] = "Someone" }),
            _ => "not.a.token",
        };
        var client = WithToken(token);

        foreach (var url in Reads(id, seeded.SlideId, seeded.CellCountId))
            Assert.True((await client.GetAsync(url)).StatusCode == HttpStatusCode.Unauthorized, $"{what}: {url}");
    }

    [Fact]
    public async Task SignedInPeople_StillReadTheSameWay()
    {
        var seeded = await SeedAsync();

        foreach (var url in Reads(seeded.SessionId, seeded.SlideId, seeded.CellCountId))
        {
            Assert.True((await As("bob").GetAsync(url)).StatusCode == HttpStatusCode.OK, $"bob: {url}");
            var stranger = await As("carol").GetAsync(url);
            if (url.StartsWith("/collections?"))
                Assert.Empty((await stranger.Content.ReadFromJsonAsync<List<CollectionView>>(Json))!);
            else
                Assert.True(stranger.StatusCode == HttpStatusCode.NotFound, $"carol: {url} was {stranger.StatusCode}");
        }
        var bobs = (await As("bob").GetFromJsonAsync<MembershipView>($"/collections/{seeded.SessionId}/membership", Json))!;
        Assert.Equal(CollectionRole.Editor, bobs.Role);
    }

    private async Task SetInviteAsync(string code, Action<CollectionInvite> change)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
        change(await db.CollectionInvites.FirstAsync(i => i.Code == code));
        await db.SaveChangesAsync();
    }

    private Task<GuestInvitePreview?> GuestPreviewAsync(string code) =>
        // No sign-in at all - a junk token so the tests' stand-in for
        // Keycloak doesn't sign it in as someone.
        WithToken("not.a.token").GetFromJsonAsync<GuestInvitePreview>($"/invites/{code}/guest", Json);

    [Fact]
    public async Task GuestPreview_ShowsWhatTheLinkIsFor_WithoutSigningIn()
    {
        var seeded = await SeedAsync();

        var response = await WithToken("not.a.token").GetAsync($"/invites/{seeded.InviteCode}/guest");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var raw = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(
            ["collectionId", "slideId", "collectionName", "hostName", "status", "expires"],
            raw.EnumerateObject().Select(p => p.Name));
        var preview = raw.Deserialize<GuestInvitePreview>(Json)!;
        Assert.Equal(seeded.SessionId, preview.CollectionId);
        Assert.Equal(seeded.SlideId, preview.SlideId);
        Assert.Equal("Ki-67 review", preview.CollectionName);
        Assert.Equal("User alice", preview.HostName);
        Assert.Equal("open", preview.Status);
        Assert.True(preview.Expires > DateTimeOffset.UtcNow.AddHours(23));
    }

    [Fact]
    public async Task GuestPreview_SaysWhenALinkHasExpired()
    {
        var seeded = await SeedAsync();
        await SetInviteAsync(seeded.InviteCode, i => i.Expires = DateTimeOffset.UtcNow.AddMinutes(-1));

        Assert.Equal("expired", (await GuestPreviewAsync(seeded.InviteCode))!.Status);
    }

    [Fact]
    public async Task GuestPreview_SaysWhenALinkWasStopped()
    {
        var seeded = await SeedAsync();
        (await As("alice").DeleteAsync($"/collections/{seeded.SessionId}/invites/{seeded.InviteCode}")).EnsureSuccessStatusCode();

        Assert.Equal("stopped", (await GuestPreviewAsync(seeded.InviteCode))!.Status);
    }

    [Fact]
    public async Task GuestPreview_SaysWhenTheSessionHasEnded()
    {
        var seeded = await SeedAsync();
        (await As("alice").PostAsync($"/collections/{seeded.SessionId}/end", null)).EnsureSuccessStatusCode();

        Assert.Equal("ended", (await GuestPreviewAsync(seeded.InviteCode))!.Status);
    }

    [Fact]
    public async Task GuestPreview_ForAnUnknownCode_IsNotFound()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await WithToken("not.a.token").GetAsync("/invites/nope/guest")).StatusCode);
    }
}
