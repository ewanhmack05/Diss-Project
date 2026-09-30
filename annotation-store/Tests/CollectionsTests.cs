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

    private static Task<HttpResponseMessage> AddMemberAsync(
        HttpClient owner, Guid collectionId, string userId, CollectionRole role = CollectionRole.Editor) =>
        owner.PutAsJsonAsync($"/collections/{collectionId}/members/{userId}", new MemberRequest($"User {userId}", role), Json);

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
    public async Task Get_ListsWhatYoureIn_YourOwnFirst()
    {
        var slideId = NewSlide();
        var alice = As("alice");
        var bob = As("bob");
        var alices = await EnsureAsync(alice, slideId);
        var bobs = await EnsureAsync(bob, slideId);
        (await AddMemberAsync(alice, alices.CollectionId, "bob")).EnsureSuccessStatusCode();

        var bobSees = await ListAsync(bob, slideId);

        Assert.Equal([bobs.CollectionId, alices.CollectionId], bobSees.Select(c => c.CollectionId));
        Assert.Equal(CollectionRole.Owner, bobSees[0].MyRole);
        Assert.Equal(CollectionRole.Editor, bobSees[1].MyRole);
        Assert.Equal(["alice", "bob"], bobSees[1].Members.Select(m => m.UserId));
    }

    [Fact]
    public async Task AddingAMember_LetsThemReadAndWrite_ByRole()
    {
        var slideId = NewSlide();
        var alice = As("alice");
        var bob = As("bob");
        var carol = As("carol");
        var collection = await EnsureAsync(alice, slideId);
        var annotations = $"/annotations?collectionId={collection.CollectionId}";

        // Not in it yet - it may as well not exist.
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync(annotations)).StatusCode);

        (await AddMemberAsync(alice, collection.CollectionId, "bob", CollectionRole.Editor)).EnsureSuccessStatusCode();
        (await AddMemberAsync(alice, collection.CollectionId, "carol", CollectionRole.Viewer)).EnsureSuccessStatusCode();

        var post = await bob.PostAsJsonAsync("/annotations", new Annotation { CollectionId = collection.CollectionId, Label = "from bob" });
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);
        var created = (await post.Content.ReadFromJsonAsync<Annotation>())!;

        Assert.Equal(HttpStatusCode.OK, (await carol.GetAsync(annotations)).StatusCode);
        var carolPost = await carol.PostAsJsonAsync("/annotations", new Annotation { CollectionId = collection.CollectionId, Label = "x" });
        Assert.Equal(HttpStatusCode.Forbidden, carolPost.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await carol.DeleteAsync($"/annotations/{created.Id}")).StatusCode);
    }

    [Fact]
    public async Task OnlyTheOwner_ManagesMembers()
    {
        var slideId = NewSlide();
        var alice = As("alice");
        var bob = As("bob");
        var collection = await EnsureAsync(alice, slideId);
        (await AddMemberAsync(alice, collection.CollectionId, "bob")).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.Forbidden, (await AddMemberAsync(bob, collection.CollectionId, "carol")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await AddMemberAsync(alice, collection.CollectionId, "carol", CollectionRole.Owner)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await alice.DeleteAsync($"/collections/{collection.CollectionId}/members/alice")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await bob.PutAsJsonAsync($"/collections/{collection.CollectionId}", new RenameRequest("mine now"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.DeleteAsync($"/collections/{collection.CollectionId}")).StatusCode);
    }

    [Fact]
    public async Task AMember_CanLeave_AndIsThenLockedOut()
    {
        var slideId = NewSlide();
        var alice = As("alice");
        var bob = As("bob");
        var collection = await EnsureAsync(alice, slideId);
        (await AddMemberAsync(alice, collection.CollectionId, "bob")).EnsureSuccessStatusCode();

        var leave = await bob.DeleteAsync($"/collections/{collection.CollectionId}/members/bob");

        Assert.Equal(HttpStatusCode.NoContent, leave.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await bob.GetAsync($"/annotations?collectionId={collection.CollectionId}")).StatusCode);
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
    public async Task Delete_CascadesToEverythingInIt()
    {
        var alice = As("alice");
        var collection = await EnsureAsync(alice, NewSlide());
        var id = collection.CollectionId;
        (await AddMemberAsync(alice, id, "bob")).EnsureSuccessStatusCode();

        var annotation = await (await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "a" }))
            .Content.ReadFromJsonAsync<Annotation>();
        var cellCount = await (await alice.PostAsJsonAsync("/cellcounts", new CellCount { CollectionId = id, Label = "c", Dots = "[]" }))
            .Content.ReadFromJsonAsync<CellCount>();
        var adjustment = await (await alice.PostAsJsonAsync(
                "/imageadjustments", new ImageAdjustments.ImageAdjustments { CollectionId = id, AdjustmentName = "p", Adjustments = "{}" }))
            .Content.ReadFromJsonAsync<ImageAdjustments.ImageAdjustments>();

        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/collections/{id}")).StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
        Assert.False(await db.Annotations.AnyAsync(a => a.Id == annotation!.Id));
        Assert.False(await db.CellCounts.AnyAsync(c => c.Id == cellCount!.Id));
        Assert.False(await db.ImageAdjustments.AnyAsync(a => a.ImageAdjustmentId == adjustment!.ImageAdjustmentId));
        Assert.False(await db.CollectionMembers.AnyAsync(m => m.CollectionId == id));
    }
}
