using System.Net;
using System.Net.Http.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using AnnotationStore.History;
using AnnotationStore.Paging;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AnnotationStore.Tests;

// Every write goes in a change set, what it did to each row is kept in the
// history schema, the live tables only ever hold what's there now, and a
// change set can be put back. See History/.
public class HistoryTests : IClassFixture<CellCountApiFactory>
{
    private static readonly System.Text.Json.JsonSerializerOptions Json = TestJson.Options;
    private const string Header = ChangeSetEndpoints.Header;

    private readonly CellCountApiFactory _factory;

    public HistoryTests(CellCountApiFactory factory)
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

    private static async Task<RestoreResult> CountsAsync(HttpResponseMessage restore) =>
        (await restore.Content.ReadFromJsonAsync<RestoredView>(Json))!.Counts;

    private static async Task<List<Annotation>> AnnotationsAsync(HttpClient client, Guid collectionId) =>
        (await client.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={collectionId}", Json))!;

    private async Task<T> WithDbAsync<T>(Func<AnnotationDbContext, Task<T>> read)
    {
        using var scope = _factory.Services.CreateScope();
        return await read(scope.ServiceProvider.GetRequiredService<AnnotationDbContext>());
    }

    private Task<List<HistoryEntry>> EntriesAsync(Guid changeSet) =>
        WithDbAsync(db => db.HistoryEntries.Where(e => e.ChangeSetId == changeSet).OrderBy(e => e.Id).ToListAsync());

    private static Dictionary<string, string> Columns(string? json) =>
        System.Text.Json.JsonDocument.Parse(json!).RootElement.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.ToString());

    [Fact]
    public async Task DeletingAnAnnotation_TakesItOutOfTheLiveTable_AndKeepsTheWholeRowInHistory()
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

        Assert.False(await WithDbAsync(db => db.Annotations.AnyAsync(a => a.Id == gone.Id)));
        var entry = Assert.Single(await EntriesAsync(ChangeSetOf(delete)));
        Assert.Equal((HistoryLog.Annotation, gone.Id, HistoryOp.Delete, id), (entry.Entity, entry.EntityId, entry.Op, entry.CollectionId));
        var before = Columns(entry.Before);
        Assert.Equal(("gone", "#FF0000", "Box"), (before["Label"], before["Colour"], before["Shape"]));
        Assert.Null(entry.After);
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
        Assert.Equal(new RestoreResult(5, 0, 0, 0, false), await CountsAsync(restore));
        Assert.Equal(ids.Append(untouched.Id).Order(), (await AnnotationsAsync(alice, id)).Select(a => a.Id).Order());
        Assert.Equal(5, (await EntriesAsync(changeSet)).Count(e => e.Op == HistoryOp.Delete));

