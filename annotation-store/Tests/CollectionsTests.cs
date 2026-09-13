using System.Net;
using System.Net.Http.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using AnnotationStore.ImageAdjustments;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AnnotationStore.Tests;

public class CollectionsTests : IClassFixture<CellCountApiFactory>
{
    private readonly CellCountApiFactory _factory;

    public CollectionsTests(CellCountApiFactory factory)
    {
        _factory = factory;
    }

    private static Collections.Collections NewCollection(string slideId, string userId = "001") => new()
    {
        SlideId = slideId,
        UserId = userId,
        CollectionName = "test collection",
    };

    [Fact]
    public async Task Post_PersistsAndReturnsGeneratedIdAndCreated()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();

        var response = await client.PostAsJsonAsync("/collections", NewCollection(slideId));
        response.EnsureSuccessStatusCode();

        var created = await response.Content.ReadFromJsonAsync<Collections.Collections>();
        Assert.NotNull(created);
        Assert.NotEqual(Guid.Empty, created!.CollectionId);
        Assert.NotEqual(default, created.Created);
        Assert.Equal(slideId, created.SlideId);
        Assert.Equal("001", created.UserId);
    }

    [Fact]
    public async Task Post_Twice_ForSameSlideAndUser_ReturnsConflict()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();
        await client.PostAsJsonAsync("/collections", NewCollection(slideId));

        var response = await client.PostAsJsonAsync("/collections", NewCollection(slideId));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Post_ForSameSlide_DifferentUser_Succeeds()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();
        await client.PostAsJsonAsync("/collections", NewCollection(slideId, "001"));

        var response = await client.PostAsJsonAsync("/collections", NewCollection(slideId, "002"));

        response.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Ensure_WhenNoneExists_CreatesOne()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();

        var response = await client.PostAsJsonAsync("/collections/ensure", NewCollection(slideId));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<Collections.Collections>();
        Assert.Equal(slideId, created!.SlideId);
        Assert.Equal("001", created.UserId);
    }

    [Fact]
    public async Task Ensure_CalledTwice_ReturnsTheSameCollectionBothTimes()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();

        var first = await client.PostAsJsonAsync("/collections/ensure", NewCollection(slideId));
        var firstCreated = await first.Content.ReadFromJsonAsync<Collections.Collections>();

        var second = await client.PostAsJsonAsync("/collections/ensure", NewCollection(slideId));
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        var secondReturned = await second.Content.ReadFromJsonAsync<Collections.Collections>();

        Assert.Equal(firstCreated!.CollectionId, secondReturned!.CollectionId);
    }

    [Fact]
    public async Task Ensure_WithNoNameGiven_FallsBackToAGeneratedName()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();

        var response = await client.PostAsJsonAsync(
            "/collections/ensure",
            new Collections.Collections { SlideId = slideId, UserId = "001" });

        var created = await response.Content.ReadFromJsonAsync<Collections.Collections>();
        Assert.False(string.IsNullOrWhiteSpace(created!.CollectionName));
    }

    [Fact]
    public async Task Get_ReturnsAnnotationsCellCountsAndImageAdjustmentsNested()
    {
        var client = _factory.CreateClient();
        var postResponse = await client.PostAsJsonAsync("/collections", NewCollection(Guid.NewGuid().ToString()));
        var collection = await postResponse.Content.ReadFromJsonAsync<Collections.Collections>();
        var collectionId = collection!.CollectionId;

        await client.PostAsJsonAsync("/annotations", new Annotation { CollectionId = collectionId, Label = "a" });
        await client.PostAsJsonAsync("/annotations", new Annotation { CollectionId = collectionId, Label = "b" });
        await client.PostAsJsonAsync(
            "/cellcounts",
            new CellCount { CollectionId = collectionId, Label = "c", Dots = "[]", RegionOfInterest = new RegionOfInterest { GeoJson = "{}" } });
        await client.PostAsJsonAsync(
            "/imageadjustments",
            new ImageAdjustments.ImageAdjustments { CollectionId = collectionId, AdjustmentName = "p", Adjustments = "{}" });

        var response = await client.GetAsync($"/collections?slideId={collection.SlideId}&userId={collection.UserId}");
        response.EnsureSuccessStatusCode();

        var collections = await response.Content.ReadFromJsonAsync<List<Collections.Collections>>();
        var hydrated = Assert.Single(collections!);
        Assert.Equal(2, hydrated.Annotations.Count);
        Assert.Single(hydrated.CellCounts);
        Assert.NotNull(hydrated.CellCounts[0].RegionOfInterest);
        Assert.Single(hydrated.ImageAdjustments);
    }

    [Fact]
    public async Task Post_AndEnsure_DoNotEagerLoadChildren()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();
        var postResponse = await client.PostAsJsonAsync("/collections", NewCollection(slideId));
        var collection = await postResponse.Content.ReadFromJsonAsync<Collections.Collections>();
        await client.PostAsJsonAsync("/annotations", new Annotation { CollectionId = collection!.CollectionId, Label = "a" });

        var ensureResponse = await client.PostAsJsonAsync("/collections/ensure", NewCollection(slideId));
        var ensured = await ensureResponse.Content.ReadFromJsonAsync<Collections.Collections>();

        Assert.Empty(ensured!.Annotations);
    }

    [Fact]
    public async Task Get_FiltersBySlideIdAndUserId()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();
        await client.PostAsJsonAsync("/collections", NewCollection(slideId, "001"));
        await client.PostAsJsonAsync("/collections", NewCollection(slideId, "002"));

        var response = await client.GetAsync($"/collections?slideId={slideId}&userId=001");
        response.EnsureSuccessStatusCode();

        var collections = await response.Content.ReadFromJsonAsync<List<Collections.Collections>>();
        var onlyResult = Assert.Single(collections!);
        Assert.Equal("001", onlyResult.UserId);
    }

    [Fact]
    public async Task Put_RenamesIt()
    {
        var client = _factory.CreateClient();
        var postResponse = await client.PostAsJsonAsync("/collections", NewCollection(Guid.NewGuid().ToString()));
        var created = await postResponse.Content.ReadFromJsonAsync<Collections.Collections>();

        var update = NewCollection(Guid.NewGuid().ToString());
        update.CollectionName = "renamed";
        var putResponse = await client.PutAsJsonAsync($"/collections/{created!.CollectionId}", update);
        putResponse.EnsureSuccessStatusCode();

        var updated = await putResponse.Content.ReadFromJsonAsync<Collections.Collections>();
        Assert.Equal("renamed", updated!.CollectionName);
        Assert.Equal(created.SlideId, updated.SlideId);
    }

    [Fact]
    public async Task Put_OnNonexistentId_ReturnsNotFound()
    {
        var client = _factory.CreateClient();

        var response = await client.PutAsJsonAsync($"/collections/{Guid.NewGuid()}", NewCollection("x"));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_OnNonexistentId_ReturnsNotFound()
    {
        var client = _factory.CreateClient();

        var response = await client.DeleteAsync($"/collections/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_CascadesToItsAnnotationsCellCountsAndImageAdjustments()
    {
        var client = _factory.CreateClient();
        var postResponse = await client.PostAsJsonAsync("/collections", NewCollection(Guid.NewGuid().ToString()));
        var collection = await postResponse.Content.ReadFromJsonAsync<Collections.Collections>();
        var collectionId = collection!.CollectionId;

        var annotationResponse = await client.PostAsJsonAsync("/annotations", new Annotation { CollectionId = collectionId, Label = "a" });
        var annotation = await annotationResponse.Content.ReadFromJsonAsync<Annotation>();

        var cellCountResponse = await client.PostAsJsonAsync(
            "/cellcounts", new CellCount { CollectionId = collectionId, Label = "c", Dots = "[]" });
        var cellCount = await cellCountResponse.Content.ReadFromJsonAsync<CellCount>();

        var adjustmentResponse = await client.PostAsJsonAsync(
            "/imageadjustments", new ImageAdjustments.ImageAdjustments { CollectionId = collectionId, AdjustmentName = "p", Adjustments = "{}" });
        var adjustment = await adjustmentResponse.Content.ReadFromJsonAsync<ImageAdjustments.ImageAdjustments>();

        var deleteResponse = await client.DeleteAsync($"/collections/{collectionId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
        Assert.False(await db.Annotations.AnyAsync(a => a.Id == annotation!.Id));
        Assert.False(await db.CellCounts.AnyAsync(c => c.Id == cellCount!.Id));
        Assert.False(await db.ImageAdjustments.AnyAsync(a => a.ImageAdjustmentId == adjustment!.ImageAdjustmentId));
    }
}
