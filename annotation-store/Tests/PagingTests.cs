using System.Net;
using System.Net.Http.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.Paging;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace AnnotationStore.Tests;

// The Saved lists' paging: skip/take/search and the createdBy/shape filters
// on GET /annotations and /cellcounts, /total with the same search and
// filters, /authors, GET /cellcounts/{id}, and the
// bigger body limit on POST /cellcounts.
public class PagingTests : IClassFixture<CellCountApiFactory>
{
    private readonly CellCountApiFactory _factory;

    public PagingTests(CellCountApiFactory factory)
    {
        _factory = factory;
    }

    private static Annotation NewAnnotation(Guid collectionId, string label, string notes = "", string shape = "polygon") => new()
    {
        CollectionId = collectionId,
        Label = label,
        Notes = notes,
        Colour = "#ff0000",
        Shape = shape,
        LineStyle = "solid",
        LineThickness = 2,
        GeoJson = """{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[0,0]]]},"properties":{}}""",
    };

    private static CellCount NewCellCount(Guid collectionId, string label, string notes = "", RegionOfInterest? roi = null) => new()
    {
        CollectionId = collectionId,
        Label = label,
        Notes = notes,
        Dots = """[{"x":1,"y":2,"colour":"#ff0000"}]""",
        WithAnnotation = true,
        WithRoi = roi is not null,
        Count = 1,
        DotSize = 6,
        RegionOfInterest = roi,
    };

    // A fresh collection with `count` annotations labelled "A 1".."A n",
    // saved in that order - so "A n" is the newest.
    private async Task<(HttpClient Client, Guid CollectionId)> AnnotationsAsync(int count)
    {
        var client = _factory.CreateClient();
        var collectionId = await TestJson.EnsureCollectionAsync(client, Guid.NewGuid().ToString());
        for (var i = 1; i <= count; i++)
            (await client.PostAsJsonAsync("/annotations", NewAnnotation(collectionId, $"A {i}"))).EnsureSuccessStatusCode();
        return (client, collectionId);
    }

    private static async Task<string[]> LabelsAsync(HttpClient client, string url) =>
        (await client.GetFromJsonAsync<Annotation[]>(url))!.Select(a => a.Label).ToArray();

    [Fact]
    public async Task Annotations_WithoutPaging_StillReturnsEverythingNewestFirst()
    {
        var (client, collectionId) = await AnnotationsAsync(5);

        var labels = await LabelsAsync(client, $"/annotations?collectionId={collectionId}");

        Assert.Equal(["A 5", "A 4", "A 3", "A 2", "A 1"], labels);
    }

    [Fact]
    public async Task Annotations_Pages_AreNewestFirst_AndCoverEverythingOnce()
    {
        var (client, collectionId) = await AnnotationsAsync(7);
        var url = $"/annotations?collectionId={collectionId}&take=3";

        var first = await LabelsAsync(client, $"{url}&skip=0");
        var second = await LabelsAsync(client, $"{url}&skip=3");
        var last = await LabelsAsync(client, $"{url}&skip=6");
        var past = await LabelsAsync(client, $"{url}&skip=9");

        Assert.Equal(["A 7", "A 6", "A 5"], first);
        Assert.Equal(["A 4", "A 3", "A 2"], second);
        Assert.Equal(["A 1"], last);
        Assert.Empty(past);
    }

    [Fact]
    public async Task Annotations_Search_MatchesLabelNotesAndShape_IgnoringCase()
    {
        var client = _factory.CreateClient();
        var collectionId = await TestJson.EnsureCollectionAsync(client, Guid.NewGuid().ToString());
        foreach (var annotation in new[]
        {
            NewAnnotation(collectionId, "Tumour edge"),
            NewAnnotation(collectionId, "Other", notes: "possible TUMOUR"),
            NewAnnotation(collectionId, "Box", shape: "rectangle"),
            NewAnnotation(collectionId, "Nothing to see"),
        })
            (await client.PostAsJsonAsync("/annotations", annotation)).EnsureSuccessStatusCode();

        Assert.Equal(["Other", "Tumour edge"], await LabelsAsync(client, $"/annotations?collectionId={collectionId}&search=tumour"));
        Assert.Equal(["Box"], await LabelsAsync(client, $"/annotations?collectionId={collectionId}&search=Rectangle"));
        Assert.Equal(["Other", "Tumour edge"], await LabelsAsync(client, $"/annotations?collectionId={collectionId}&search=%20tumour%20"));
        Assert.Equal(2, await client.GetFromJsonAsync<int>($"/annotations/total?collectionId={collectionId}&search=tumour"));
        Assert.Equal(4, await client.GetFromJsonAsync<int>($"/annotations/total?collectionId={collectionId}"));
    }

