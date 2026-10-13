using System.Net.Http.Json;
using System.Text.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AnnotationStore.Tests;

// The Saved list gets a count's colour and placed-by counts instead of its
// dots: worked out on save, kept on the row, filled in for older rows the
// first time they're listed. The dots themselves only come from
// GET /cellcounts/{id}.
public class CellCountSummaryTests : IClassFixture<CellCountApiFactory>
{
    private const string SharedDots = """
        [
          {"x":1,"y":1,"colour":"#ff0000","placedBy":{"userId":"u1","name":"Alice"}},
          {"x":2,"y":2,"colour":"#0000ff","placedBy":{"userId":"u2","name":"Bob"}},
          {"x":3,"y":3,"colour":"#ff0000","placedBy":{"userId":"u1","name":"Alice"}},
          {"x":4,"y":4,"colour":"#ff0000"}
        ]
        """;

    private readonly CellCountApiFactory _factory;

    public CellCountSummaryTests(CellCountApiFactory factory)
    {
        _factory = factory;
    }

    private static CellCount NewCellCount(Guid collectionId, string dots, string label = "count") => new()
    {
        CollectionId = collectionId,
        Label = label,
        Dots = dots,
        WithAnnotation = true,
        Count = 4,
        DotSize = 6,
    };

    [Fact]
    public void FromDots_CountsColoursAndPeople_InTheOrderTheyFirstTurnUp()
    {
        var (colours, placedBy) = CellCountSummary.FromDots(SharedDots);

        Assert.Equal([new ColourCount("#ff0000", 3), new ColourCount("#0000ff", 1)], colours);
        Assert.Equal([new PlacedByCount("u1", "Alice", 2), new PlacedByCount("u2", "Bob", 1)], placedBy);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("not json")]
    [InlineData("""{"x":1}""")]
    [InlineData("""[1, "two", null]""")]
    public void FromDots_NothingReadable_IsEmpty(string? dots)
    {
        var (colours, placedBy) = CellCountSummary.FromDots(dots);

        Assert.Empty(colours);
        Assert.Empty(placedBy);
    }

    [Fact]
    public void FromDots_SomeoneWithNoName_IsShownByTheirId()
    {
        var (_, placedBy) = CellCountSummary.FromDots("""[{"colour":"#000000","placedBy":{"userId":"u9"}}]""");

        Assert.Equal([new PlacedByCount("u9", "u9", 1)], placedBy);
    }

    [Fact]
    public async Task List_HasNoDots_ButHasTheirSummary()
    {
        var client = _factory.CreateClient();
        var collectionId = await TestJson.EnsureCollectionAsync(client, Guid.NewGuid().ToString());
        (await client.PostAsJsonAsync("/cellcounts", NewCellCount(collectionId, SharedDots))).EnsureSuccessStatusCode();

        var list = await client.GetFromJsonAsync<JsonElement>($"/cellcounts?collectionId={collectionId}&take=10");
        var item = list[0];

        Assert.Equal(JsonValueKind.Null, item.GetProperty("dots").ValueKind);
        Assert.Equal("""[{"colour":"#ff0000","count":3},{"colour":"#0000ff","count":1}]""", item.GetProperty("colourCounts").GetRawText());
        Assert.Equal("""[{"userId":"u1","name":"Alice","count":2},{"userId":"u2","name":"Bob","count":1}]""",
            item.GetProperty("placedByCounts").GetRawText());
        // The stored JSON columns don't go out as they are.
        Assert.False(item.TryGetProperty("colourCountsJson", out _));
        Assert.False(item.TryGetProperty("placedByCountsJson", out _));
    }

    [Fact]
    public async Task List_WithoutPaging_HasNoDotsEither()
    {
        var client = _factory.CreateClient();
        var collectionId = await TestJson.EnsureCollectionAsync(client, Guid.NewGuid().ToString());
        (await client.PostAsJsonAsync("/cellcounts", NewCellCount(collectionId, SharedDots))).EnsureSuccessStatusCode();

        var list = await client.GetFromJsonAsync<JsonElement>($"/cellcounts?collectionId={collectionId}");

        Assert.Equal(JsonValueKind.Null, list[0].GetProperty("dots").ValueKind);
    }

