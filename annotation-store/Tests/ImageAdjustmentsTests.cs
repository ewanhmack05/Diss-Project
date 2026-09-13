using System.Net;
using System.Net.Http.Json;
using AnnotationStore.Annotations;
using AnnotationStore.Collections;
using AnnotationStore.ImageAdjustments;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AnnotationStore.Tests;

public class ImageAdjustmentsTests : IClassFixture<CellCountApiFactory>
{
    private const string SampleAdjustments =
        """{"brightness":0.2,"contrast":-0.1,"gamma":1.4,"red":1.1,"green":0.9,"blue":1.0}""";

    private readonly CellCountApiFactory _factory;

    public ImageAdjustmentsTests(CellCountApiFactory factory)
    {
        _factory = factory;
    }

    private static async Task<Guid> CreateCollectionAsync(HttpClient client, string slideId)
    {
        var response = await client.PostAsJsonAsync(
            "/collections/ensure",
            new Collections.Collections { SlideId = slideId, UserId = "001" });
        response.EnsureSuccessStatusCode();
        var created = await response.Content.ReadFromJsonAsync<Collections.Collections>();
        return created!.CollectionId;
    }

    private static ImageAdjustments.ImageAdjustments NewImageAdjustment(Guid collectionId, string name = "preset") => new()
    {
        CollectionId = collectionId,
        AdjustmentName = name,
        Adjustments = SampleAdjustments,
    };

    [Fact]
    public async Task Post_PersistsAndReturnsGeneratedIdAndCreated()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();
        var collectionId = await CreateCollectionAsync(client, slideId);
        var payload = NewImageAdjustment(collectionId);

        var response = await client.PostAsJsonAsync("/imageadjustments", payload);
        response.EnsureSuccessStatusCode();

