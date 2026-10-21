using System.Net;
using System.Net.Http.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.ChangeSets;
using AnnotationStore.Collections;
using AnnotationStore.Paging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AnnotationStore.Tests;

// Deletes hide rows rather than remove them, every write goes in a change
// set, and a change set's deletes can be put back. See ChangeSets/.
public class SoftDeleteTests : IClassFixture<CellCountApiFactory>
{
    private static readonly System.Text.Json.JsonSerializerOptions Json = TestJson.Options;
    private const string Header = ChangeSetEndpoints.Header;

    private readonly CellCountApiFactory _factory;

    public SoftDeleteTests(CellCountApiFactory factory)
    {
        _factory = factory;
    }

    private HttpClient As(string userId) => TestAuthHandler.As(_factory.CreateClient(), userId, $"User {userId}");

    private static string NewSlide() => Guid.NewGuid().ToString();

    private static async Task<CollectionView> OwnAsync(HttpClient client, string? slideId = null)
    {
        var response = await client.PostAsJsonAsync("/collections/ensure", new EnsureRequest(slideId ?? NewSlide()));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CollectionView>(Json))!;
    }

    private static async Task<Annotation> AddAnnotationAsync(HttpClient client, Guid collectionId, string label = "a", Guid? groupId = null)
    {
        var response = await client.PostAsJsonAsync("/annotations",
            new Annotation { CollectionId = collectionId, Label = label, Colour = "#FF0000", Shape = "Box", GroupId = groupId });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<Annotation>(Json))!;
    }

    private static async Task<CellCount> AddCellCountAsync(HttpClient client, Guid collectionId)
    {
        var response = await client.PostAsJsonAsync("/cellcounts",
            new CellCount { CollectionId = collectionId, Label = "c", Dots = "[{\"x\":1,\"y\":2,\"colour\":\"#ff0000\"}]", Count = 1 });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CellCount>(Json))!;
    }

    private static async Task<ImageAdjustments.ImageAdjustments> AddAdjustmentAsync(HttpClient client, Guid collectionId)
    {
        var response = await client.PostAsJsonAsync("/imageadjustments",
            new ImageAdjustments.ImageAdjustments { CollectionId = collectionId, AdjustmentName = "p", Adjustments = "{}" });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ImageAdjustments.ImageAdjustments>(Json))!;
    }

    private static async Task<GroupView> AddGroupAsync(HttpClient client, Guid collectionId, string name = "g", List<Guid>? ids = null)
    {
        var response = await client.PostAsJsonAsync("/annotationgroups", new NewGroupRequest(collectionId, name, ids), Json);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<GroupView>(Json))!;
    }

    private static Guid ChangeSetOf(HttpResponseMessage response) =>
        Guid.Parse(response.Headers.GetValues(Header).Single());

    private static HttpRequestMessage InChangeSet(HttpMethod method, string url, Guid changeSet, object? body = null)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Add(Header, changeSet.ToString());
        if (body is not null) request.Content = JsonContent.Create(body, options: Json);
        return request;
    }

    private static Task<HttpResponseMessage> RestoreAsync(HttpClient client, Guid changeSet) =>
        client.PostAsync($"/changesets/{changeSet}/restore", null);

    private static async Task<List<Annotation>> AnnotationsAsync(HttpClient client, Guid collectionId) =>
        (await client.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={collectionId}", Json))!;

    private async Task<T> WithDbAsync<T>(Func<AnnotationDbContext, Task<T>> read)
    {
        using var scope = _factory.Services.CreateScope();
        return await read(scope.ServiceProvider.GetRequiredService<AnnotationDbContext>());
    }

    [Fact]
    public async Task DeletingAnAnnotation_HidesItEverywhere_ButKeepsTheRow()
    {
        var alice = As("alice");
        var collection = await OwnAsync(alice);
        var id = collection.CollectionId;
        var kept = await AddAnnotationAsync(alice, id, "kept");
        var gone = await AddAnnotationAsync(alice, id, "gone");

        var delete = await alice.DeleteAsync($"/annotations/{gone.Id}");
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);

        Assert.Equal([kept.Id], (await AnnotationsAsync(alice, id)).Select(a => a.Id));
        Assert.Equal([kept.Id], (await alice.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={id}&skip=0&take=10", Json))!.Select(a => a.Id));
        Assert.Equal(1, await alice.GetFromJsonAsync<int>($"/annotations/total?collectionId={id}"));
        var facets = (await alice.GetFromJsonAsync<SavedFacets>($"/annotations/facets?collectionId={id}", Json))!;
        Assert.Equal(1, Assert.Single(facets.Authors).Count);
        var export = (await alice.GetFromJsonAsync<ExportView>($"/collections/{id}/export", Json))!;
        Assert.Equal([kept.Id], export.Annotations.Select(a => a.Id));
        Assert.Equal([kept.Id], (await alice.GetFromJsonAsync<Collections.Collections>($"/collections/{id}", Json))!.Annotations.Select(a => a.Id));
        var listed = (await alice.GetFromJsonAsync<List<CollectionView>>($"/collections?slideId={collection.SlideId}", Json))!;
        Assert.Equal(1, Assert.Single(listed).AnnotationCount);

        var row = await WithDbAsync(db => db.Annotations.IgnoreQueryFilters().SingleAsync(a => a.Id == gone.Id));
        Assert.NotNull(row.Deleted);
        Assert.Equal(ChangeSetOf(delete), row.DeletedIn);
        Assert.Equal("gone", row.Label);
    }

    [Fact]
    public async Task ADeletedRow_CantBeChangedOrDeletedAgain()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var annotation = await AddAnnotationAsync(alice, id);
        var cellCount = await AddCellCountAsync(alice, id);
        var adjustment = await AddAdjustmentAsync(alice, id);
        var group = await AddGroupAsync(alice, id);
        var other = await AddGroupAsync(alice, id, "other");

        (await alice.DeleteAsync($"/annotations/{annotation.Id}")).EnsureSuccessStatusCode();
        (await alice.DeleteAsync($"/cellcounts/{cellCount.Id}")).EnsureSuccessStatusCode();
        (await alice.DeleteAsync($"/imageadjustments/{adjustment.ImageAdjustmentId}")).EnsureSuccessStatusCode();
        (await alice.DeleteAsync($"/annotationgroups/{group.Id}")).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.NotFound, (await alice.PutAsJsonAsync($"/annotations/{annotation.Id}", annotation)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.DeleteAsync($"/annotations/{annotation.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/cellcounts/{cellCount.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.PutAsJsonAsync($"/cellcounts/{cellCount.Id}", cellCount)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.DeleteAsync($"/cellcounts/{cellCount.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.PutAsJsonAsync($"/imageadjustments/{adjustment.ImageAdjustmentId}", adjustment)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.DeleteAsync($"/imageadjustments/{adjustment.ImageAdjustmentId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.PutAsJsonAsync($"/annotationgroups/{group.Id}", new GroupUpdateRequest("x"), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.DeleteAsync($"/annotationgroups/{group.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await alice.PostAsJsonAsync($"/annotationgroups/{group.Id}/merge", new GroupMergeRequest(other.Id), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await alice.PostAsJsonAsync($"/annotationgroups/{other.Id}/merge", new GroupMergeRequest(group.Id), Json)).StatusCode);
        // Nor can anything be put in a deleted group.
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.PostAsJsonAsync("/annotations",
            new Annotation { CollectionId = id, Label = "b", GroupId = group.Id })).StatusCode);

        Assert.Empty((await alice.GetFromJsonAsync<List<CellCountListItem>>($"/cellcounts?collectionId={id}", Json))!);
        Assert.Empty((await alice.GetFromJsonAsync<List<ImageAdjustments.ImageAdjustments>>($"/imageadjustments?collectionId={id}", Json))!);
        Assert.Equal([other.Id], (await alice.GetFromJsonAsync<List<GroupView>>($"/annotationgroups?collectionId={id}", Json))!.Select(g => g.Id));
    }

    [Fact]
    public async Task ABulkDeleteInBatches_IsOneChangeSet_AndOneRestorePutsItAllBack()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var ids = new List<Guid>();
        for (var i = 0; i < 5; i++) ids.Add((await AddAnnotationAsync(alice, id, $"a{i}")).Id);
        var untouched = await AddAnnotationAsync(alice, id, "untouched");
        var changeSet = Guid.NewGuid();

        var first = await alice.SendAsync(InChangeSet(HttpMethod.Post, "/annotations/bulk-delete", changeSet, new BulkDeleteRequest(id, ids[..3])));
        var second = await alice.SendAsync(InChangeSet(HttpMethod.Post, "/annotations/bulk-delete", changeSet, new BulkDeleteRequest(id, ids[3..])));
        Assert.Equal(3, (await first.Content.ReadFromJsonAsync<BulkResult>(Json))!.Count);
        Assert.Equal(2, (await second.Content.ReadFromJsonAsync<BulkResult>(Json))!.Count);
        Assert.Equal(changeSet, ChangeSetOf(first));
        Assert.Equal(changeSet, ChangeSetOf(second));
        Assert.Equal([untouched.Id], (await AnnotationsAsync(alice, id)).Select(a => a.Id));
        Assert.Equal(1, await WithDbAsync(db => db.ChangeSets.CountAsync(c => c.Id == changeSet)));

        var restore = await RestoreAsync(alice, changeSet);
        Assert.Equal(HttpStatusCode.OK, restore.StatusCode);
        Assert.Equal(new RestoreResult(5, 0, 0, 0, false), await restore.Content.ReadFromJsonAsync<RestoreResult>(Json));
        Assert.Equal(ids.Append(untouched.Id).Order(), (await AnnotationsAsync(alice, id)).Select(a => a.Id).Order());
        Assert.False(await WithDbAsync(db => db.Annotations.IgnoreQueryFilters().AnyAsync(a => a.CollectionId == id && (a.Deleted != null || a.DeletedIn != null))));

        // Nothing's left to put back the second time.
        Assert.Equal(new RestoreResult(0, 0, 0, 0, false),
            await (await RestoreAsync(alice, changeSet)).Content.ReadFromJsonAsync<RestoreResult>(Json));
    }

    // What the viewer does with a big delete - every batch at once, one id.
    [PostgresFact]
    public async Task BatchesSentAtOnce_StillMakeOneChangeSet()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var ids = new List<Guid>();
        for (var i = 0; i < 100; i++) ids.Add((await AddAnnotationAsync(alice, id, $"a{i}")).Id);
        var changeSet = Guid.NewGuid();

        var responses = await Task.WhenAll(ids.Chunk(1).Select(batch =>
            alice.SendAsync(InChangeSet(HttpMethod.Post, "/annotations/bulk-delete", changeSet, new BulkDeleteRequest(id, [.. batch])))));

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Equal(1, await WithDbAsync(db => db.ChangeSets.CountAsync(c => c.Id == changeSet)));
        Assert.Equal(100, (await (await RestoreAsync(alice, changeSet)).Content.ReadFromJsonAsync<RestoreResult>(Json))!.Annotations);
    }

    [Fact]
    public async Task Restore_OnlyPutsBackItsOwnChangeSet()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var a = await AddAnnotationAsync(alice, id, "a");
        var b = await AddAnnotationAsync(alice, id, "b");
        var count = await AddCellCountAsync(alice, id);
        var adjustment = await AddAdjustmentAsync(alice, id);

        var deleteA = ChangeSetOf(await alice.DeleteAsync($"/annotations/{a.Id}"));
        await alice.DeleteAsync($"/annotations/{b.Id}");
        var deleteCount = ChangeSetOf(await alice.DeleteAsync($"/cellcounts/{count.Id}"));
        var deleteAdjustment = ChangeSetOf(await alice.DeleteAsync($"/imageadjustments/{adjustment.ImageAdjustmentId}"));

        Assert.Equal(new RestoreResult(1, 0, 0, 0, false), await (await RestoreAsync(alice, deleteA)).Content.ReadFromJsonAsync<RestoreResult>(Json));
        Assert.Equal([a.Id], (await AnnotationsAsync(alice, id)).Select(x => x.Id));

        Assert.Equal(new RestoreResult(0, 0, 1, 0, false), await (await RestoreAsync(alice, deleteCount)).Content.ReadFromJsonAsync<RestoreResult>(Json));
        Assert.Equal(count.Id, (await alice.GetFromJsonAsync<CellCount>($"/cellcounts/{count.Id}", Json))!.Id);

        Assert.Equal(new RestoreResult(0, 0, 0, 1, false), await (await RestoreAsync(alice, deleteAdjustment)).Content.ReadFromJsonAsync<RestoreResult>(Json));
        Assert.Single((await alice.GetFromJsonAsync<List<ImageAdjustments.ImageAdjustments>>($"/imageadjustments?collectionId={id}", Json))!);
    }

    [Fact]
    public async Task Restore_IsForEditors_OfThatCollection()
    {
        var alice = As("alice");
        var start = await alice.PostAsJsonAsync("/sessions", new EnsureRequest(NewSlide()));
        var session = (await start.Content.ReadFromJsonAsync<CollectionView>(Json))!;
        var invite = await alice.PostAsJsonAsync($"/collections/{session.CollectionId}/invites", new InviteRequest(CollectionRole.Viewer, 24), Json);
        var code = (await invite.Content.ReadFromJsonAsync<InviteView>(Json))!.Code;
        (await As("bob").PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();
        var annotation = await AddAnnotationAsync(alice, session.CollectionId);
        var changeSet = ChangeSetOf(await alice.DeleteAsync($"/annotations/{annotation.Id}"));

        Assert.Equal(HttpStatusCode.Forbidden, (await RestoreAsync(As("bob"), changeSet)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await RestoreAsync(As("carol"), changeSet)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await RestoreAsync(alice, Guid.NewGuid())).StatusCode);

        (await alice.PostAsync($"/collections/{session.CollectionId}/end", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await RestoreAsync(alice, changeSet)).StatusCode);
        Assert.Empty(await AnnotationsAsync(alice, session.CollectionId));
    }

    [Fact]
    public async Task AnyEditor_CanRestoreSomeoneElsesDelete()
    {
        var alice = As("alice");
        var bob = As("bob");
        var start = await alice.PostAsJsonAsync("/sessions", new EnsureRequest(NewSlide()));
        var id = (await start.Content.ReadFromJsonAsync<CollectionView>(Json))!.CollectionId;
        var invite = await alice.PostAsJsonAsync($"/collections/{id}/invites", new InviteRequest(CollectionRole.Editor, 24), Json);
        (await bob.PostAsync($"/invites/{(await invite.Content.ReadFromJsonAsync<InviteView>(Json))!.Code}/accept", null)).EnsureSuccessStatusCode();
        var annotation = await AddAnnotationAsync(alice, id);

        var changeSet = ChangeSetOf(await alice.DeleteAsync($"/annotations/{annotation.Id}"));
        var restore = await RestoreAsync(bob, changeSet);

        Assert.Equal(HttpStatusCode.OK, restore.StatusCode);
        Assert.Single(await AnnotationsAsync(alice, id));
        // The restore is bob's change, in a change set of its own.
        var restoring = ChangeSetOf(restore);
        Assert.NotEqual(changeSet, restoring);
        var row = await WithDbAsync(db => db.ChangeSets.SingleAsync(c => c.Id == restoring));
        Assert.Equal(("bob", "restore"), (row.UserId, row.What));
    }

    [Fact]
    public async Task EveryWrite_GoesInAChangeSet_WithWhoAndWhat()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;

        var post = await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "a" });
        var annotation = (await post.Content.ReadFromJsonAsync<Annotation>(Json))!;
        var put = await alice.PutAsJsonAsync($"/annotations/{annotation.Id}", annotation);
        var bulk = await alice.PutAsJsonAsync("/annotations/bulk", new BulkUpdateRequest(id, [annotation.Id], Colour: "#00FF00"), Json);
        var group = await alice.PostAsJsonAsync("/annotationgroups", new NewGroupRequest(id, "g"), Json);
        var groupId = (await group.Content.ReadFromJsonAsync<GroupView>(Json))!.Id;
        var rename = await alice.PutAsJsonAsync($"/annotationgroups/{groupId}", new GroupUpdateRequest("h"), Json);
        var count = await alice.PostAsJsonAsync("/cellcounts", new CellCount { CollectionId = id, Dots = "[]" });
        var countId = (await count.Content.ReadFromJsonAsync<CellCount>(Json))!.Id;
        var countPut = await alice.PutAsJsonAsync($"/cellcounts/{countId}", new CellCount { CollectionId = id, Label = "c" });
        var adjustment = await alice.PostAsJsonAsync("/imageadjustments",
            new ImageAdjustments.ImageAdjustments { CollectionId = id, AdjustmentName = "p", Adjustments = "{}" });
        var import = await alice.PostAsJsonAsync($"/collections/{id}/import", new ImportRequest([new Annotation { Label = "i" }], []), Json);

        var responses = new[] { post, put, bulk, group, rename, count, countPut, adjustment, import };
        foreach (var response in responses) response.EnsureSuccessStatusCode();
        var ids = responses.Select(ChangeSetOf).ToList();
        Assert.Equal(ids.Count, ids.Distinct().Count());

        var rows = await WithDbAsync(db => db.ChangeSets.Where(c => c.CollectionId == id).ToListAsync());
        Assert.Equal(ids.Order(), rows.Select(r => r.Id).Order());
        Assert.All(rows, r => Assert.Equal(("alice", "User alice"), (r.UserId, r.UserName)));
        Assert.Equal(
            ["add annotation", "change annotation", "change annotations", "add group", "change group", "add cell count", "change cell count", "add image adjustment", "import"],
            ids.Select(changeSetId => rows.Single(r => r.Id == changeSetId).What));
    }

    [Fact]
    public async Task AChangeSetId_IsOnePersonInOneCollection()
    {
        var alice = As("alice");
        var bob = As("bob");
        var mine = (await OwnAsync(alice)).CollectionId;
        var other = (await OwnAsync(alice)).CollectionId;
        var bobs = (await OwnAsync(bob)).CollectionId;
        var changeSet = Guid.NewGuid();

        var first = await alice.SendAsync(InChangeSet(HttpMethod.Post, "/annotations", changeSet, new Annotation { CollectionId = mine }));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest,
            (await alice.SendAsync(InChangeSet(HttpMethod.Post, "/annotations", changeSet, new Annotation { CollectionId = other }))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await bob.SendAsync(InChangeSet(HttpMethod.Post, "/annotations", changeSet, new Annotation { CollectionId = bobs }))).StatusCode);
        Assert.Single(await AnnotationsAsync(alice, mine));
        Assert.Empty(await AnnotationsAsync(alice, other));
        Assert.Empty(await AnnotationsAsync(bob, bobs));

        var bad = new HttpRequestMessage(HttpMethod.Post, "/annotations") { Content = JsonContent.Create(new Annotation { CollectionId = mine }) };
        bad.Headers.TryAddWithoutValidation(Header, "not-a-guid");
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.SendAsync(bad)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await alice.SendAsync(InChangeSet(HttpMethod.Post, "/annotations", Guid.Empty, new Annotation { CollectionId = mine }))).StatusCode);
        Assert.Single(await AnnotationsAsync(alice, mine));
    }

    [Fact]
    public async Task ATurnedDownWrite_LeavesNoChangeSet()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var changeSet = Guid.NewGuid();

        var refused = await As("bob").SendAsync(InChangeSet(HttpMethod.Post, "/annotations", changeSet, new Annotation { CollectionId = id }));
        var invalid = await alice.SendAsync(InChangeSet(HttpMethod.Post, "/annotationgroups", changeSet, new NewGroupRequest(id, " ")));

        Assert.Equal(HttpStatusCode.NotFound, refused.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.False(await WithDbAsync(db => db.ChangeSets.AnyAsync(c => c.Id == changeSet)));
    }

    [Fact]
    public async Task APost_CantMakeAHiddenRow()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var body = new Dictionary<string, object?>
        {
            ["collectionId"] = id,
            ["label"] = "sneaky",
            ["deleted"] = DateTimeOffset.UtcNow,
            ["deletedIn"] = Guid.NewGuid(),
        };

        var response = await alice.PostAsJsonAsync("/annotations", body);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.DoesNotContain("deleted", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        Assert.Equal("sneaky", Assert.Single(await AnnotationsAsync(alice, id)).Label);
    }

    [Fact]
    public async Task DeletingAGroup_UngroupsDeletedAnnotationsToo_AndComesBackEmpty()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var a = await AddAnnotationAsync(alice, id, "a");
        var b = await AddAnnotationAsync(alice, id, "b");
        var group = await AddGroupAsync(alice, id, "g", [a.Id, b.Id]);
        var deleteA = ChangeSetOf(await alice.DeleteAsync($"/annotations/{a.Id}"));

        var deleteGroup = ChangeSetOf(await alice.DeleteAsync($"/annotationgroups/{group.Id}"));
        await RestoreAsync(alice, deleteA);

        Assert.All(await AnnotationsAsync(alice, id), x => Assert.Null(x.GroupId));
        Assert.Equal(new RestoreResult(0, 1, 0, 0, false),
            await (await RestoreAsync(alice, deleteGroup)).Content.ReadFromJsonAsync<RestoreResult>(Json));
        var back = Assert.Single((await alice.GetFromJsonAsync<List<GroupView>>($"/annotationgroups?collectionId={id}", Json))!);
        Assert.Equal((group.Id, 0), (back.Id, back.Count));
    }

    [Fact]
    public async Task Merging_HidesTheOldGroup_AndMovesDeletedAnnotationsToo()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var a = await AddAnnotationAsync(alice, id, "a");
        var from = await AddGroupAsync(alice, id, "from", [a.Id]);
        var into = await AddGroupAsync(alice, id, "into");
        var deleteA = ChangeSetOf(await alice.DeleteAsync($"/annotations/{a.Id}"));

        var merge = await alice.PostAsJsonAsync($"/annotationgroups/{from.Id}/merge", new GroupMergeRequest(into.Id), Json);
        merge.EnsureSuccessStatusCode();
        await RestoreAsync(alice, deleteA);

        Assert.Equal(into.Id, Assert.Single(await AnnotationsAsync(alice, id)).GroupId);
        Assert.Equal([into.Id], (await alice.GetFromJsonAsync<List<GroupView>>($"/annotationgroups?collectionId={id}", Json))!.Select(g => g.Id));
        var old = await WithDbAsync(db => db.AnnotationGroups.IgnoreQueryFilters().SingleAsync(g => g.Id == from.Id));
        Assert.Equal(ChangeSetOf(merge), old.DeletedIn);
    }

    [Fact]
    public async Task ADeletedCollection_CanBeRestoredByItsOwner_WithEverythingInIt()
    {
        var alice = As("alice");
        var bob = As("bob");
        var slideId = NewSlide();
        var start = await alice.PostAsJsonAsync("/sessions", new EnsureRequest(slideId));
        var id = (await start.Content.ReadFromJsonAsync<CollectionView>(Json))!.CollectionId;
        var invite = await alice.PostAsJsonAsync($"/collections/{id}/invites", new InviteRequest(CollectionRole.Editor, 24), Json);
        (await bob.PostAsync($"/invites/{(await invite.Content.ReadFromJsonAsync<InviteView>(Json))!.Code}/accept", null)).EnsureSuccessStatusCode();
        var annotation = await AddAnnotationAsync(alice, id);
        await AddCellCountAsync(alice, id);

        var changeSet = ChangeSetOf(await alice.DeleteAsync($"/collections/{id}"));
        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/annotations?collectionId={id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/changesets?collectionId={id}")).StatusCode);

        Assert.Equal(HttpStatusCode.NotFound, (await RestoreAsync(bob, changeSet)).StatusCode);
        var restore = await RestoreAsync(alice, changeSet);

        Assert.Equal(new RestoreResult(0, 0, 0, 0, true), await restore.Content.ReadFromJsonAsync<RestoreResult>(Json));
        Assert.Equal([annotation.Id], (await AnnotationsAsync(alice, id)).Select(a => a.Id));
        Assert.Single((await alice.GetFromJsonAsync<List<CellCountListItem>>($"/cellcounts?collectionId={id}", Json))!);
        var membership = (await bob.GetFromJsonAsync<MembershipView>($"/collections/{id}/membership", Json))!;
        Assert.Equal(CollectionRole.Editor, membership.Role);
    }

    [Fact]
    public async Task DeletingYourCollection_LetsEnsureMakeANewOne_AndTheOldOneCantComeBackOverIt()
    {
        var alice = As("alice");
        var slideId = NewSlide();
        var old = await OwnAsync(alice, slideId);
        await AddAnnotationAsync(alice, old.CollectionId);

        var changeSet = ChangeSetOf(await alice.DeleteAsync($"/collections/{old.CollectionId}"));
        var fresh = await OwnAsync(alice, slideId);

        Assert.NotEqual(old.CollectionId, fresh.CollectionId);
        Assert.Empty(await AnnotationsAsync(alice, fresh.CollectionId));
        Assert.Equal(HttpStatusCode.Conflict, (await RestoreAsync(alice, changeSet)).StatusCode);

        // Once the new one's gone too, the old one can come back.
        await alice.DeleteAsync($"/collections/{fresh.CollectionId}");
        Assert.Equal(HttpStatusCode.OK, (await RestoreAsync(alice, changeSet)).StatusCode);
        Assert.Equal(old.CollectionId, (await OwnAsync(alice, slideId)).CollectionId);
    }

    [Fact]
    public async Task ChangeSets_AreListedNewestFirst_WithWhatTheyStillHaveDeleted()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var a = await AddAnnotationAsync(alice, id, "a");
        var b = await AddAnnotationAsync(alice, id, "b");
        var bulkDelete = ChangeSetOf(await alice.PostAsJsonAsync("/annotations/bulk-delete", new BulkDeleteRequest(id, [a.Id, b.Id]), Json));

        var listed = (await alice.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}", Json))!;

        Assert.Equal(["delete annotations", "add annotation", "add annotation"], listed.Select(c => c.What));
        Assert.Equal(bulkDelete, listed[0].Id);
        Assert.Equal([2, 0, 0], listed.Select(c => c.Deleted));
        Assert.Equal(2, (await alice.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}&skip=1&take=5", Json))!.Count);
        Assert.Equal(HttpStatusCode.NotFound, (await As("bob").GetAsync($"/changesets?collectionId={id}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.GetAsync($"/changesets?collectionId={id}&take=0")).StatusCode);

        await RestoreAsync(alice, bulkDelete);
        listed = (await alice.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}", Json))!;
        Assert.Equal(("restore", 0), (listed[0].What, listed[1].Deleted));
    }
}