    [Fact]
    public async Task Annotations_Search_TakesPercentAndUnderscoreLiterally()
    {
        var client = _factory.CreateClient();
        var collectionId = await TestJson.EnsureCollectionAsync(client, Guid.NewGuid().ToString());
        (await client.PostAsJsonAsync("/annotations", NewAnnotation(collectionId, "50% necrosis"))).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/annotations", NewAnnotation(collectionId, "500 cells"))).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/annotations", NewAnnotation(collectionId, "a_b"))).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/annotations", NewAnnotation(collectionId, "axb"))).EnsureSuccessStatusCode();

        Assert.Equal(["50% necrosis"], await LabelsAsync(client, $"/annotations?collectionId={collectionId}&search=50%25"));
        Assert.Equal(["a_b"], await LabelsAsync(client, $"/annotations?collectionId={collectionId}&search=a_b"));
    }

    [Fact]
    public async Task Annotations_SearchAndPaging_Combine()
    {
        var (client, collectionId) = await AnnotationsAsync(12);

        // "1" matches A 1, A 10, A 11 and A 12 - newest first, two a page.
        var first = await LabelsAsync(client, $"/annotations?collectionId={collectionId}&search=1&take=2");
        var second = await LabelsAsync(client, $"/annotations?collectionId={collectionId}&search=1&take=2&skip=2");

        Assert.Equal(["A 12", "A 11"], first);
        Assert.Equal(["A 10", "A 1"], second);
        Assert.Equal(4, await client.GetFromJsonAsync<int>($"/annotations/total?collectionId={collectionId}&search=1"));
    }

    // A session Alice hosts with Bob in it as an editor, so both can save
    // to the same collection.
    private async Task<(HttpClient Alice, HttpClient Bob, Guid SessionId)> SharedAsync()
    {
        var alice = TestAuthHandler.As(_factory.CreateClient(), "alice", "Alice Moore");
        var bob = TestAuthHandler.As(_factory.CreateClient(), "bob", "Bob Hughes");
        var started = await alice.PostAsJsonAsync("/sessions", new AnnotationStore.Collections.EnsureRequest(Guid.NewGuid().ToString()));
        var session = (await started.Content.ReadFromJsonAsync<AnnotationStore.Collections.CollectionView>(TestJson.Options))!;
        var invited = await alice.PostAsJsonAsync($"/collections/{session.CollectionId}/invites",
            new AnnotationStore.Collections.InviteRequest(AnnotationStore.Collections.CollectionRole.Editor, 24), TestJson.Options);
        var invite = (await invited.Content.ReadFromJsonAsync<AnnotationStore.Collections.InviteView>(TestJson.Options))!;
        (await bob.PostAsync($"/invites/{invite.Code}/accept", null)).EnsureSuccessStatusCode();
        return (alice, bob, session.CollectionId);
    }

    private static string Iso(DateTimeOffset when) => Uri.EscapeDataString(when.ToString("O"));

    [Fact]
    public async Task Annotations_FilterByPeopleShapeColourAndNotes()
    {
        var (alice, bob, sessionId) = await SharedAsync();
        var aliceBox = NewAnnotation(sessionId, "Alice box", shape: "rectangle");
        aliceBox.Colour = "#FB0909";
        var aliceLine = NewAnnotation(sessionId, "Alice line", notes: "edge", shape: "line");
        aliceLine.Colour = "#0913fb";
        var bobBox = NewAnnotation(sessionId, "Bob box", shape: "rectangle");
        bobBox.Colour = "#fb0909";
        (await alice.PostAsJsonAsync("/annotations", aliceBox)).EnsureSuccessStatusCode();
        (await alice.PostAsJsonAsync("/annotations", aliceLine)).EnsureSuccessStatusCode();
        (await bob.PostAsJsonAsync("/annotations", bobBox)).EnsureSuccessStatusCode();
        var url = $"/annotations?collectionId={sessionId}&take=10";
        var total = $"/annotations/total?collectionId={sessionId}";

        Assert.Equal(["Alice line", "Alice box"], await LabelsAsync(bob, $"{url}&createdBy=alice"));
        Assert.Equal(["Bob box", "Alice line", "Alice box"], await LabelsAsync(bob, $"{url}&createdBy=alice&createdBy=bob"));
        Assert.Equal(["Bob box", "Alice box"], await LabelsAsync(bob, $"{url}&shape=rectangle"));
        Assert.Equal(["Bob box", "Alice line", "Alice box"], await LabelsAsync(bob, $"{url}&shape=rectangle&shape=line"));
        // Case doesn't matter either way round.
        Assert.Equal(["Bob box", "Alice box"], await LabelsAsync(bob, $"{url}&colour=%23Fb0909"));
        // otherThan is everything but those - alone, or alongside picked colours.
        Assert.Equal(["Alice line"], await LabelsAsync(bob, $"{url}&otherThan=%23FB0909&otherThan=%23000000"));
        Assert.Equal(["Bob box", "Alice box"], await LabelsAsync(bob, $"{url}&otherThan=%230913FB"));
        Assert.Equal(["Bob box", "Alice line", "Alice box"], await LabelsAsync(bob, $"{url}&colour=%230913fb&otherThan=%230913fb"));
        Assert.Equal(["Alice line"], await LabelsAsync(bob, $"{url}&hasNotes=true"));
        Assert.Equal(["Bob box", "Alice box"], await LabelsAsync(bob, $"{url}&hasNotes=false"));
        Assert.Equal(["Bob box"], await LabelsAsync(alice, $"{url}&createdBy=bob&shape=rectangle&search=box"));
        Assert.Equal(1, await bob.GetFromJsonAsync<int>($"{total}&createdBy=alice&shape=line"));
        Assert.Equal(0, await bob.GetFromJsonAsync<int>($"{total}&createdBy=nobody"));
        Assert.Equal(3, await bob.GetFromJsonAsync<int>(total));
    }

    [Fact]
    public async Task Annotations_FilterByGroup_WithNoneForUngrouped()
    {
        var (client, collectionId) = await AnnotationsAsync(3);
        var all = (await client.GetFromJsonAsync<Annotation[]>($"/annotations?collectionId={collectionId}"))!;
        var byLabel = all.ToDictionary(a => a.Label, a => a.Id);
        var tumour = await (await client.PostAsJsonAsync("/annotationgroups",
            new NewGroupRequest(collectionId, "Tumour", [byLabel["A 1"]]))).Content.ReadFromJsonAsync<GroupView>();
        var stroma = await (await client.PostAsJsonAsync("/annotationgroups",
            new NewGroupRequest(collectionId, "Stroma", [byLabel["A 2"]]))).Content.ReadFromJsonAsync<GroupView>();
        var url = $"/annotations?collectionId={collectionId}";
        async Task<string[]> Labels(string query) =>
            (await client.GetFromJsonAsync<Annotation[]>($"{url}&{query}"))!.Select(a => a.Label).ToArray();

        Assert.Equal(["A 1"], await Labels($"group={tumour!.Id}"));
        Assert.Equal(["A 3"], await Labels("group=none"));
        Assert.Equal(["A 3", "A 2"], await Labels($"group={stroma!.Id}&group=none"));
        Assert.Empty(await Labels("group=not-a-group"));
        Assert.Equal(2, await client.GetFromJsonAsync<int>($"/annotations/total?collectionId={collectionId}&group={tumour.Id}&group=none"));
    }

    [Fact]
    public async Task Annotations_FilterBySavedDate_FromInclusiveToExclusive()
    {
        var (client, collectionId) = await AnnotationsAsync(2);
        var now = DateTimeOffset.UtcNow;
        var total = $"/annotations/total?collectionId={collectionId}";

        Assert.Equal(2, await client.GetFromJsonAsync<int>($"{total}&from={Iso(now.AddHours(-1))}&to={Iso(now.AddHours(1))}"));
        Assert.Equal(0, await client.GetFromJsonAsync<int>($"{total}&from={Iso(now.AddHours(1))}"));
        Assert.Equal(0, await client.GetFromJsonAsync<int>($"{total}&to={Iso(now.AddHours(-1))}"));
        Assert.Equal(2, (await LabelsAsync(client, $"/annotations?collectionId={collectionId}&take=10&from={Iso(now.AddDays(-1))}")).Length);
    }

    [Fact]
    public async Task Facets_ListPeopleByName_AndColoursByUse()
    {
        var (alice, bob, sessionId) = await SharedAsync();
        var red = NewAnnotation(sessionId, "b");
        red.Colour = "#FB0909";
        var redToo = NewAnnotation(sessionId, "a1");
        redToo.Colour = "#fb0909";
        var blue = NewAnnotation(sessionId, "a2");
        blue.Colour = "#0913FB";
        (await bob.PostAsJsonAsync("/annotations", red)).EnsureSuccessStatusCode();
        (await alice.PostAsJsonAsync("/annotations", redToo)).EnsureSuccessStatusCode();
        (await alice.PostAsJsonAsync("/annotations", blue)).EnsureSuccessStatusCode();
        (await bob.PostAsJsonAsync("/cellcounts", NewCellCount(sessionId, "count"))).EnsureSuccessStatusCode();

        var annotations = (await alice.GetFromJsonAsync<SavedFacets>($"/annotations/facets?collectionId={sessionId}"))!;
        var cellCounts = (await alice.GetFromJsonAsync<SavedFacets>($"/cellcounts/facets?collectionId={sessionId}"))!;

        Assert.Equal([new SavedAuthor("alice", "Alice Moore", 2), new SavedAuthor("bob", "Bob Hughes", 1)], annotations.Authors);
        Assert.Equal([new SavedColour("#fb0909", 2), new SavedColour("#0913fb", 1)], annotations.Colours);
        Assert.Equal([new SavedAuthor("bob", "Bob Hughes", 1)], cellCounts.Authors);
        Assert.Empty(cellCounts.Colours);
        var stranger = TestAuthHandler.As(_factory.CreateClient(), "stranger");
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/annotations/facets?collectionId={sessionId}")).StatusCode);
    }

    [Fact]
    public void Authors_SomeoneRenamed_IsOnePerson_UnderTheirMostUsedName()
    {
        var authors = SavedPaging.Authors([
            new SavedAuthor("b", "Bob", 1),
            new SavedAuthor("a", "alice", 3),
            new SavedAuthor("b", "Bob Hughes", 4),
        ]);

        Assert.Equal([new SavedAuthor("a", "alice", 3), new SavedAuthor("b", "Bob Hughes", 5)], authors);
    }

    [Fact]
    public async Task CellCounts_FilterByPeopleNotesRoiAndDate()
    {
        var (alice, bob, sessionId) = await SharedAsync();
        const string roi = """{"type":"Polygon","coordinates":[[[0,0],[0,10],[10,10],[10,0],[0,0]]]}""";
        (await alice.PostAsJsonAsync("/cellcounts", NewCellCount(sessionId, "Alice's", notes: "mitoses"))).EnsureSuccessStatusCode();
        (await bob.PostAsJsonAsync("/cellcounts",
            NewCellCount(sessionId, "Bob's", roi: new RegionOfInterest { GeoJson = roi }))).EnsureSuccessStatusCode();
        var url = $"/cellcounts?collectionId={sessionId}&take=10";
        async Task<string[]> Labels(string query) =>
            (await alice.GetFromJsonAsync<CellCount[]>($"{url}&{query}"))!.Select(c => c.Label).ToArray();

        Assert.Equal(["Bob's"], await Labels("createdBy=bob"));
        Assert.Equal(["Alice's"], await Labels("hasNotes=true"));
        Assert.Equal(["Bob's"], await Labels("withRoi=true"));
        Assert.Equal(["Alice's"], await Labels("withRoi=false"));
        Assert.Empty(await Labels($"from={Iso(DateTimeOffset.UtcNow.AddHours(1))}"));
        Assert.Equal(1, await alice.GetFromJsonAsync<int>($"/cellcounts/total?collectionId={sessionId}&createdBy=alice"));
    }

    [Theory]
    [InlineData("take=0")]
    [InlineData("take=-1")]
    [InlineData($"take=501")]
    [InlineData("skip=-1&take=10")]
    public async Task BadPaging_Is400(string query)
    {
        var client = _factory.CreateClient();
        var collectionId = await TestJson.EnsureCollectionAsync(client, Guid.NewGuid().ToString());

        var annotations = await client.GetAsync($"/annotations?collectionId={collectionId}&{query}");
        var cellCounts = await client.GetAsync($"/cellcounts?collectionId={collectionId}&{query}");

        Assert.Equal(HttpStatusCode.BadRequest, annotations.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, cellCounts.StatusCode);
    }

    [Fact]
    public async Task MaxTake_IsAllowed()
    {
        var client = _factory.CreateClient();
        var collectionId = await TestJson.EnsureCollectionAsync(client, Guid.NewGuid().ToString());

        var response = await client.GetAsync($"/annotations?collectionId={collectionId}&take={SavedPaging.MaxTake}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Paging_SomeoneElsesCollection_IsNotFound()
    {
        var (_, collectionId) = await AnnotationsAsync(1);
        var stranger = TestAuthHandler.As(_factory.CreateClient(), "stranger");

        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/annotations?collectionId={collectionId}&take=10")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/annotations/total?collectionId={collectionId}&search=a")).StatusCode);
    }

    [Fact]
    public async Task CellCounts_PageAndSearch_NewestFirst_WithTheirRoi()
    {
        var client = _factory.CreateClient();
        var collectionId = await TestJson.EnsureCollectionAsync(client, Guid.NewGuid().ToString());
        const string roi = """{"type":"Polygon","coordinates":[[[0,0],[0,10],[10,10],[10,0],[0,0]]]}""";
        (await client.PostAsJsonAsync("/cellcounts", NewCellCount(collectionId, "Mitoses 1"))).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/cellcounts", NewCellCount(collectionId, "Other", notes: "mitoses here"))).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/cellcounts",
            NewCellCount(collectionId, "Mitoses 2", roi: new RegionOfInterest { GeoJson = roi }))).EnsureSuccessStatusCode();

        var page = await client.GetFromJsonAsync<CellCount[]>($"/cellcounts?collectionId={collectionId}&take=2");
        var searched = await client.GetFromJsonAsync<CellCount[]>($"/cellcounts?collectionId={collectionId}&search=MITOSES&take=2&skip=2");

        Assert.Equal(["Mitoses 2", "Other"], page!.Select(c => c.Label));
        Assert.Equal(roi, page![0].RegionOfInterest?.GeoJson);
        Assert.Equal(["Mitoses 1"], searched!.Select(c => c.Label));
        Assert.Equal(3, await client.GetFromJsonAsync<int>($"/cellcounts/total?collectionId={collectionId}&search=mitoses"));
        Assert.Equal(1, await client.GetFromJsonAsync<int>($"/cellcounts/total?collectionId={collectionId}&search=other"));
    }

    [Fact]
    public async Task CellCount_ById_ReturnsItWithDotsAndRoi()
    {
        var client = _factory.CreateClient();
        var collectionId = await TestJson.EnsureCollectionAsync(client, Guid.NewGuid().ToString());
        const string roi = """{"type":"Polygon","coordinates":[[[0,0],[0,10],[10,10],[10,0],[0,0]]]}""";
        var created = await (await client.PostAsJsonAsync("/cellcounts",
            NewCellCount(collectionId, "One", roi: new RegionOfInterest { GeoJson = roi }))).Content.ReadFromJsonAsync<CellCount>();

        var fetched = await client.GetFromJsonAsync<CellCount>($"/cellcounts/{created!.Id}");

        Assert.Equal("One", fetched!.Label);
        Assert.Equal(created.Dots, fetched.Dots);
        Assert.Equal(roi, fetched.RegionOfInterest?.GeoJson);
    }

    [Fact]
    public async Task CellCount_ById_UnknownOrNotYours_IsNotFound()
    {
        var client = _factory.CreateClient();
        var collectionId = await TestJson.EnsureCollectionAsync(client, Guid.NewGuid().ToString());
        var created = await (await client.PostAsJsonAsync("/cellcounts", NewCellCount(collectionId, "Mine")))
            .Content.ReadFromJsonAsync<CellCount>();
        var stranger = TestAuthHandler.As(_factory.CreateClient(), "stranger");

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/cellcounts/{Guid.NewGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/cellcounts/{created!.Id}")).StatusCode);
    }

    // TestServer doesn't enforce Kestrel's body limit, so this checks the
    // endpoint carries the limit Kestrel reads. Sized against a real
    // million-dot request in scripts/test_seed_stress.py.
    [Fact]
    public void PostCellCounts_AllowsAMillionDots()
    {
        var endpoints = _factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>();
        var post = endpoints.Single(e =>
            e.RoutePattern.RawText == "/cellcounts"
            && e.Metadata.GetMetadata<HttpMethodMetadata>()!.HttpMethods.Contains("POST"));

        Assert.Equal(CellCountLimits.MaxRequestBytes, post.Metadata.GetMetadata<IRequestSizeLimitMetadata>()?.MaxRequestBodySize);
        Assert.True(CellCountLimits.MaxRequestBytes > 1_000_000 * 70L, "under 70 bytes a dot for a million dots");
    }
}