        var created = await response.Content.ReadFromJsonAsync<ImageAdjustments.ImageAdjustments>();
        Assert.NotNull(created);
        Assert.NotEqual(Guid.Empty, created!.ImageAdjustmentId);
        Assert.NotEqual(default, created.Created);
        Assert.Equal(slideId, created.SlideId);
        Assert.Equal(collectionId, created.CollectionId);
        Assert.Equal("preset", created.AdjustmentName);
        Assert.Equal(SampleAdjustments, created.Adjustments);
    }

    [Fact]
    public async Task Post_DerivesSlideIdFromCollection_IgnoringAnyClientValue()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();
        var collectionId = await CreateCollectionAsync(client, slideId);
        var payload = NewImageAdjustment(collectionId);
        payload.SlideId = "not-the-real-slide";

        var response = await client.PostAsJsonAsync("/imageadjustments", payload);
        response.EnsureSuccessStatusCode();

        var created = await response.Content.ReadFromJsonAsync<ImageAdjustments.ImageAdjustments>();
        Assert.Equal(slideId, created!.SlideId);
    }

    [Fact]
    public async Task Post_WithUnknownCollectionId_ReturnsNotFound()
    {
        var client = _factory.CreateClient();
        var payload = NewImageAdjustment(Guid.NewGuid());

        var response = await client.PostAsJsonAsync("/imageadjustments", payload);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Get_FiltersByCollectionId()
    {
        var client = _factory.CreateClient();
        var collectionIdA = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        var collectionIdB = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        await client.PostAsJsonAsync("/imageadjustments", NewImageAdjustment(collectionIdA, "a-preset"));
        await client.PostAsJsonAsync("/imageadjustments", NewImageAdjustment(collectionIdB, "b-preset"));

        var response = await client.GetAsync($"/imageadjustments?collectionId={collectionIdA}");
        response.EnsureSuccessStatusCode();

        var adjustments = await response.Content.ReadFromJsonAsync<List<ImageAdjustments.ImageAdjustments>>();
        Assert.NotNull(adjustments);
        var onlyResult = Assert.Single(adjustments!);
        Assert.Equal("a-preset", onlyResult.AdjustmentName);
    }

    [Fact]
    public async Task Put_UpdatesNameAndAdjustments_LeavesCollectionIdSlideIdAndCreatedFixed()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();
        var collectionId = await CreateCollectionAsync(client, slideId);
        var postResponse = await client.PostAsJsonAsync("/imageadjustments", NewImageAdjustment(collectionId));
        var created = await postResponse.Content.ReadFromJsonAsync<ImageAdjustments.ImageAdjustments>();

        const string updatedAdjustments = """{"brightness":0.5,"contrast":0.3,"gamma":1.0,"red":1.0,"green":1.0,"blue":1.0}""";
        var update = NewImageAdjustment(Guid.NewGuid(), "renamed");
        update.Adjustments = updatedAdjustments;

        var putResponse = await client.PutAsJsonAsync($"/imageadjustments/{created!.ImageAdjustmentId}", update);
        putResponse.EnsureSuccessStatusCode();

        var updated = await putResponse.Content.ReadFromJsonAsync<ImageAdjustments.ImageAdjustments>();
        Assert.NotNull(updated);
        Assert.Equal("renamed", updated!.AdjustmentName);
        Assert.Equal(updatedAdjustments, updated.Adjustments);
        Assert.Equal(created.ImageAdjustmentId, updated.ImageAdjustmentId);
        Assert.Equal(collectionId, updated.CollectionId);
        Assert.Equal(slideId, updated.SlideId);
        Assert.Equal(created.Created, updated.Created);
    }

    [Fact]
    public async Task Put_OnNonexistentId_ReturnsNotFound()
    {
        var client = _factory.CreateClient();
        var update = NewImageAdjustment(Guid.NewGuid());

        var response = await client.PutAsJsonAsync($"/imageadjustments/{Guid.NewGuid()}", update);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_RemovesIt_AndSubsequentGetNoLongerReturnsIt()
    {
        var client = _factory.CreateClient();
        var collectionId = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        var postResponse = await client.PostAsJsonAsync("/imageadjustments", NewImageAdjustment(collectionId));
        var created = await postResponse.Content.ReadFromJsonAsync<ImageAdjustments.ImageAdjustments>();

        var deleteResponse = await client.DeleteAsync($"/imageadjustments/{created!.ImageAdjustmentId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var getResponse = await client.GetAsync($"/imageadjustments?collectionId={collectionId}");
        var remaining = await getResponse.Content.ReadFromJsonAsync<List<ImageAdjustments.ImageAdjustments>>();
        Assert.Empty(remaining!);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
        Assert.False(await db.ImageAdjustments.AnyAsync(a => a.ImageAdjustmentId == created.ImageAdjustmentId));
    }

    [Fact]
    public async Task Delete_OnNonexistentId_ReturnsNotFound()
    {
        var client = _factory.CreateClient();

        var response = await client.DeleteAsync($"/imageadjustments/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Post_PassesUserIdThroughUnmodified()
    {
        var client = _factory.CreateClient();
        var collectionId = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        var payload = NewImageAdjustment(collectionId);
        payload.UserId = "whoever-was-signed-in";

        var response = await client.PostAsJsonAsync("/imageadjustments", payload);
        response.EnsureSuccessStatusCode();

        var created = await response.Content.ReadFromJsonAsync<ImageAdjustments.ImageAdjustments>();
        Assert.Equal("whoever-was-signed-in", created!.UserId);
    }

    [Fact]
    public async Task Post_WithoutUserId_DefaultsToEmptyString()
    {
        var client = _factory.CreateClient();
        var collectionId = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        var payload = NewImageAdjustment(collectionId);

        var response = await client.PostAsJsonAsync("/imageadjustments", payload);
        response.EnsureSuccessStatusCode();

        var created = await response.Content.ReadFromJsonAsync<ImageAdjustments.ImageAdjustments>();
        Assert.Equal("", created!.UserId);
    }

    [Fact]
    public async Task Adjustments_RoundTripsExactJsonTextUnmodified()
    {
        var client = _factory.CreateClient();
        var collectionId = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        var payload = NewImageAdjustment(collectionId);
        payload.Adjustments = SampleAdjustments;

        await client.PostAsJsonAsync("/imageadjustments", payload);

        var response = await client.GetAsync($"/imageadjustments?collectionId={collectionId}");
        var adjustments = await response.Content.ReadFromJsonAsync<List<ImageAdjustments.ImageAdjustments>>();
        var onlyResult = Assert.Single(adjustments!);
        Assert.Equal(SampleAdjustments, onlyResult.Adjustments);
    }
}