        // Nothing's left to put back the second time.
        Assert.Equal(new RestoreResult(0, 0, 0, 0, false),
            await CountsAsync(await RestoreAsync(alice, changeSet)));
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
        Assert.Equal(100, (await CountsAsync(await RestoreAsync(alice, changeSet))).Annotations);
    }

    // Two people pressing Put back on the same change at once.
    [PostgresFact]
    public async Task RestoresAtTheSameMoment_PutItBackOnce_AndNeitherFails()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var ids = new List<Guid>();
        for (var i = 0; i < 50; i++) ids.Add((await AddAnnotationAsync(alice, id, $"a{i}")).Id);
        var delete = ChangeSetOf(await alice.PostAsJsonAsync("/annotations/bulk-delete", new BulkDeleteRequest(id, ids), Json));

        var responses = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => RestoreAsync(alice, delete)));

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        var counts = await Task.WhenAll(responses.Select(CountsAsync));
        Assert.Equal(50, counts.Sum(c => c.Annotations));
        Assert.Equal(ids.Order(), (await AnnotationsAsync(alice, id)).Select(a => a.Id).Order());
    }

    // Deleted, put back, then deleted again by a later change: the first
    // delete has nothing left of its own to put back - doing it would undo
    // the later one.
    [Fact]
    public async Task ARowDeletedAgainLater_BelongsToTheLaterDelete_NotTheFirst()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var a = await AddAnnotationAsync(alice, id, "a");
        var b = await AddAnnotationAsync(alice, id, "b");
        var first = ChangeSetOf(await alice.PostAsJsonAsync("/annotations/bulk-delete", new BulkDeleteRequest(id, [a.Id, b.Id]), Json));
        await RestoreAsync(alice, first);
        var second = ChangeSetOf(await alice.DeleteAsync($"/annotations/{a.Id}"));

        var listed = (await alice.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}", Json))!.ToDictionary(c => c.Id, c => c.Deleted);
        Assert.Equal(0, listed[first]);
        Assert.Equal(1, listed[second]);

        Assert.Equal(new RestoreResult(0, 0, 0, 0, false), await CountsAsync(await RestoreAsync(alice, first)));
        Assert.Equal([b.Id], (await AnnotationsAsync(alice, id)).Select(x => x.Id));

        Assert.Equal(1, (await CountsAsync(await RestoreAsync(alice, second))).Annotations);
        Assert.Equal([a.Id, b.Id], (await AnnotationsAsync(alice, id)).Select(x => x.Id).Order());
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

        Assert.Equal(new RestoreResult(1, 0, 0, 0, false), await CountsAsync(await RestoreAsync(alice, deleteA)));
        Assert.Equal([a.Id], (await AnnotationsAsync(alice, id)).Select(x => x.Id));

        Assert.Equal(new RestoreResult(0, 0, 1, 0, false), await CountsAsync(await RestoreAsync(alice, deleteCount)));
        Assert.Equal(count.Id, (await alice.GetFromJsonAsync<CellCount>($"/cellcounts/{count.Id}", Json))!.Id);

        Assert.Equal(new RestoreResult(0, 0, 0, 1, false), await CountsAsync(await RestoreAsync(alice, deleteAdjustment)));
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
    public async Task APost_CantSetHistoryFields_SinceThereArentAny()
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
    public async Task PuttingBackADeletedGroup_PutsWhatWasInItBackInIt()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var a = await AddAnnotationAsync(alice, id, "a");
        var b = await AddAnnotationAsync(alice, id, "b");
        var c = await AddAnnotationAsync(alice, id, "c");
        var group = await AddGroupAsync(alice, id, "g", [a.Id, b.Id, c.Id]);
        var deleteA = ChangeSetOf(await alice.DeleteAsync($"/annotations/{a.Id}"));
        var deleteGroup = ChangeSetOf(await alice.DeleteAsync($"/annotationgroups/{group.Id}"));
        Assert.All(await AnnotationsAsync(alice, id), x => Assert.Null(x.GroupId));

        // Moved out of the group by someone since - stays where they put it.
        var other = await AddGroupAsync(alice, id, "other", [c.Id]);
        var restore = await RestoreAsync(alice, deleteGroup);
        var restored = (await restore.Content.ReadFromJsonAsync<RestoredView>(Json))!;

        Assert.Equal(new RestoreResult(0, 1, 0, 0, false), restored.Counts);
        Assert.Equal([b.Id], restored.ChangedAnnotations.Select(x => x.Id));
        var now = (await AnnotationsAsync(alice, id)).ToDictionary(x => x.Id, x => x.GroupId);
        Assert.Equal(group.Id, now[b.Id]);
        Assert.Equal(other.Id, now[c.Id]);

        // a was deleted before the group was, so it comes back in it.
        await RestoreAsync(alice, deleteA);
        Assert.Equal(group.Id, (await AnnotationsAsync(alice, id)).Single(x => x.Id == a.Id).GroupId);
    }

    [Fact]
    public async Task AnAnnotationPutBackAfterItsGroupWasDeleted_ComesBackUngrouped()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var a = await AddAnnotationAsync(alice, id, "a");
        var group = await AddGroupAsync(alice, id, "g", [a.Id]);
        var deleteA = ChangeSetOf(await alice.DeleteAsync($"/annotations/{a.Id}"));
        await alice.DeleteAsync($"/annotationgroups/{group.Id}");

        Assert.Equal(HttpStatusCode.OK, (await RestoreAsync(alice, deleteA)).StatusCode);
        Assert.Null(Assert.Single(await AnnotationsAsync(alice, id)).GroupId);
    }

    [Fact]
    public async Task Merging_TakesTheOldGroupOut_AndAnAnnotationPutBackLaterFollowsIt()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var a = await AddAnnotationAsync(alice, id, "a");
        var b = await AddAnnotationAsync(alice, id, "b");
        var from = await AddGroupAsync(alice, id, "from", [a.Id, b.Id]);
        var into = await AddGroupAsync(alice, id, "into");
        var deleteA = ChangeSetOf(await alice.DeleteAsync($"/annotations/{a.Id}"));

        var merge = await alice.PostAsJsonAsync($"/annotationgroups/{from.Id}/merge", new GroupMergeRequest(into.Id), Json);
        merge.EnsureSuccessStatusCode();
        await RestoreAsync(alice, deleteA);

        Assert.All(await AnnotationsAsync(alice, id), x => Assert.Equal(into.Id, x.GroupId));
        Assert.Equal([into.Id], (await alice.GetFromJsonAsync<List<GroupView>>($"/annotationgroups?collectionId={id}", Json))!.Select(g => g.Id));
        var entries = await EntriesAsync(ChangeSetOf(merge));
        var gone = Assert.Single(entries, e => e.Op == HistoryOp.Delete);
        Assert.Equal(from.Id, gone.EntityId);
        Assert.Equal(into.Id, HistoryLog.MergedInto(gone));
        var moved = Assert.Single(entries, e => e.Op == HistoryOp.Update && e.Entity == HistoryLog.Annotation);
        Assert.Equal(b.Id, moved.EntityId);
    }

    [Fact]
    public async Task AnEdit_KeepsOnlyTheColumnsThatChanged()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var annotation = await AddAnnotationAsync(alice, id, "Region 4");

        var put = await alice.PutAsJsonAsync($"/annotations/{annotation.Id}",
            new Annotation { Label = "Region 4 (checked)", Notes = "", Colour = annotation.Colour });
        put.EnsureSuccessStatusCode();

        var entry = Assert.Single(await EntriesAsync(ChangeSetOf(put)));
        Assert.Equal((HistoryLog.Annotation, annotation.Id, HistoryOp.Update), (entry.Entity, entry.EntityId, entry.Op));
        Assert.Equal(new Dictionary<string, string> { ["Label"] = "Region 4" }, Columns(entry.Before));
        Assert.Equal(new Dictionary<string, string> { ["Label"] = "Region 4 (checked)" }, Columns(entry.After));
    }

    [Fact]
    public async Task SavingWhatsAlreadyThere_IsntAChange()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var annotation = await AddAnnotationAsync(alice, id, "same");

        var put = await alice.PutAsJsonAsync($"/annotations/{annotation.Id}",
            new Annotation { Label = "same", Notes = annotation.Notes, Colour = annotation.Colour });

        Assert.Empty(await EntriesAsync(ChangeSetOf(put)));
    }

    [Fact]
    public async Task AddingSomething_IsLoggedWithoutCopyingIt()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var post = await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "new" });
        var annotation = (await post.Content.ReadFromJsonAsync<Annotation>(Json))!;

        var entry = Assert.Single(await EntriesAsync(ChangeSetOf(post)));
        Assert.Equal((HistoryLog.Annotation, annotation.Id, HistoryOp.Create), (entry.Entity, entry.EntityId, entry.Op));
        Assert.Null(entry.Before);
        Assert.Null(entry.After);
    }

    [Fact]
    public async Task PuttingBackARecolour_UndoesIt_ButNeverALaterEdit()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var a = await AddAnnotationAsync(alice, id, "a");
        var b = await AddAnnotationAsync(alice, id, "b");
        var recolour = await alice.PutAsJsonAsync("/annotations/bulk", new BulkUpdateRequest(id, [a.Id, b.Id], Colour: "#00FF00"), Json);
        recolour.EnsureSuccessStatusCode();
        Assert.Equal(2, (await EntriesAsync(ChangeSetOf(recolour))).Count);

        // Someone recolours b again afterwards.
        (await alice.PutAsJsonAsync($"/annotations/{b.Id}", new Annotation { Label = "b", Notes = "", Colour = "#0000FF" })).EnsureSuccessStatusCode();
        var restore = await RestoreAsync(alice, ChangeSetOf(recolour));

        var now = (await AnnotationsAsync(alice, id)).ToDictionary(x => x.Id, x => x.Colour);
        Assert.Equal("#FF0000", now[a.Id]);
        Assert.Equal("#0000FF", now[b.Id]);
        var restored = (await restore.Content.ReadFromJsonAsync<RestoredView>(Json))!;
        Assert.Equal([a.Id], restored.ChangedAnnotations.Select(x => x.Id));
    }

    [Fact]
    public async Task ADeletedCellCount_KeepsItsDotsAndRegion_AndComesBackWithBoth()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var post = await alice.PostAsJsonAsync("/cellcounts", new CellCount
        {
            CollectionId = id, Label = "c", Count = 2, WithRoi = true,
            Dots = "[{\"x\":1,\"y\":2,\"colour\":\"#ff0000\"},{\"x\":3,\"y\":4,\"colour\":\"#00ff00\"}]",
            RegionOfInterest = new RegionOfInterest { GeoJson = "{\"type\":\"Polygon\"}" },
        });
        var count = (await post.Content.ReadFromJsonAsync<CellCount>(Json))!;

        var delete = ChangeSetOf(await alice.DeleteAsync($"/cellcounts/{count.Id}"));
        Assert.False(await WithDbAsync(db => db.RegionsOfInterest.AnyAsync(r => r.CellCountId == count.Id)));
        Assert.Equal([HistoryLog.CellCount, HistoryLog.RegionOfInterest], (await EntriesAsync(delete)).Select(e => e.Entity).Order());
        await RestoreAsync(alice, delete);

        var back = (await alice.GetFromJsonAsync<CellCount>($"/cellcounts/{count.Id}", Json))!;
        Assert.Equal(count.Dots, back.Dots);
        // Postgres keeps microseconds, .NET's answer had ticks.
        Assert.True(Math.Abs((back.Created - count.Created).TotalMilliseconds) < 1);
        Assert.Equal("{\"type\":\"Polygon\"}", back.RegionOfInterest!.GeoJson);
    }

    [Fact]
    public void TheLiveTables_HaveNoHistoryColumns()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
        foreach (var type in HistoryLog.Entities.Keys)
        {
            var columns = db.Model.FindEntityType(type)!.GetProperties().Select(p => p.Name).ToList();
            Assert.DoesNotContain("Deleted", columns);
            Assert.DoesNotContain("DeletedIn", columns);
        }
        Assert.Equal("history", db.Model.FindEntityType(typeof(HistoryEntry))!.GetSchema() ?? "history");
    }

    [Fact]
    public async Task ChangingSomethingVersioned_WithoutAChangeSet_Throws()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var annotation = await AddAnnotationAsync(alice, id);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
        var row = await db.Annotations.SingleAsync(a => a.Id == annotation.Id);
        row.Label = "behind its back";

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
        Assert.Contains("change set", error.Message);
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

        Assert.Equal(new RestoreResult(0, 0, 0, 0, true), await CountsAsync(restore));
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

    // A session alice and bob both edit: alice adds two and recolours them,
    // bob adds one, groups it, then deletes it. Oldest first, that's add,
    // add, change annotations, add, add group, delete annotation.
    private async Task<(Guid Id, HttpClient Alice, HttpClient Bob, Guid BobsDelete)> TwoPeopleAsync()
    {
        var alice = As("alice");
        var bob = As("bob");
        var start = await alice.PostAsJsonAsync("/sessions", new EnsureRequest(NewSlide()));
        var id = (await start.Content.ReadFromJsonAsync<CollectionView>(Json))!.CollectionId;
        var invite = await alice.PostAsJsonAsync($"/collections/{id}/invites", new InviteRequest(CollectionRole.Editor, 24), Json);
        (await bob.PostAsync($"/invites/{(await invite.Content.ReadFromJsonAsync<InviteView>(Json))!.Code}/accept", null)).EnsureSuccessStatusCode();
        var a = await AddAnnotationAsync(alice, id, "a");
        var b = await AddAnnotationAsync(alice, id, "b");
        (await alice.PutAsJsonAsync("/annotations/bulk", new BulkUpdateRequest(id, [a.Id, b.Id], Colour: "#00FF00"), Json)).EnsureSuccessStatusCode();
        var c = await AddAnnotationAsync(bob, id, "c");
        await AddGroupAsync(bob, id, "g", [c.Id]);
        var delete = ChangeSetOf(await bob.DeleteAsync($"/annotations/{c.Id}"));
        return (id, alice, bob, delete);
    }

    private static async Task<List<string>> WhatsAsync(HttpClient client, string query) =>
        (await client.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?{query}", Json))!.Select(c => c.What).ToList();

    [Fact]
    public async Task ChangeSets_CanBeNarrowedToWhoMadeThem()
    {
        var (id, alice, _, _) = await TwoPeopleAsync();

        Assert.Equal(["delete annotation", "add group", "add annotation"], await WhatsAsync(alice, $"collectionId={id}&createdBy=bob"));
        Assert.Equal(6, (await WhatsAsync(alice, $"collectionId={id}&createdBy=alice&createdBy=bob")).Count);
        Assert.Equal(3, await alice.GetFromJsonAsync<int>($"/changesets/total?collectionId={id}&createdBy=alice"));
    }

    [Fact]
    public async Task ChangeSets_CanBeNarrowedToAKindOfChange_ChangeBeingAnythingElse()
    {
        var (id, alice, _, _) = await TwoPeopleAsync();

        Assert.Equal(["add group", "add annotation", "add annotation", "add annotation"], await WhatsAsync(alice, $"collectionId={id}&kind=add"));
        Assert.Equal(["delete annotation", "change annotations"], await WhatsAsync(alice, $"collectionId={id}&kind=delete&kind=change"));
        Assert.Empty(await WhatsAsync(alice, $"collectionId={id}&kind=merge"));
        Assert.Equal(1, await alice.GetFromJsonAsync<int>($"/changesets/total?collectionId={id}&kind=change"));
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.GetAsync($"/changesets?collectionId={id}&kind=rename")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.GetAsync($"/changesets/total?collectionId={id}&kind=rename")).StatusCode);
    }

    [Fact]
    public async Task ChangeSets_CanBeNarrowedToWhen_AndListedOldestFirst()
    {
        var (id, alice, _, _) = await TwoPeopleAsync();
        var future = Uri.EscapeDataString(DateTimeOffset.UtcNow.AddDays(1).ToString("O"));
        var past = Uri.EscapeDataString(DateTimeOffset.UtcNow.AddDays(-1).ToString("O"));

        Assert.Empty(await WhatsAsync(alice, $"collectionId={id}&from={future}"));
        Assert.Equal(6, (await WhatsAsync(alice, $"collectionId={id}&from={past}&to={future}")).Count);
        Assert.Equal(["add annotation", "add annotation", "change annotations", "add annotation", "add group", "delete annotation"],
            await WhatsAsync(alice, $"collectionId={id}&order=oldest"));
        Assert.Equal(["add annotation", "add annotation"], await WhatsAsync(alice, $"collectionId={id}&order=oldest&kind=add&createdBy=alice"));
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.GetAsync($"/changesets?collectionId={id}&order=sideways")).StatusCode);
    }

    [Fact]
    public async Task ChangeSetFacets_SayWhoMadeChanges_AndHowManyOfEachKind()
    {
        var (id, alice, _, _) = await TwoPeopleAsync();

        var facets = (await alice.GetFromJsonAsync<ChangeSetFacets>($"/changesets/facets?collectionId={id}", Json))!;

        Assert.Equal([("alice", "User alice", 3), ("bob", "User bob", 3)], facets.Authors.Select(a => (a.Id, a.Name, a.Count)));
        Assert.Equal([("add", 4), ("change", 1), ("delete", 1)], facets.Kinds.Select(k => (k.Kind, k.Count)));
        Assert.Equal(HttpStatusCode.NotFound, (await As("carol").GetAsync($"/changesets/facets?collectionId={id}")).StatusCode);
    }

    [Theory]
    [InlineData("add annotation", "add")]
    [InlineData("add cell count", "add")]
    [InlineData("delete annotations", "delete")]
    [InlineData("delete collection", "delete")]
    [InlineData("merge groups", "merge")]
    [InlineData("import", "import")]
    [InlineData("restore", "restore")]
    [InlineData("change group", "change")]
    [InlineData("rename session", "change")]
    public void AChangesKind_ComesFromWhatItDid(string what, string kind) => Assert.Equal(kind, ChangeKinds.Of(what));

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

    [Fact]
    public async Task ARestore_AnswersWithTheRowsItPutBack()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var annotation = await AddAnnotationAsync(alice, id, "kept label");
        var cellCount = await AddCellCountAsync(alice, id);
        var adjustment = await AddAdjustmentAsync(alice, id);
        var group = await AddGroupAsync(alice, id, "gone group");
        var untouched = await AddAnnotationAsync(alice, id, "untouched");
        var changeSet = Guid.NewGuid();
        foreach (var url in new[]
                 {
                     $"/annotations/{annotation.Id}", $"/cellcounts/{cellCount.Id}",
                     $"/imageadjustments/{adjustment.ImageAdjustmentId}", $"/annotationgroups/{group.Id}",
                 })
            (await alice.SendAsync(InChangeSet(HttpMethod.Delete, url, changeSet))).EnsureSuccessStatusCode();

        var restore = await RestoreAsync(alice, changeSet);
        var restored = (await restore.Content.ReadFromJsonAsync<RestoredView>(Json))!;

        Assert.Equal(new RestoreResult(1, 1, 1, 1, false), restored.Counts);
        Assert.Equal("kept label", Assert.Single(restored.Annotations).Label);
        Assert.DoesNotContain(restored.Annotations, a => a.Id == untouched.Id);
        var restoredGroup = Assert.Single(restored.Groups);
        Assert.Equal((group.Id, "gone group", 0), (restoredGroup.Id, restoredGroup.Name, restoredGroup.Count));
        var restoredCount = Assert.Single(restored.CellCounts);
        Assert.Equal(cellCount.Id, restoredCount.Id);
        Assert.Equal([new ColourCount("#ff0000", 1)], restoredCount.ColourCounts);
        Assert.Equal(adjustment.ImageAdjustmentId, Assert.Single(restored.ImageAdjustments).ImageAdjustmentId);

        // The shape the viewer reads - counts kept apart, and no dots.
        using var json = System.Text.Json.JsonDocument.Parse(await restore.Content.ReadAsStringAsync());
        Assert.Equal(1, json.RootElement.GetProperty("counts").GetProperty("annotations").GetInt32());
        var countJson = json.RootElement.GetProperty("cellCounts")[0];
        Assert.Equal(System.Text.Json.JsonValueKind.Null, countJson.GetProperty("dots").ValueKind);
        Assert.False(json.RootElement.GetProperty("annotations")[0].TryGetProperty("deletedIn", out _));

        // Nothing left to put back, so the second answers empty.
        var again = (await (await RestoreAsync(alice, changeSet)).Content.ReadFromJsonAsync<RestoredView>(Json))!;
        Assert.Equal(new RestoreResult(0, 0, 0, 0, false), again.Counts);
        Assert.Empty(again.Annotations);
        Assert.Empty(again.Groups);
        Assert.Empty(again.CellCounts);
        Assert.Empty(again.ImageAdjustments);
    }

    private static async Task<ChangeSetChanges> ChangesAsync(HttpClient client, Guid changeSet) =>
        (await client.GetFromJsonAsync<ChangeSetChanges>($"/changesets/{changeSet}/changes", Json))!;

    [Fact]
    public async Task AnEditsChanges_SayFromAndTo_OnTheRowByName()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var annotation = await AddAnnotationAsync(alice, id, "Region 4");
        var put = await alice.PutAsJsonAsync($"/annotations/{annotation.Id}",
            new Annotation { Label = "Region 4 (checked)", Notes = "Looked at again", Colour = annotation.Colour });

        var changes = await ChangesAsync(alice, ChangeSetOf(put));

        Assert.Equal(["Label", "Notes"], changes.Changes.Select(c => c.Column).Order());
        var label = changes.Changes.Single(c => c.Column == "Label");
        Assert.Equal((HistoryLog.Annotation, "Region 4", "Region 4 (checked)", 1), (label.Entity, label.Before.GetString(), label.After.GetString(), label.Count));
        Assert.Equal(["Region 4 (checked)"], label.Names);
        Assert.Equal("", changes.Changes.Single(c => c.Column == "Notes").Before.GetString());
        Assert.Equal((0, 0), (changes.Created, changes.Deleted));
    }

    [Fact]
    public async Task ARecoloursChanges_AreOneLine_WithHowManyAndTheFirstFewByName()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var ids = new List<Guid>();
        for (var i = 0; i < 8; i++) ids.Add((await AddAnnotationAsync(alice, id, $"a{i}")).Id);
        var recolour = await alice.PutAsJsonAsync("/annotations/bulk", new BulkUpdateRequest(id, ids, Colour: "#0000FF"), Json);

        var change = Assert.Single((await ChangesAsync(alice, ChangeSetOf(recolour))).Changes);

        Assert.Equal(("Colour", "#FF0000", "#0000FF", 8), (change.Column, change.Before.GetString(), change.After.GetString(), change.Count));
        Assert.Equal(ChangeSetChangesEndpoint.NamesShown, change.Names.Count);
    }

    [Fact]
    public async Task GroupMovesChanges_NameTheGroups_EvenOneThatsGone()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var a = await AddAnnotationAsync(alice, id, "a");
        var from = await AddGroupAsync(alice, id, "Stroma", [a.Id]);
        var into = await AddGroupAsync(alice, id, "Tumour margin");
        var merge = await alice.PostAsJsonAsync($"/annotationgroups/{from.Id}/merge", new GroupMergeRequest(into.Id), Json);

        var changes = await ChangesAsync(alice, ChangeSetOf(merge));

        var moved = changes.Changes.Single(c => c.Column == "GroupId");
        Assert.Equal((from.Id, into.Id), (moved.Before.GetGuid(), moved.After.GetGuid()));
        Assert.Equal("Stroma", changes.Groups[from.Id]);
        Assert.Equal("Tumour margin", changes.Groups[into.Id]);
        Assert.Equal(1, changes.Deleted);
        Assert.Equal(["Stroma"], changes.DeletedNames);
    }

    [Fact]
    public async Task ADeletesChanges_SayWhatWentByName_AndAnAddsSayHowMany()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var count = await AddCellCountAsync(alice, id);
        var a = await AddAnnotationAsync(alice, id, "Region 7");
        var changeSet = Guid.NewGuid();
        await alice.SendAsync(InChangeSet(HttpMethod.Delete, $"/annotations/{a.Id}", changeSet));
        await alice.SendAsync(InChangeSet(HttpMethod.Delete, $"/cellcounts/{count.Id}", changeSet));

        var changes = await ChangesAsync(alice, changeSet);
        Assert.Empty(changes.Changes);
        Assert.Equal((2, 0), (changes.Deleted, changes.Created));
        Assert.Equal(["Region 7", "c"], changes.DeletedNames);

        var post = await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "new" });
        Assert.Equal((1, 0), ((await ChangesAsync(alice, ChangeSetOf(post))).Created, (await ChangesAsync(alice, ChangeSetOf(post))).Deleted));
    }

    [Fact]
    public async Task AChangeSetsChanges_AreForPeopleInTheCollection()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var post = await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "x" });

        Assert.Equal(HttpStatusCode.NotFound, (await As("bob").GetAsync($"/changesets/{ChangeSetOf(post)}/changes")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/changesets/{Guid.NewGuid()}/changes")).StatusCode);
    }

    [Fact]
    public async Task ChangeSetTotal_CountsTheCollectionsChangeSets()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var other = (await OwnAsync(alice)).CollectionId;
        await AddAnnotationAsync(alice, id);
        var annotation = await AddAnnotationAsync(alice, id);
        await AddAnnotationAsync(alice, other);
        await alice.DeleteAsync($"/annotations/{annotation.Id}");

        Assert.Equal(3, await alice.GetFromJsonAsync<int>($"/changesets/total?collectionId={id}"));
        Assert.Equal(HttpStatusCode.NotFound, (await As("bob").GetAsync($"/changesets/total?collectionId={id}")).StatusCode);
    }
}
