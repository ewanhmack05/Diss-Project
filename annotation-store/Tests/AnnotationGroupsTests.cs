using System.Net;
using System.Net.Http.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;

namespace AnnotationStore.Tests;

public class AnnotationGroupsTests : IClassFixture<CellCountApiFactory>
{
    private static readonly System.Text.Json.JsonSerializerOptions Json = TestJson.Options;

    private readonly CellCountApiFactory _factory;

    public AnnotationGroupsTests(CellCountApiFactory factory)
    {
        _factory = factory;
    }

    private HttpClient As(string userId) => TestAuthHandler.As(_factory.CreateClient(), userId);

    private static async Task<Guid> OwnCollectionAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/collections/ensure", new EnsureRequest(Guid.NewGuid().ToString()));
        return (await response.Content.ReadFromJsonAsync<CollectionView>(Json))!.CollectionId;
    }

    private static async Task<Guid> AddAsync(HttpClient client, Guid collectionId, string label, Guid? groupId = null)
    {
        var response = await client.PostAsJsonAsync("/annotations",
            new Annotation { CollectionId = collectionId, Label = label, Colour = "#000000", GroupId = groupId });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<Annotation>(Json))!.Id;
    }

    private static async Task<List<Annotation>> AnnotationsAsync(HttpClient client, Guid collectionId) =>
        (await client.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={collectionId}", Json))!;

    private static async Task<GroupView> NewGroupAsync(HttpClient client, Guid collectionId, string name, List<Guid>? ids = null)
    {
        var response = await client.PostAsJsonAsync("/annotationgroups", new NewGroupRequest(collectionId, name, ids), Json);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<GroupView>(Json))!;
    }

    [Fact]
    public async Task NewGroup_TakesTheAnnotationsItsGiven_AndCountsThem()
    {
        var alice = As("alice");
        var id = await OwnCollectionAsync(alice);
        var a = await AddAsync(alice, id, "a");
        var b = await AddAsync(alice, id, "b");
        await AddAsync(alice, id, "c");

        var group = await NewGroupAsync(alice, id, "  Tumour  ", [a, b]);

        Assert.Equal("Tumour", group.Name);
        Assert.Equal(2, group.Count);
        var grouped = (await AnnotationsAsync(alice, id)).Where(x => x.GroupId == group.Id).Select(x => x.Label);
        Assert.Equal(["a", "b"], grouped.Order());
        Assert.Single((await alice.GetFromJsonAsync<List<GroupView>>($"/annotationgroups?collectionId={id}", Json))!);
    }

    [Fact]
    public async Task DeletingAGroup_UngroupsItsAnnotations_WithoutDeletingThem()
    {
        var alice = As("alice");
        var id = await OwnCollectionAsync(alice);
        var group = await NewGroupAsync(alice, id, "g");
        await AddAsync(alice, id, "a", group.Id);

        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/annotationgroups/{group.Id}")).StatusCode);

        var annotation = Assert.Single(await AnnotationsAsync(alice, id));
        Assert.Null(annotation.GroupId);
    }

    [Fact]
    public async Task Rename_ChangesTheName_AndChecksIt()
    {
        var alice = As("alice");
        var id = await OwnCollectionAsync(alice);
        var group = await NewGroupAsync(alice, id, "g");

        var renamed = await alice.PutAsJsonAsync($"/annotationgroups/{group.Id}", new GroupUpdateRequest("Stroma"), Json);
        Assert.Equal("Stroma", (await renamed.Content.ReadFromJsonAsync<GroupView>(Json))!.Name);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await alice.PutAsJsonAsync($"/annotationgroups/{group.Id}", new GroupUpdateRequest(" "), Json)).StatusCode);

        // Notes on their own leave the name alone.
        var noted = await alice.PutAsJsonAsync($"/annotationgroups/{group.Id}", new GroupUpdateRequest(Notes: "check margins"), Json);
        var view = (await noted.Content.ReadFromJsonAsync<GroupView>(Json))!;
        Assert.Equal("Stroma", view.Name);
        Assert.Equal("check margins", view.Notes);
    }

    [Fact]
    public async Task Merge_MovesEverythingAcross_JoinsNotes_AndDeletesTheOldGroup()
    {
        var alice = As("alice");
        var id = await OwnCollectionAsync(alice);
        var from = await NewGroupAsync(alice, id, "from", [await AddAsync(alice, id, "a"), await AddAsync(alice, id, "b")]);
        var into = await NewGroupAsync(alice, id, "into", [await AddAsync(alice, id, "c")]);
        await alice.PutAsJsonAsync($"/annotationgroups/{from.Id}", new GroupUpdateRequest(Notes: "second"), Json);
        await alice.PutAsJsonAsync($"/annotationgroups/{into.Id}", new GroupUpdateRequest(Notes: "first"), Json);

        var response = await alice.PostAsJsonAsync($"/annotationgroups/{from.Id}/merge", new GroupMergeRequest(into.Id), Json);

        var merged = (await response.Content.ReadFromJsonAsync<GroupView>(Json))!;
        Assert.Equal(3, merged.Count);
        Assert.Equal("first\n\nsecond", merged.Notes);
        Assert.All(await AnnotationsAsync(alice, id), a => Assert.Equal(into.Id, a.GroupId));
        var groups = (await alice.GetFromJsonAsync<List<GroupView>>($"/annotationgroups?collectionId={id}", Json))!;
        Assert.Equal(into.Id, Assert.Single(groups).Id);
    }

    [Fact]
    public async Task Merge_IntoItselfOrAnotherCollection_IsTurnedDown()
    {
        var alice = As("alice");
        var id = await OwnCollectionAsync(alice);
        var other = await NewGroupAsync(alice, await OwnCollectionAsync(alice), "other");
        var group = await NewGroupAsync(alice, id, "g");

        Assert.Equal(HttpStatusCode.BadRequest,
            (await alice.PostAsJsonAsync($"/annotationgroups/{group.Id}/merge", new GroupMergeRequest(group.Id), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await alice.PostAsJsonAsync($"/annotationgroups/{group.Id}/merge", new GroupMergeRequest(other.Id), Json)).StatusCode);
        // Not in the collection at all.
        Assert.Equal(HttpStatusCode.NotFound,
            (await As("bob").PostAsJsonAsync($"/annotationgroups/{group.Id}/merge", new GroupMergeRequest(other.Id), Json)).StatusCode);
    }

    [Fact]
    public async Task AGroup_FromAnotherCollection_IsTurnedDown()
    {
        var alice = As("alice");
        var mine = await OwnCollectionAsync(alice);
        var other = await OwnCollectionAsync(alice);
        var group = await NewGroupAsync(alice, other, "g");

        var post = await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = mine, Label = "a", GroupId = group.Id });
        var bulk = await alice.PutAsJsonAsync("/annotations/bulk",
            new BulkUpdateRequest(mine, [Guid.NewGuid()], SetGroup: true, GroupId: group.Id), Json);

        Assert.Equal(HttpStatusCode.BadRequest, post.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, bulk.StatusCode);
    }

    [Fact]
    public async Task BulkUpdate_RecoloursAndRegroups_OnlyWhatsInTheCollection()
    {
        var alice = As("alice");
        var id = await OwnCollectionAsync(alice);
        var otherId = await OwnCollectionAsync(alice);
        var a = await AddAsync(alice, id, "a");
        var b = await AddAsync(alice, id, "b");
        var elsewhere = await AddAsync(alice, otherId, "x");
        var group = await NewGroupAsync(alice, id, "g");

        var response = await alice.PutAsJsonAsync("/annotations/bulk",
            new BulkUpdateRequest(id, [a, b, elsewhere], Colour: "#FB0909", SetGroup: true, GroupId: group.Id), Json);

        Assert.Equal(2, (await response.Content.ReadFromJsonAsync<BulkResult>(Json))!.Count);
        Assert.All(await AnnotationsAsync(alice, id), x =>
        {
            Assert.Equal("#FB0909", x.Colour);
            Assert.Equal(group.Id, x.GroupId);
        });
        Assert.Equal("#000000", Assert.Single(await AnnotationsAsync(alice, otherId)).Colour);

        // Out of the group again, colour left alone.
        await alice.PutAsJsonAsync("/annotations/bulk", new BulkUpdateRequest(id, [a], SetGroup: true), Json);
        var ungrouped = (await AnnotationsAsync(alice, id)).Single(x => x.Id == a);
        Assert.Null(ungrouped.GroupId);
        Assert.Equal("#FB0909", ungrouped.Colour);
    }

    [Fact]
    public async Task BulkDelete_DeletesOnlyWhatsInTheCollection()
    {
        var alice = As("alice");
        var id = await OwnCollectionAsync(alice);
        var otherId = await OwnCollectionAsync(alice);
        var a = await AddAsync(alice, id, "a");
        await AddAsync(alice, id, "b");
        var elsewhere = await AddAsync(alice, otherId, "x");

        var response = await alice.PostAsJsonAsync("/annotations/bulk-delete", new BulkDeleteRequest(id, [a, elsewhere]), Json);

        Assert.Equal(1, (await response.Content.ReadFromJsonAsync<BulkResult>(Json))!.Count);
        Assert.Equal("b", Assert.Single(await AnnotationsAsync(alice, id)).Label);
        Assert.Single(await AnnotationsAsync(alice, otherId));
    }

    [Fact]
    public async Task Viewers_CantGroupOrBulkChange()
    {
        var alice = As("alice");
        var bob = As("bob");
        var id = await OwnCollectionAsync(alice);
        var a = await AddAsync(alice, id, "a");
        await alice.PutAsJsonAsync($"/collections/{id}/sharing", new SharingRequest(true), Json);

        Assert.Equal(HttpStatusCode.OK, (await bob.GetAsync($"/annotationgroups?collectionId={id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await bob.PostAsJsonAsync("/annotationgroups", new NewGroupRequest(id, "g"), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await bob.PutAsJsonAsync("/annotations/bulk", new BulkUpdateRequest(id, [a], Colour: "#FFFFFF"), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await bob.PostAsJsonAsync("/annotations/bulk-delete", new BulkDeleteRequest(id, [a]), Json)).StatusCode);
    }

    [Fact]
    public async Task Import_PutsAnnotationsIntoGroupsByName_ReusingOnesThatExist()
    {
        var alice = As("alice");
        var id = await OwnCollectionAsync(alice);
        var existing = await NewGroupAsync(alice, id, "Tumour");
        Annotation a = new() { Id = Guid.NewGuid(), Label = "a" };
        Annotation b = new() { Id = Guid.NewGuid(), Label = "b" };
        Annotation c = new() { Id = Guid.NewGuid(), Label = "c" };

        var response = await alice.PostAsJsonAsync($"/collections/{id}/import", new ImportRequest(
            [a, b, c], [], [new ImportGroup("Tumour", [a.Id]), new ImportGroup("Stroma", [b.Id])]), Json);
        response.EnsureSuccessStatusCode();
        Assert.Equal(2, (await response.Content.ReadFromJsonAsync<ImportResult>(Json))!.Groups.Count);

        var groups = (await alice.GetFromJsonAsync<List<GroupView>>($"/annotationgroups?collectionId={id}", Json))!;
        Assert.Equal(["Stroma", "Tumour"], groups.Select(g => g.Name));
        var byLabel = (await AnnotationsAsync(alice, id)).ToDictionary(x => x.Label);
        Assert.Equal(existing.Id, byLabel["a"].GroupId);
        Assert.Equal(groups[0].Id, byLabel["b"].GroupId);
        Assert.Null(byLabel["c"].GroupId);

        var export = (await alice.GetFromJsonAsync<ExportView>($"/collections/{id}/export", Json))!;
        Assert.Equal(2, export.Groups.Count);
    }
}
