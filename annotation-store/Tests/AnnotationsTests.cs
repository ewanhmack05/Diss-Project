using System.Net;
using System.Net.Http.Json;
using AnnotationStore.Annotations;
using AnnotationStore.Collections;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AnnotationStore.Tests;

public class AnnotationsTests : IClassFixture<CellCountApiFactory>
{
    private readonly CellCountApiFactory _factory;

    public AnnotationsTests(CellCountApiFactory factory)
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

    private static Annotation NewAnnotation(Guid collectionId) => new()
    {
        CollectionId = collectionId,
        Label = "test annotation",
        Notes = "notes",
        Colour = "#ff0000",
        Shape = "polygon",
        LineStyle = "solid",
        LineThickness = 2,
        GeoJson = """{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[0,0]]]},"properties":{}}""",
    };

    [Fact]
    public async Task Post_PersistsAndReturnsGeneratedIdAndCreated()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();
        var collectionId = await CreateCollectionAsync(client, slideId);

        var response = await client.PostAsJsonAsync("/annotations", NewAnnotation(collectionId));
        response.EnsureSuccessStatusCode();

        var created = await response.Content.ReadFromJsonAsync<Annotation>();
        Assert.NotNull(created);
        Assert.NotEqual(Guid.Empty, created!.Id);
        Assert.NotEqual(default, created.Created);
        Assert.Equal(collectionId, created.CollectionId);
        Assert.Equal(slideId, created.SlideId);
    }

    [Fact]
    public async Task Post_DerivesSlideIdFromCollection_IgnoringAnyClientValue()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();
        var collectionId = await CreateCollectionAsync(client, slideId);
        var payload = NewAnnotation(collectionId);
        payload.SlideId = "not-the-real-slide";

        var response = await client.PostAsJsonAsync("/annotations", payload);
        response.EnsureSuccessStatusCode();

        var created = await response.Content.ReadFromJsonAsync<Annotation>();
        Assert.Equal(slideId, created!.SlideId);
    }

    [Fact]
    public async Task Post_WithUnknownCollectionId_ReturnsNotFound()
    {
        var client = _factory.CreateClient();

        var response = await client.PostAsJsonAsync("/annotations", NewAnnotation(Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Get_FiltersByCollectionId_NotAcrossCollectionsOnTheSameSlide()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();
        var collectionIdA = await CreateCollectionAsync(client, slideId);
        var collectionIdB = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        await client.PostAsJsonAsync("/annotations", NewAnnotation(collectionIdA));
        await client.PostAsJsonAsync("/annotations", NewAnnotation(collectionIdB));

        var response = await client.GetAsync($"/annotations?collectionId={collectionIdA}");
        response.EnsureSuccessStatusCode();

        var annotations = await response.Content.ReadFromJsonAsync<List<Annotation>>();
        var onlyResult = Assert.Single(annotations!);
        Assert.Equal(collectionIdA, onlyResult.CollectionId);
    }

    [Fact]
    public async Task Put_UpdatesLabelNotesAndColour_LeavesEverythingElseFixed()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();
        var collectionId = await CreateCollectionAsync(client, slideId);
        var postResponse = await client.PostAsJsonAsync("/annotations", NewAnnotation(collectionId));
        var created = await postResponse.Content.ReadFromJsonAsync<Annotation>();

        var update = NewAnnotation(Guid.NewGuid());
        update.Label = "renamed";
        update.Notes = "new notes";
        update.Colour = "#00ff00";

        var putResponse = await client.PutAsJsonAsync($"/annotations/{created!.Id}", update);
        putResponse.EnsureSuccessStatusCode();

        var updated = await putResponse.Content.ReadFromJsonAsync<Annotation>();
        Assert.Equal("renamed", updated!.Label);
        Assert.Equal("new notes", updated.Notes);
        Assert.Equal("#00ff00", updated.Colour);
        Assert.Equal(collectionId, updated.CollectionId);
        Assert.Equal(slideId, updated.SlideId);
        Assert.Equal(created.GeoJson, updated.GeoJson);
    }

    [Fact]
    public async Task Put_OnNonexistentId_ReturnsNotFound()
    {
        var client = _factory.CreateClient();

        var response = await client.PutAsJsonAsync($"/annotations/{Guid.NewGuid()}", NewAnnotation(Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_RemovesIt_AndSubsequentGetNoLongerReturnsIt()
    {
        var client = _factory.CreateClient();
        var collectionId = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        var postResponse = await client.PostAsJsonAsync("/annotations", NewAnnotation(collectionId));
        var created = await postResponse.Content.ReadFromJsonAsync<Annotation>();

        var deleteResponse = await client.DeleteAsync($"/annotations/{created!.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
        Assert.False(await db.Annotations.AnyAsync(a => a.Id == created.Id));
    }

    [Fact]
    public async Task Delete_OnNonexistentId_ReturnsNotFound()
    {
        var client = _factory.CreateClient();

        var response = await client.DeleteAsync($"/annotations/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
