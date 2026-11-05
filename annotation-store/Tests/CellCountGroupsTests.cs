using System.Net;
using System.Net.Http.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using AnnotationStore.History;

namespace AnnotationStore.Tests;

// Named sets of cell counts, and everything history has to do for them: a change
// to one can be seen and put back, and a count can't end up in a group that's gone.
public class CellCountGroupsTests : IClassFixture<CellCountApiFactory>
{
    private static readonly System.Text.Json.JsonSerializerOptions Json = TestJson.Options;
    private readonly CellCountApiFactory _factory;

    public CellCountGroupsTests(CellCountApiFactory factory)
    {
        _factory = factory;
    }

    private record Row(Guid Id, Guid? GroupId, string? Dots);

    private HttpClient As(string userId) => TestAuthHandler.As(_factory.CreateClient(), userId, $"User {userId}");

    private static async Task<Guid> OwnAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/collections/ensure", new EnsureRequest(Guid.NewGuid().ToString()));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CollectionView>(Json))!.CollectionId;
    }

    private static async Task<Guid> CountAsync(HttpClient client, Guid collection, string label = "c", string dots = "[]")
    {
        var response = await client.PostAsJsonAsync("/cellcounts", new CellCount { CollectionId = collection, Label = label, Dots = dots }, Json);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CellCount>(Json))!.Id;
    }

    private static async Task<CountGroupView> GroupAsync(HttpClient client, Guid collection, string name = "Mitoses", params Guid[] counts)
    {
        var response = await client.PostAsJsonAsync("/cellcountgroups", new NewCountGroupRequest(collection, name, [.. counts]), Json);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CountGroupView>(Json))!;
    }

    private static async Task<List<CountGroupView>> GroupsAsync(HttpClient client, Guid collection) =>
        (await client.GetFromJsonAsync<List<CountGroupView>>($"/cellcountgroups?collectionId={collection}", Json))!;

    private static async Task<Guid?> GroupOfAsync(HttpClient client, Guid count) =>
        (await client.GetFromJsonAsync<Row>($"/cellcounts/{count}", Json))!.GroupId;

    private static async Task<ChangeSetView> LatestChangeAsync(HttpClient client, Guid collection) =>
        (await client.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={collection}", Json))!.First();

    [Fact]
    public async Task MakingOne_PutsCountsStraightIn_AndCountsThem()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (a, b, c) = (await CountAsync(alice, id), await CountAsync(alice, id), await CountAsync(alice, id));

        var group = await GroupAsync(alice, id, " Mitoses ", a, b);

        Assert.Equal("Mitoses", group.Name);
        Assert.Equal(2, group.Count);
        Assert.Equal(group.Id, await GroupOfAsync(alice, a));
        Assert.Null(await GroupOfAsync(alice, c));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task AName_IsNeeded(string name)
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);

        var response = await alice.PostAsJsonAsync("/cellcountgroups", new NewCountGroupRequest(id, name), Json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ANameThatsTooLong_IsTurnedDown()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);

        var response = await alice.PostAsJsonAsync("/cellcountgroups", new NewCountGroupRequest(id, new string('x', 65)), Json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task OnlyEditorsChangeThem_AndOnlyPeopleInTheCollectionSeeThem()
    {
        var alice = As("alice");
        var bob = As("bob");
        var id = await OwnAsync(alice);
        var group = await GroupAsync(alice, id);

        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/cellcountgroups?collectionId={id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsJsonAsync("/cellcountgroups", new NewCountGroupRequest(id, "No"), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PutAsJsonAsync($"/cellcountgroups/{group.Id}", new CountGroupUpdateRequest("No"), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/cellcountgroups/{group.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PutAsJsonAsync("/cellcounts/group", new CountGroupMoveRequest(id, [], group.Id), Json)).StatusCode);
    }

    [Fact]
    public async Task Moving_OnlyTouchesCountsInTheCollection_AndNeedsAGroupInItToo()
    {
        var alice = As("alice");
        var (mine, other) = (await OwnAsync(alice), await OwnAsync(alice));
        var (here, there) = (await CountAsync(alice, mine), await CountAsync(alice, other));
        var (group, otherGroup) = (await GroupAsync(alice, mine), await GroupAsync(alice, other));

        var moved = await alice.PutAsJsonAsync("/cellcounts/group", new CountGroupMoveRequest(mine, [here, there], group.Id), Json);
        moved.EnsureSuccessStatusCode();

        Assert.Equal(group.Id, await GroupOfAsync(alice, here));
        Assert.Null(await GroupOfAsync(alice, there));
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.PutAsJsonAsync("/cellcounts/group", new CountGroupMoveRequest(mine, [here], otherGroup.Id), Json)).StatusCode);
    }

    [Fact]
    public async Task Moving_TakesThemOutWithNoGroup()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var count = await CountAsync(alice, id);
        await GroupAsync(alice, id, "Mitoses", count);

        (await alice.PutAsJsonAsync("/cellcounts/group", new CountGroupMoveRequest(id, [count]), Json)).EnsureSuccessStatusCode();

        Assert.Null(await GroupOfAsync(alice, count));
    }

    [Fact]
    public async Task SavingACount_CantPutItInAGroup_ThatGoesThroughMoving()
    {
        var alice = As("alice");
        var (mine, other) = (await OwnAsync(alice), await OwnAsync(alice));
        var theirs = await GroupAsync(alice, other);

        var response = await alice.PostAsJsonAsync("/cellcounts", new CellCount { CollectionId = mine, GroupId = theirs.Id, Dots = "[]" }, Json);

        response.EnsureSuccessStatusCode();
        Assert.Null((await response.Content.ReadFromJsonAsync<CellCount>(Json))!.GroupId);
    }

    [Fact]
    public async Task EditingACount_LeavesItsGroupAlone()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var count = await CountAsync(alice, id);
        var group = await GroupAsync(alice, id, "Mitoses", count);

        (await alice.PutAsJsonAsync($"/cellcounts/{count}", new CellCount { CollectionId = id, Label = "new" }, Json)).EnsureSuccessStatusCode();

        Assert.Equal(group.Id, await GroupOfAsync(alice, count));
    }

    [Fact]
    public async Task TheList_SaysWhichGroup_AndCanBeNarrowedToOne()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (a, b) = (await CountAsync(alice, id), await CountAsync(alice, id));
        var group = await GroupAsync(alice, id, "Mitoses", a);

        var all = (await alice.GetFromJsonAsync<List<Row>>($"/cellcounts?collectionId={id}", Json))!;
        Assert.Equal(group.Id, all.Single(r => r.Id == a).GroupId);

        var inIt = (await alice.GetFromJsonAsync<List<Row>>($"/cellcounts?collectionId={id}&group={group.Id}", Json))!;
        Assert.Equal(a, Assert.Single(inIt).Id);
        var none = (await alice.GetFromJsonAsync<List<Row>>($"/cellcounts?collectionId={id}&group=none", Json))!;
        Assert.Equal(b, Assert.Single(none).Id);
    }

    [Fact]
    public async Task Renaming_AndNotes_KeepTheOtherOne()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var group = await GroupAsync(alice, id);

        await alice.PutAsJsonAsync($"/cellcountgroups/{group.Id}", new CountGroupUpdateRequest(Notes: "Look here"), Json);
        await alice.PutAsJsonAsync($"/cellcountgroups/{group.Id}", new CountGroupUpdateRequest(" Renamed "), Json);

        var now = Assert.Single(await GroupsAsync(alice, id));
        Assert.Equal(("Renamed", "Look here"), (now.Name, now.Notes));
    }

    [Fact]
    public async Task Moving_DoesntEverGoNearTheDots_ButIsInTheHistory()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var dots = """[{"x":1,"y":2,"colour":"#fff"}]""";
        var count = await CountAsync(alice, id, "c", dots);
        var group = await GroupAsync(alice, id, "Mitoses", count);

        Assert.Equal(dots, (await alice.GetFromJsonAsync<Row>($"/cellcounts/{count}", Json))!.Dots);
        var change = await LatestChangeAsync(alice, id);
        Assert.Equal("add cell count group", change.What);
        var detail = (await alice.GetFromJsonAsync<ChangeSetChanges>($"/changesets/{change.Id}/changes", Json))!;
        var moved = Assert.Single(detail.Changes);
        Assert.Equal("GroupId", moved.Column);
        Assert.Equal("Mitoses", detail.Groups[group.Id]);
    }

    [Fact]
    public async Task Deleting_LeavesTheCounts_AndPuttingItBackPutsThemBackInIt()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var count = await CountAsync(alice, id);
        var group = await GroupAsync(alice, id, "Mitoses", count);

        (await alice.DeleteAsync($"/cellcountgroups/{group.Id}")).EnsureSuccessStatusCode();
        Assert.Null(await GroupOfAsync(alice, count));
        Assert.Empty(await GroupsAsync(alice, id));

        var deleted = await LatestChangeAsync(alice, id);
        Assert.Equal(1, deleted.Deleted);
        var restored = await alice.PostAsync($"/changesets/{deleted.Id}/restore", null);
        restored.EnsureSuccessStatusCode();
        var view = (await restored.Content.ReadFromJsonAsync<RestoredView>(Json))!;

        Assert.Equal(1, view.Counts.CellCountGroups);
        Assert.Equal(group.Id, Assert.Single(view.CellCountGroups).Id);
        Assert.Equal(count, Assert.Single(view.ChangedCellCounts).Id);
        Assert.Equal(group.Id, await GroupOfAsync(alice, count));
        Assert.Equal(1, Assert.Single(await GroupsAsync(alice, id)).Count);
    }

    [Fact]
    public async Task PuttingACountBack_IntoAGroupThatsGone_LeavesItOutOfOne()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var count = await CountAsync(alice, id);
        var group = await GroupAsync(alice, id, "Mitoses", count);
        (await alice.DeleteAsync($"/cellcounts/{count}")).EnsureSuccessStatusCode();
        var deletedCount = await LatestChangeAsync(alice, id);
        (await alice.DeleteAsync($"/cellcountgroups/{group.Id}")).EnsureSuccessStatusCode();

        (await alice.PostAsync($"/changesets/{deletedCount.Id}/restore", null)).EnsureSuccessStatusCode();

        Assert.Null(await GroupOfAsync(alice, count));
    }

    [Fact]
    public async Task PuttingBackAMove_IntoAGroupThatsGone_LeavesItOutOfOne()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var count = await CountAsync(alice, id);
        var (first, second) = (await GroupAsync(alice, id, "First", count), await GroupAsync(alice, id, "Second"));
        (await alice.PutAsJsonAsync("/cellcounts/group", new CountGroupMoveRequest(id, [count], second.Id), Json)).EnsureSuccessStatusCode();
        var moved = await LatestChangeAsync(alice, id);
        (await alice.DeleteAsync($"/cellcountgroups/{first.Id}")).EnsureSuccessStatusCode();

        (await alice.PostAsync($"/changesets/{moved.Id}/restore", null)).EnsureSuccessStatusCode();

        Assert.Null(await GroupOfAsync(alice, count));
    }

    [Fact]
    public async Task GoingBackInTime_BringsGroupsAndWhatWasInThemBack()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var count = await CountAsync(alice, id);
        var group = await GroupAsync(alice, id, "Mitoses", count);
        var point = await LatestChangeAsync(alice, id);
        (await alice.DeleteAsync($"/cellcountgroups/{group.Id}")).EnsureSuccessStatusCode();
        await GroupAsync(alice, id, "Made after");

        var preview = (await alice.GetFromJsonAsync<RollbackView>($"/changesets/{point.Id}/rollback", Json))!;
        Assert.Equal(1, preview.Groups.Back);
        Assert.Equal(1, preview.Groups.Gone);

        var done = await alice.PostAsync($"/changesets/{point.Id}/rollback?latest={preview.Latest}", null);
        done.EnsureSuccessStatusCode();

        var groups = await GroupsAsync(alice, id);
        Assert.Equal(group.Id, Assert.Single(groups).Id);
        Assert.Equal(group.Id, await GroupOfAsync(alice, count));
    }

    [Fact]
    public async Task GoingBackInTime_ToBeforeAGroup_TakesItOut_AndTheCountsLeaveIt()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var count = await CountAsync(alice, id);
        var point = await LatestChangeAsync(alice, id);
        await GroupAsync(alice, id, "Mitoses", count);

        var preview = (await alice.GetFromJsonAsync<RollbackView>($"/changesets/{point.Id}/rollback", Json))!;
        (await alice.PostAsync($"/changesets/{point.Id}/rollback?latest={preview.Latest}", null)).EnsureSuccessStatusCode();

        Assert.Empty(await GroupsAsync(alice, id));
        Assert.Null(await GroupOfAsync(alice, count));
    }

    [Fact]
    public async Task OneCountsTimeline_CanGoBackToTheGroupItWasIn()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var count = await CountAsync(alice, id);
        var group = await GroupAsync(alice, id, "Mitoses", count);
        var inIt = (await alice.GetFromJsonAsync<ItemTimeline>($"/cellcounts/{count}/history?collectionId={id}", Json))!.Versions.First();
        (await alice.PutAsJsonAsync("/cellcounts/group", new CountGroupMoveRequest(id, [count]), Json)).EnsureSuccessStatusCode();

        (await alice.PostAsync($"/cellcounts/{count}/history/{inIt.Id}/restore", null)).EnsureSuccessStatusCode();
        Assert.Equal(group.Id, await GroupOfAsync(alice, count));

        (await alice.PutAsJsonAsync("/cellcounts/group", new CountGroupMoveRequest(id, [count]), Json)).EnsureSuccessStatusCode();
        (await alice.DeleteAsync($"/cellcountgroups/{group.Id}")).EnsureSuccessStatusCode();
        (await alice.PostAsync($"/cellcounts/{count}/history/{inIt.Id}/restore", null)).EnsureSuccessStatusCode();
        Assert.Null(await GroupOfAsync(alice, count));
    }

    [Fact]
    public async Task Merging_MovesWhatsInIt_JoinsTheNotes_AndRemovesIt()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (a, b) = (await CountAsync(alice, id), await CountAsync(alice, id));
        var (from, into) = (await GroupAsync(alice, id, "From", a), await GroupAsync(alice, id, "Into", b));
        await alice.PutAsJsonAsync($"/cellcountgroups/{from.Id}", new CountGroupUpdateRequest(Notes: "first"), Json);
        await alice.PutAsJsonAsync($"/cellcountgroups/{into.Id}", new CountGroupUpdateRequest(Notes: "second"), Json);

        var merged = await alice.PostAsJsonAsync($"/cellcountgroups/{from.Id}/merge", new GroupMergeRequest(into.Id), Json);

        merged.EnsureSuccessStatusCode();
        var view = (await merged.Content.ReadFromJsonAsync<CountGroupView>(Json))!;
        Assert.Equal((into.Id, 2, "second\n\nfirst"), (view.Id, view.Count, view.Notes));
        Assert.Equal(into.Id, await GroupOfAsync(alice, a));
        Assert.Equal(into.Id, Assert.Single(await GroupsAsync(alice, id)).Id);
        Assert.Equal("merge groups", (await LatestChangeAsync(alice, id)).What);
    }

    [Fact]
    public async Task Merging_NeedsAnotherGroupInTheSameCollection_AndAnEditor()
    {
        var alice = As("alice");
        var (mine, other) = (await OwnAsync(alice), await OwnAsync(alice));
        var (group, theirs) = (await GroupAsync(alice, mine), await GroupAsync(alice, other));
        Task<HttpResponseMessage> Merge(HttpClient client, Guid into) => client.PostAsJsonAsync($"/cellcountgroups/{group.Id}/merge", new GroupMergeRequest(into), Json);

        Assert.Equal(HttpStatusCode.BadRequest, (await Merge(alice, group.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Merge(alice, theirs.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Merge(As("bob"), theirs.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.PostAsJsonAsync($"/cellcountgroups/{Guid.NewGuid()}/merge", new GroupMergeRequest(group.Id), Json)).StatusCode);
    }

    [Fact]
    public async Task PuttingBackAMerge_SplitsThemAgain_AndTheNotes()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (a, b) = (await CountAsync(alice, id), await CountAsync(alice, id));
        var (from, into) = (await GroupAsync(alice, id, "From", a), await GroupAsync(alice, id, "Into", b));
        await alice.PutAsJsonAsync($"/cellcountgroups/{from.Id}", new CountGroupUpdateRequest(Notes: "first"), Json);
        (await alice.PostAsJsonAsync($"/cellcountgroups/{from.Id}/merge", new GroupMergeRequest(into.Id), Json)).EnsureSuccessStatusCode();
        var merge = await LatestChangeAsync(alice, id);
        Assert.Equal(1, merge.Deleted);

        (await alice.PostAsync($"/changesets/{merge.Id}/restore", null)).EnsureSuccessStatusCode();

        Assert.Equal(from.Id, await GroupOfAsync(alice, a));
        Assert.Equal(into.Id, await GroupOfAsync(alice, b));
        var groups = await GroupsAsync(alice, id);
        Assert.Equal("first", groups.Single(g => g.Id == from.Id).Notes);
        Assert.Equal("", groups.Single(g => g.Id == into.Id).Notes);
    }

    [Fact]
    public async Task ACountPutBack_FollowsItsGroupThroughAMerge()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var count = await CountAsync(alice, id);
        var (from, into) = (await GroupAsync(alice, id, "From", count), await GroupAsync(alice, id, "Into"));
        (await alice.DeleteAsync($"/cellcounts/{count}")).EnsureSuccessStatusCode();
        var deleted = await LatestChangeAsync(alice, id);
        (await alice.PostAsJsonAsync($"/cellcountgroups/{from.Id}/merge", new GroupMergeRequest(into.Id), Json)).EnsureSuccessStatusCode();

        (await alice.PostAsync($"/changesets/{deleted.Id}/restore", null)).EnsureSuccessStatusCode();

        Assert.Equal(into.Id, await GroupOfAsync(alice, count));
    }

    [Fact]
    public async Task Import_PutsCountsInGroupsByName_ReusingOnesThatExist()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var existing = await GroupAsync(alice, id, "Mitoses");
        var (a, b) = (new CellCount { Id = Guid.NewGuid(), Dots = "[]" }, new CellCount { Id = Guid.NewGuid(), Dots = "[]" });

        var response = await alice.PostAsJsonAsync($"/collections/{id}/import", new ImportRequest([], [a, b], null, null,
            [new ImportCellCountGroup("Mitoses", [a.Id], "From Bob"), new ImportCellCountGroup("Lymphocytes", [b.Id])]), Json);

        response.EnsureSuccessStatusCode();
        Assert.Equal(existing.Id, await GroupOfAsync(alice, a.Id));
        var groups = await GroupsAsync(alice, id);
        Assert.Equal(["Lymphocytes", "Mitoses"], groups.Select(g => g.Name));
        Assert.Equal("From Bob", groups.Single(g => g.Name == "Mitoses").Notes);
        Assert.Equal(2, (await response.Content.ReadFromJsonAsync<ImportResult>(Json))!.CellCountGroups!.Count);
    }

    [Fact]
    public async Task Import_IgnoresAGroupThatCameWithACount()
    {
        var alice = As("alice");
        var (mine, other) = (await OwnAsync(alice), await OwnAsync(alice));
        var theirs = await GroupAsync(alice, other);
        var count = new CellCount { Id = Guid.NewGuid(), Dots = "[]", GroupId = theirs.Id };

        (await alice.PostAsJsonAsync($"/collections/{mine}/import", new ImportRequest([], [count]), Json)).EnsureSuccessStatusCode();

        Assert.Null(await GroupOfAsync(alice, count.Id));
    }

    [Fact]
    public async Task Export_HasTheGroups()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var count = await CountAsync(alice, id);
        var group = await GroupAsync(alice, id, "Mitoses", count);

        var full = (await alice.GetFromJsonAsync<ExportView>($"/collections/{id}/export", Json))!;

        Assert.Equal(group.Id, Assert.Single(full.CellCountGroups).Id);
        Assert.Equal(group.Id, Assert.Single(full.CellCounts).GroupId);
    }

    [Fact]
    public async Task ACollectionDeleted_TakesItsGroupsWithItWhenRemoved_AndAGroupCantBeFoundAfter()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var group = await GroupAsync(alice, id);

        (await alice.DeleteAsync($"/collections/{id}")).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/cellcountgroups?collectionId={id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.PutAsJsonAsync($"/cellcountgroups/{group.Id}", new CountGroupUpdateRequest("No"), Json)).StatusCode);
    }
}