    [Fact]
    public async Task ById_StillHasTheDots()
    {
        var client = _factory.CreateClient();
        var collectionId = await TestJson.EnsureCollectionAsync(client, Guid.NewGuid().ToString());
        var created = await (await client.PostAsJsonAsync("/cellcounts", NewCellCount(collectionId, SharedDots)))
            .Content.ReadFromJsonAsync<CellCount>();

        var fetched = await client.GetFromJsonAsync<CellCount>($"/cellcounts/{created!.Id}");

        Assert.Equal(SharedDots, fetched!.Dots);
    }

    [Fact]
    public async Task Post_StoresTheSummaryOnTheRow()
    {
        var client = _factory.CreateClient();
        var collectionId = await TestJson.EnsureCollectionAsync(client, Guid.NewGuid().ToString());
        var created = await (await client.PostAsJsonAsync("/cellcounts", NewCellCount(collectionId, SharedDots)))
            .Content.ReadFromJsonAsync<CellCount>();

        using var scope = _factory.Services.CreateScope();
        var row = await scope.ServiceProvider.GetRequiredService<AnnotationDbContext>().CellCounts.SingleAsync(c => c.Id == created!.Id);

        Assert.Equal("""[{"colour":"#ff0000","count":3},{"colour":"#0000ff","count":1}]""", row.ColourCountsJson);
        Assert.Equal("""[{"userId":"u1","name":"Alice","count":2},{"userId":"u2","name":"Bob","count":1}]""", row.PlacedByCountsJson);
    }

    [Fact]
    public async Task Post_IgnoresASummaryTheClientSends()
    {
        var client = _factory.CreateClient();
        var collectionId = await TestJson.EnsureCollectionAsync(client, Guid.NewGuid().ToString());
        var body = new
        {
            collectionId,
            label = "count",
            dots = """[{"colour":"#00ff00"}]""",
            withAnnotation = true,
            count = 1,
            dotSize = 6,
            colourCountsJson = """[{"colour":"#bad","count":99}]""",
        };
        (await client.PostAsJsonAsync("/cellcounts", body)).EnsureSuccessStatusCode();

        var list = await client.GetFromJsonAsync<JsonElement>($"/cellcounts?collectionId={collectionId}&take=1");

        Assert.Equal("""[{"colour":"#00ff00","count":1}]""", list[0].GetProperty("colourCounts").GetRawText());
    }

    [Fact]
    public async Task List_FillsInTheSummary_ForCountsSavedBeforeIt_AndKeepsIt()
    {
        var client = _factory.CreateClient();
        var collectionId = await TestJson.EnsureCollectionAsync(client, Guid.NewGuid().ToString());
        var created = await (await client.PostAsJsonAsync("/cellcounts", NewCellCount(collectionId, SharedDots)))
            .Content.ReadFromJsonAsync<CellCount>();
        // As a row from before the summary columns would be.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
            var row = await db.CellCounts.SingleAsync(c => c.Id == created!.Id);
            row.ColourCountsJson = null;
            row.PlacedByCountsJson = null;
            await db.SaveChangesAsync();
        }

        var list = await client.GetFromJsonAsync<JsonElement>($"/cellcounts?collectionId={collectionId}&take=10");

        Assert.Equal("""[{"colour":"#ff0000","count":3},{"colour":"#0000ff","count":1}]""", list[0].GetProperty("colourCounts").GetRawText());
        using (var scope = _factory.Services.CreateScope())
        {
            var row = await scope.ServiceProvider.GetRequiredService<AnnotationDbContext>().CellCounts.SingleAsync(c => c.Id == created!.Id);
            Assert.NotNull(row.ColourCountsJson);
            Assert.NotNull(row.PlacedByCountsJson);
        }
    }
}
