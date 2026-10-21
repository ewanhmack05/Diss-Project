using System.Net;
using System.Net.Http.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AnnotationStore.Tests;

public class CollectionsTests : IClassFixture<CellCountApiFactory>
{
    private static readonly System.Text.Json.JsonSerializerOptions Json = TestJson.Options;

    private readonly CellCountApiFactory _factory;

    public CollectionsTests(CellCountApiFactory factory)
    {
        _factory = factory;
    }

    private HttpClient As(string userId, string? name = null) => TestAuthHandler.As(_factory.CreateClient(), userId, name);

    private static string NewSlide() => Guid.NewGuid().ToString();

    private static async Task<CollectionView> EnsureAsync(HttpClient client, string slideId)
    {
        var response = await client.PostAsJsonAsync("/collections/ensure", new EnsureRequest(slideId));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CollectionView>(Json))!;
    }

    private static async Task<List<CollectionView>> ListAsync(HttpClient client, string slideId) =>
        (await client.GetFromJsonAsync<List<CollectionView>>($"/collections?slideId={slideId}", Json))!;

    [Fact]
    public async Task Ensure_CreatesTheCallersOwn_WithThemAsOwner()
    {
        var alice = As("alice", "Alice Moore");
        var slideId = NewSlide();

        var response = await alice.PostAsJsonAsync("/collections/ensure", new EnsureRequest(slideId));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = (await response.Content.ReadFromJsonAsync<CollectionView>(Json))!;

        Assert.Equal(slideId, created.SlideId);
        Assert.Equal("alice", created.OwnerId);
        Assert.Equal(CollectionRole.Owner, created.MyRole);
        Assert.Equal(CollectionKind.Personal, created.Kind);
        Assert.Equal("Alice Moore's collection", created.CollectionName);
        var member = Assert.Single(created.Members);
        Assert.Equal(new MemberView("alice", "Alice Moore", CollectionRole.Owner), member);
    }

    [Fact]
    public async Task Ensure_CalledTwice_ReturnsTheSameCollection()
    {
        var alice = As("alice");
        var slideId = NewSlide();

        var first = await EnsureAsync(alice, slideId);
        var second = await alice.PostAsJsonAsync("/collections/ensure", new EnsureRequest(slideId));

        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal(first.CollectionId, (await second.Content.ReadFromJsonAsync<CollectionView>(Json))!.CollectionId);
    }

    // What the viewer does on its first load of a slide - React can run the
    // ensure twice at once, and neither finds a collection to hand back.
    [PostgresFact]
    public async Task EnsuresAtTheSameMoment_AllGetTheOneCollection()
    {
        var alice = As("alice");
        var slideId = NewSlide();

        var responses = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ =>
            alice.PostAsJsonAsync("/collections/ensure", new EnsureRequest(slideId))));

        Assert.All(responses, r => Assert.True(r.IsSuccessStatusCode, $"Got {(int)r.StatusCode}"));
        var ids = await Task.WhenAll(responses.Select(async r => (await r.Content.ReadFromJsonAsync<CollectionView>(Json))!.CollectionId));
        Assert.Single(ids.Distinct());
        Assert.Single(await ListAsync(alice, slideId));
    }

    [Fact]
    public async Task Ensure_IgnoresAnyUserInTheBody()
    {
        var alice = As("alice");
        var response = await alice.PostAsJsonAsync("/collections/ensure", new { slideId = NewSlide(), userId = "someone-else" });

        var created = (await response.Content.ReadFromJsonAsync<CollectionView>(Json))!;
        Assert.Equal("alice", created.OwnerId);
    }

    [Fact]
    public async Task Ensure_KeepsTheOwnersNameUpToDate()
    {
        var slideId = NewSlide();
        await EnsureAsync(As("alice", "Alice"), slideId);

        var renamed = await EnsureAsync(As("alice", "Alice Moore"), slideId);

        Assert.Equal("Alice Moore", Assert.Single(renamed.Members).DisplayName);
    }

    [Fact]
    public async Task Post_Twice_ForTheSameSlide_ReturnsConflict()
    {
        var alice = As("alice");
        var slideId = NewSlide();
        (await alice.PostAsJsonAsync("/collections", new EnsureRequest(slideId))).EnsureSuccessStatusCode();

        var response = await alice.PostAsJsonAsync("/collections", new EnsureRequest(slideId));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task EachUser_GetsTheirOwn_OnTheSameSlide()
    {
        var slideId = NewSlide();
        var alices = await EnsureAsync(As("alice"), slideId);
        var bobs = await EnsureAsync(As("bob"), slideId);

        Assert.NotEqual(alices.CollectionId, bobs.CollectionId);
        Assert.Equal(alices.CollectionId, Assert.Single(await ListAsync(As("alice"), slideId)).CollectionId);
    }

    [Fact]
    public async Task GetById_ReturnsEverythingInIt_ToMembers()
    {
        var alice = As("alice");
        var collection = await EnsureAsync(alice, NewSlide());
        var id = collection.CollectionId;
        await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "a" });
        await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "b" });
        await alice.PostAsJsonAsync(
            "/cellcounts",
            new CellCount { CollectionId = id, Label = "c", Dots = "[]", RegionOfInterest = new RegionOfInterest { GeoJson = "{}" } });
        await alice.PostAsJsonAsync(
            "/imageadjustments",
            new ImageAdjustments.ImageAdjustments { CollectionId = id, AdjustmentName = "p", Adjustments = "{}" });

        var hydrated = (await alice.GetFromJsonAsync<Collections.Collections>($"/collections/{id}", Json))!;

        Assert.Equal(2, hydrated.Annotations.Count);
        Assert.Single(hydrated.CellCounts);
        Assert.NotNull(hydrated.CellCounts[0].RegionOfInterest);
        Assert.Single(hydrated.ImageAdjustments);
        Assert.Equal(HttpStatusCode.NotFound, (await As("bob").GetAsync($"/collections/{id}")).StatusCode);
    }

    [Fact]
    public async Task PersonalCollections_CantTakeInvitesOrMembers()
    {
        var alice = As("alice");
        var collection = await EnsureAsync(alice, NewSlide());

        var invite = await alice.PostAsJsonAsync($"/collections/{collection.CollectionId}/invites",
            new InviteRequest(CollectionRole.Editor, 24), Json);
        var member = await alice.PutAsJsonAsync($"/collections/{collection.CollectionId}/members/bob",
            new MemberRequest("Bob", CollectionRole.Editor), Json);

        Assert.Equal(HttpStatusCode.BadRequest, invite.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, member.StatusCode);
    }

    [Fact]
    public async Task Put_RenamesIt()
    {
        var alice = As("alice");
        var created = await EnsureAsync(alice, NewSlide());

        var response = await alice.PutAsJsonAsync($"/collections/{created.CollectionId}", new RenameRequest("renamed"));
        response.EnsureSuccessStatusCode();

        var updated = (await response.Content.ReadFromJsonAsync<CollectionView>(Json))!;
        Assert.Equal("renamed", updated.CollectionName);
        Assert.Equal(created.SlideId, updated.SlideId);
    }

    [Fact]
    public async Task Put_OnNonexistentId_ReturnsNotFound()
    {
        var response = await As("alice").PutAsJsonAsync($"/collections/{Guid.NewGuid()}", new RenameRequest("x"));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_OnNonexistentId_ReturnsNotFound()
    {
        var response = await As("alice").DeleteAsync($"/collections/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_HidesItAndEverythingInIt_WithoutRemovingAnyRows()
    {
        var alice = As("alice");
        var collection = await EnsureAsync(alice, NewSlide());
        var id = collection.CollectionId;

        var annotation = await (await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "a" }))
            .Content.ReadFromJsonAsync<Annotation>();
        var cellCount = await (await alice.PostAsJsonAsync("/cellcounts", new CellCount { CollectionId = id, Label = "c", Dots = "[]" }))
            .Content.ReadFromJsonAsync<CellCount>();
        var adjustment = await (await alice.PostAsJsonAsync(
                "/imageadjustments", new ImageAdjustments.ImageAdjustments { CollectionId = id, AdjustmentName = "p", Adjustments = "{}" }))
            .Content.ReadFromJsonAsync<ImageAdjustments.ImageAdjustments>();

        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/collections/{id}")).StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/annotations?collectionId={id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/collections/{id}")).StatusCode);
        Assert.DoesNotContain(await ListAsync(alice, collection.SlideId), c => c.CollectionId == id);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
        Assert.True(await db.Collections.IgnoreQueryFilters().AnyAsync(c => c.CollectionId == id && c.Deleted != null));
        Assert.True(await db.Annotations.AnyAsync(a => a.Id == annotation!.Id));
        Assert.True(await db.CellCounts.AnyAsync(c => c.Id == cellCount!.Id));
        Assert.True(await db.ImageAdjustments.AnyAsync(a => a.ImageAdjustmentId == adjustment!.ImageAdjustmentId));
        Assert.True(await db.CollectionMembers.AnyAsync(m => m.CollectionId == id));
    }

    private static Task<HttpResponseMessage> ShareAsync(HttpClient client, Guid id, bool shared) =>
        client.PutAsJsonAsync($"/collections/{id}/sharing", new SharingRequest(shared), Json);

    [Fact]
    public async Task Sharing_LetsOthersRead_ButNotChange()
    {
        var alice = As("alice", "Alice Moore");
        var bob = As("bob");
        var slideId = NewSlide();
        var collection = await EnsureAsync(alice, slideId);
        var id = collection.CollectionId;
        await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "a" });

        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/annotations?collectionId={id}")).StatusCode);

        var shared = await ShareAsync(alice, id, true);
        Assert.Equal(HttpStatusCode.OK, shared.StatusCode);
        Assert.True((await shared.Content.ReadFromJsonAsync<CollectionView>(Json))!.Shared);

        var annotations = (await bob.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={id}", Json))!;
        Assert.Equal("a", Assert.Single(annotations).Label);
        Assert.Equal(HttpStatusCode.OK, (await bob.GetAsync($"/collections/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await bob.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "b" })).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.PutAsJsonAsync($"/collections/{id}", new RenameRequest("x"))).StatusCode);

        await ShareAsync(alice, id, false);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/annotations?collectionId={id}")).StatusCode);
    }

    [Fact]
    public async Task List_IncludesOthersShared_AsViewer_WithCounts()
    {
        var alice = As("alice", "Alice Moore");
        var bob = As("bob");
        var slideId = NewSlide();
        var alices = await EnsureAsync(alice, slideId);
        await EnsureAsync(bob, slideId);
        await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = alices.CollectionId, Label = "a" });
        await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = alices.CollectionId, Label = "b" });
        await alice.PostAsJsonAsync("/cellcounts", new CellCount { CollectionId = alices.CollectionId, Label = "c", Dots = "[]" });

        Assert.Single(await ListAsync(bob, slideId));
        await ShareAsync(alice, alices.CollectionId, true);

        var list = await ListAsync(bob, slideId);
        Assert.Equal(2, list.Count);
        Assert.Equal("bob", list[0].OwnerId);
        var theirs = list[1];
        Assert.Equal(alices.CollectionId, theirs.CollectionId);
        Assert.Equal(CollectionRole.Viewer, theirs.MyRole);
        Assert.Equal(2, theirs.AnnotationCount);
        Assert.Equal(1, theirs.CellCountCount);
        Assert.NotNull(theirs.LastAdded);
        Assert.Empty(await ListAsync(As("carol"), NewSlide()));
    }

    [Fact]
    public async Task Sharing_IsOwnerOnly_AndPersonalOnly()
    {
        var alice = As("alice");
        var slideId = NewSlide();
        var collection = await EnsureAsync(alice, slideId);
        var session = (await (await alice.PostAsJsonAsync("/sessions", new EnsureRequest(slideId)))
            .Content.ReadFromJsonAsync<CollectionView>(Json))!;

        Assert.Equal(HttpStatusCode.NotFound, (await ShareAsync(As("bob"), collection.CollectionId, true)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ShareAsync(alice, session.CollectionId, true)).StatusCode);
    }

    [Fact]
    public async Task Import_SavesEverythingAtOnce_StampedAsTheCaller()
    {
        var alice = As("alice", "Alice Moore");
        var slideId = NewSlide();
        var collection = await EnsureAsync(alice, slideId);
        var id = collection.CollectionId;

        var response = await alice.PostAsJsonAsync($"/collections/{id}/import", new ImportRequest(
            [new Annotation { Label = "a", GeoJson = "{}" }, new Annotation { Label = "b", GeoJson = "{}" }],
            [new CellCount { Label = "c", Dots = "[{\"x\":1,\"y\":2,\"colour\":\"#ff0000\"}]", Count = 1,
                RegionOfInterest = new RegionOfInterest { GeoJson = "{}" } }]), Json);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<ImportResult>(Json))!;
        Assert.Equal(2, result.Annotations.Count);
        Assert.All(result.Annotations, a =>
        {
            Assert.Equal(id, a.CollectionId);
            Assert.Equal(slideId, a.SlideId);
            Assert.Equal("alice", a.CreatedById);
        });
        var count = Assert.Single(result.CellCounts);
        Assert.NotNull(count.RegionOfInterest);
        Assert.Equal(2, (await alice.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={id}", Json))!.Count);
    }

    [Fact]
    public async Task Export_HasAnnotationsAndCountsWithDots_ToAnyoneWhoCanView()
    {
        var alice = As("alice");
        var collection = await EnsureAsync(alice, NewSlide());
        var id = collection.CollectionId;
        await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "a" });
        await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "b" });
        await alice.PostAsJsonAsync("/cellcounts", new CellCount
        {
            CollectionId = id,
            Label = "c",
            Dots = "[{\"x\":1,\"y\":2,\"colour\":\"#ff0000\"}]",
            RegionOfInterest = new RegionOfInterest { GeoJson = "{}" },
        });

        var export = (await alice.GetFromJsonAsync<ExportView>($"/collections/{id}/export", Json))!;

        Assert.Equal(collection.CollectionName, export.CollectionName);
        Assert.Equal(["a", "b"], export.Annotations.Select(a => a.Label));
        var count = Assert.Single(export.CellCounts);
        Assert.Contains("#ff0000", count.Dots);
        Assert.NotNull(count.RegionOfInterest);

        Assert.Equal(HttpStatusCode.NotFound, (await As("bob").GetAsync($"/collections/{id}/export")).StatusCode);
        await ShareAsync(alice, id, true);
        Assert.Equal(HttpStatusCode.OK, (await As("bob").GetAsync($"/collections/{id}/export")).StatusCode);
    }

    [Fact]
    public async Task Import_NeedsEditor()
    {
        var alice = As("alice");
        var collection = await EnsureAsync(alice, NewSlide());
        await ShareAsync(alice, collection.CollectionId, true);

        var response = await As("bob").PostAsJsonAsync($"/collections/{collection.CollectionId}/import",
            new ImportRequest([new Annotation { Label = "a" }], []), Json);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
