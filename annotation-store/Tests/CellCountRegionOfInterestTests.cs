using System.Net.Http.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AnnotationStore.Tests;

// Covers RegionOfInterest: created with a CellCount, returned on GET,
// absent when not supplied, and removed when its CellCount is deleted.
public class CellCountRegionOfInterestTests : IClassFixture<CellCountApiFactory>
{
    private const string RoiGeoJson =
        """{"type":"Polygon","coordinates":[[[0,0],[0,10],[10,10],[10,0],[0,0]]]}""";

    private readonly CellCountApiFactory _factory;

    public CellCountRegionOfInterestTests(CellCountApiFactory factory)
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

    private static CellCount NewCellCount(Guid collectionId, RegionOfInterest? roi = null) => new()
    {
        CollectionId = collectionId,
        Label = "test count",
        Dots = "[]",
        WithAnnotation = true,
        WithRoi = roi is not null,
        Count = 3,
        DotSize = 6,
        RegionOfInterest = roi,
    };

    [Fact]
    public async Task Post_WithRegionOfInterest_PersistsAndReturnsIt()
    {
        var client = _factory.CreateClient();
        var collectionId = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        var payload = NewCellCount(collectionId, new RegionOfInterest { GeoJson = RoiGeoJson });

        var response = await client.PostAsJsonAsync("/cellcounts", payload);
        response.EnsureSuccessStatusCode();

        var created = await response.Content.ReadFromJsonAsync<CellCount>();
        Assert.NotNull(created);
        Assert.NotNull(created!.RegionOfInterest);
        Assert.NotEqual(Guid.Empty, created.RegionOfInterest!.Id);
        Assert.Equal(created.Id, created.RegionOfInterest.CellCountId);
        Assert.Equal(RoiGeoJson, created.RegionOfInterest.GeoJson);
        Assert.NotEqual(default, created.RegionOfInterest.Created);
    }

    [Fact]
    public async Task Post_WithoutRegionOfInterest_LeavesItNull()
    {
        var client = _factory.CreateClient();
        var collectionId = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        var payload = NewCellCount(collectionId);

        var response = await client.PostAsJsonAsync("/cellcounts", payload);
        response.EnsureSuccessStatusCode();

        var created = await response.Content.ReadFromJsonAsync<CellCount>();
        Assert.NotNull(created);
        Assert.Null(created!.RegionOfInterest);
    }

    [Fact]
    public async Task Post_DerivesSlideIdFromCollection_IgnoringAnyClientValue()
    {
        var client = _factory.CreateClient();
        var slideId = Guid.NewGuid().ToString();
        var collectionId = await CreateCollectionAsync(client, slideId);
        var payload = NewCellCount(collectionId);
        payload.SlideId = "not-the-real-slide";

        var response = await client.PostAsJsonAsync("/cellcounts", payload);
        response.EnsureSuccessStatusCode();

        var created = await response.Content.ReadFromJsonAsync<CellCount>();
        Assert.Equal(slideId, created!.SlideId);
    }

    [Fact]
    public async Task Post_WithUnknownCollectionId_ReturnsNotFound()
    {
        var client = _factory.CreateClient();
        var payload = NewCellCount(Guid.NewGuid());

        var response = await client.PostAsJsonAsync("/cellcounts", payload);

        Assert.Equal(System.Net.HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Get_ReturnsRegionOfInterestNestedOnEachCellCount()
    {
        var client = _factory.CreateClient();
        var collectionId = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        await client.PostAsJsonAsync("/cellcounts", NewCellCount(collectionId, new RegionOfInterest { GeoJson = RoiGeoJson }));
        await client.PostAsJsonAsync("/cellcounts", NewCellCount(collectionId));

        var response = await client.GetAsync($"/cellcounts?collectionId={collectionId}");
        response.EnsureSuccessStatusCode();

        var cellCounts = await response.Content.ReadFromJsonAsync<List<CellCount>>();
        Assert.NotNull(cellCounts);
        Assert.Equal(2, cellCounts!.Count);
        Assert.Single(cellCounts, c => c.RegionOfInterest is not null);
        Assert.Single(cellCounts, c => c.RegionOfInterest is null);
    }

    [Fact]
    public async Task Get_DoesNotReturnCellCountsFromAnotherCollection()
    {
        var client = _factory.CreateClient();
        var collectionIdA = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        var collectionIdB = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        await client.PostAsJsonAsync("/cellcounts", NewCellCount(collectionIdA));
        await client.PostAsJsonAsync("/cellcounts", NewCellCount(collectionIdB));

        var response = await client.GetAsync($"/cellcounts?collectionId={collectionIdA}");
        var cellCounts = await response.Content.ReadFromJsonAsync<List<CellCount>>();

        Assert.Single(cellCounts!);
    }

    [Fact]
    public async Task Delete_CascadesToItsRegionOfInterest()
    {
        var client = _factory.CreateClient();
        var collectionId = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        var postResponse = await client.PostAsJsonAsync(
            "/cellcounts", NewCellCount(collectionId, new RegionOfInterest { GeoJson = RoiGeoJson }));
        var created = await postResponse.Content.ReadFromJsonAsync<CellCount>();
        var roiId = created!.RegionOfInterest!.Id;

        var deleteResponse = await client.DeleteAsync($"/cellcounts/{created.Id}");
        Assert.Equal(System.Net.HttpStatusCode.NoContent, deleteResponse.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
        Assert.False(await db.RegionsOfInterest.AnyAsync(r => r.Id == roiId));
    }

    [Fact]
    public async Task Put_CannotChangeRegionOfInterest_MatchingTheFixedAtCreationConvention()
    {
        var client = _factory.CreateClient();
        var collectionId = await CreateCollectionAsync(client, Guid.NewGuid().ToString());
        var postResponse = await client.PostAsJsonAsync(
            "/cellcounts", NewCellCount(collectionId, new RegionOfInterest { GeoJson = RoiGeoJson }));
        var created = await postResponse.Content.ReadFromJsonAsync<CellCount>();

        var update = NewCellCount(collectionId);
        update.Label = "renamed";
        var putResponse = await client.PutAsJsonAsync($"/cellcounts/{created!.Id}", update);
        putResponse.EnsureSuccessStatusCode();

        var getResponse = await client.GetAsync($"/cellcounts?collectionId={collectionId}");
        var cellCounts = await getResponse.Content.ReadFromJsonAsync<List<CellCount>>();
        var updated = Assert.Single(cellCounts!);
        Assert.Equal("renamed", updated.Label);
        Assert.NotNull(updated.RegionOfInterest);
        Assert.Equal(RoiGeoJson, updated.RegionOfInterest!.GeoJson);
    }
}
