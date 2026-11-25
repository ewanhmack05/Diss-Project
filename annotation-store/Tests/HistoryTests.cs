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

    private static async Task<Annotation> AddOnSlicesAsync(HttpClient client, Guid collectionId, string label, int? from, int? to)
    {
        var response = await client.PostAsJsonAsync("/annotations",
            new Annotation { CollectionId = collectionId, Label = label, Colour = "#FF0000", Shape = "Box", SliceFrom = from, SliceTo = to });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<Annotation>(Json))!;
    }

    [Fact]
    public async Task PuttingBackADelete_BringsBackTheSliceRange()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var marker = await AddOnSlicesAsync(alice, id, "marker", 3, 7);
        var flat = await AddOnSlicesAsync(alice, id, "flat", null, null);
        var first = await alice.DeleteAsync($"/annotations/{marker.Id}");
        var second = await alice.DeleteAsync($"/annotations/{flat.Id}");

        var deleted = Columns(Assert.Single(await EntriesAsync(ChangeSetOf(first))).Before);
        Assert.Equal(("3", "7"), (deleted["SliceFrom"], deleted["SliceTo"]));
        (await RestoreAsync(alice, ChangeSetOf(first))).EnsureSuccessStatusCode();
        (await RestoreAsync(alice, ChangeSetOf(second))).EnsureSuccessStatusCode();

        var back = (await AnnotationsAsync(alice, id)).ToDictionary(a => a.Id);
        Assert.Equal((3, 7), (back[marker.Id].SliceFrom, back[marker.Id].SliceTo));
        Assert.Equal((null, null), (back[flat.Id].SliceFrom, back[flat.Id].SliceTo));
    }

    [Fact]
    public async Task PuttingBackADeletedCount_BringsBackItsSlice()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var response = await alice.PostAsJsonAsync("/cellcounts",
            new CellCount { CollectionId = id, Label = "c", Dots = "[{\"x\":1,\"y\":2,\"colour\":\"#ff0000\"}]", Count = 1, Slice = 6 });
        var count = (await response.Content.ReadFromJsonAsync<CellCount>(Json))!;
        var delete = await alice.DeleteAsync($"/cellcounts/{count.Id}");

        Assert.Equal("6", Columns(Assert.Single(await EntriesAsync(ChangeSetOf(delete))).Before)["Slice"]);
        (await RestoreAsync(alice, ChangeSetOf(delete))).EnsureSuccessStatusCode();

        Assert.Equal(6, (await alice.GetFromJsonAsync<CellCount>($"/cellcounts/{count.Id}", Json))!.Slice);
    }

    [Fact]
    public async Task PuttingBackABulkDelete_BringsBackEachSliceRange()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var low = await AddOnSlicesAsync(alice, id, "low", 0, 2);
        var high = await AddOnSlicesAsync(alice, id, "high", 40, 41);
        var flat = await AddOnSlicesAsync(alice, id, "flat", null, null);
        var delete = await alice.PostAsJsonAsync("/annotations/bulk-delete", new BulkDeleteRequest(id, [low.Id, high.Id, flat.Id]), Json);
        delete.EnsureSuccessStatusCode();
        Assert.Empty(await AnnotationsAsync(alice, id));

        (await RestoreAsync(alice, ChangeSetOf(delete))).EnsureSuccessStatusCode();

        var back = (await AnnotationsAsync(alice, id)).ToDictionary(a => a.Id);
        Assert.Equal((0, 2), (back[low.Id].SliceFrom, back[low.Id].SliceTo));
        Assert.Equal((40, 41), (back[high.Id].SliceFrom, back[high.Id].SliceTo));
        Assert.Equal((null, null), (back[flat.Id].SliceFrom, back[flat.Id].SliceTo));
    }

    // Deletes saved before the columns were there have no SliceFrom or
    // SliceTo in them, and come back on every slice.
    [Fact]
    public async Task PuttingBackADeleteFromBeforeSliceRanges_IsEverySlice()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var old = await AddOnSlicesAsync(alice, id, "old", null, null);
        var delete = await alice.DeleteAsync($"/annotations/{old.Id}");
        var changeSet = ChangeSetOf(delete);
        await WithDbAsync(async db =>
        {
            var entry = await db.HistoryEntries.SingleAsync(e => e.ChangeSetId == changeSet);
            var before = System.Text.Json.Nodes.JsonNode.Parse(entry.Before!)!.AsObject();
            before.Remove("SliceFrom");
            before.Remove("SliceTo");
            entry.Before = before.ToJsonString();
            return await db.SaveChangesAsync();
        });

        (await RestoreAsync(alice, changeSet)).EnsureSuccessStatusCode();

        var back = Assert.Single(await AnnotationsAsync(alice, id));
        Assert.Equal(("old", null, null), (back.Label, back.SliceFrom, back.SliceTo));
    }

    private static async Task<Guid> MoveAsync(HttpClient client, Guid id, int? from, int? to, Guid? changeSet = null)
    {
        var url = $"/annotations/{id}/slices";
        var body = new SliceRangeUpdate(from, to);
        var response = changeSet is { } inside
            ? await client.SendAsync(InChangeSet(HttpMethod.Put, url, inside, body))
            : await client.PutAsJsonAsync(url, body, Json);
        response.EnsureSuccessStatusCode();
        return ChangeSetOf(response);
    }

    private static async Task<(int?, int?)> SlicesAsync(HttpClient client, Guid collectionId, Guid id)
    {
        var row = (await AnnotationsAsync(client, collectionId)).Single(a => a.Id == id);
        return (row.SliceFrom, row.SliceTo);
    }

    [Fact]
    public async Task PuttingBackAnEdit_SaysWhatTheTextWas_OnlyWhereItChanged()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var labelled = await AddAnnotationAsync(alice, id, "before");
        var noted = await AddCellCountAsync(alice, id);
        var recoloured = await AddAnnotationAsync(alice, id, "recoloured");
        var edit = Guid.NewGuid();
        async Task EditAsync(string url, object body)
        {
            var request = InChangeSet(HttpMethod.Put, url, edit);
            request.Content = JsonContent.Create(body, options: Json);
            (await alice.SendAsync(request)).EnsureSuccessStatusCode();
        }
        await EditAsync($"/annotations/{labelled.Id}", new AnnotationUpdate { Label = "after", Notes = labelled.Notes, Colour = labelled.Colour });
        await EditAsync($"/annotations/{recoloured.Id}", new AnnotationUpdate { Label = "recoloured", Notes = recoloured.Notes, Colour = "#00FF00" });
        await EditAsync($"/cellcounts/{noted.Id}", new CellCountUpdate { Label = noted.Label, Notes = "after", Count = noted.Count, DotSize = noted.DotSize });

        var restored = (await (await RestoreAsync(alice, edit)).Content.ReadFromJsonAsync<RestoredView>(Json))!;

        Assert.Equal(
            new[] { new TextWas(labelled.Id, "after", null), new TextWas(noted.Id, null, "after") }.OrderBy(t => t.Id),
            restored.TextWas.OrderBy(t => t.Id));
        // Put back again, there's nothing it changed.
        Assert.Empty((await (await RestoreAsync(alice, edit)).Content.ReadFromJsonAsync<RestoredView>(Json))!.TextWas);
    }

    // Both ends, one end, onto every slice and off it.
    [Theory]
    [InlineData(3, 8, 2, 11)]
    [InlineData(3, 8, 3, 11)]
    [InlineData(3, 8, 0, 8)]
    [InlineData(3, 8, null, null)]
    [InlineData(null, null, 4, 4)]
    public async Task PuttingBackASliceMove_PutsItOnTheSlicesItWasOn_AsAChangeOfItsOwn(int? from, int? to, int? movedFrom, int? movedTo)
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var marker = await AddOnSlicesAsync(alice, id, "marker", from, to);
        var move = await MoveAsync(alice, marker.Id, movedFrom, movedTo);

        var restore = await RestoreAsync(alice, move);

        restore.EnsureSuccessStatusCode();
        Assert.Equal((from, to), await SlicesAsync(alice, id, marker.Id));
        var changed = Assert.Single((await restore.Content.ReadFromJsonAsync<RestoredView>(Json))!.ChangedAnnotations);
        Assert.Equal((marker.Id, from, to), (changed.Id, changed.SliceFrom, changed.SliceTo));
        var logged = Assert.Single(await EntriesAsync(ChangeSetOf(restore)));
        Assert.Equal(Columns(Assert.Single(await EntriesAsync(move)).Before), Columns(logged.After));

        // And that goes back on as well.
        (await RestoreAsync(alice, ChangeSetOf(restore))).EnsureSuccessStatusCode();
        Assert.Equal((movedFrom, movedTo), await SlicesAsync(alice, id, marker.Id));
    }

    // Undoing the first move's end alone would give 3 to 1, which is backwards,
    // and in the second case a last slice with no first one.
    [Theory]
    [InlineData(3, 8, 0, 8, 0, 1)]
    [InlineData(null, null, 2, 5, 2, 7)]
    [InlineData(3, 8, 2, 11, 2, 5)]
    public async Task PuttingBackASliceMove_LeavesItAlone_OnceEitherEndHasMovedSince(
        int? from, int? to, int movedFrom, int movedTo, int laterFrom, int laterTo)
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var marker = await AddOnSlicesAsync(alice, id, "marker", from, to);
        var move = await MoveAsync(alice, marker.Id, movedFrom, movedTo);
        await MoveAsync(alice, marker.Id, laterFrom, laterTo);

        var restore = await RestoreAsync(alice, move);

        restore.EnsureSuccessStatusCode();
        Assert.Equal((laterFrom, laterTo), await SlicesAsync(alice, id, marker.Id));
        Assert.Empty((await restore.Content.ReadFromJsonAsync<RestoredView>(Json))!.ChangedAnnotations);
    }

    // Anything else in the change still goes back.
    [Fact]
    public async Task PuttingBackAnEdit_PutsTheRestBack_WhenItsSlicesHaveMovedSince()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var marker = await AddOnSlicesAsync(alice, id, "marker", 3, 8);
        var edit = await MoveAsync(alice, marker.Id, 0, 8);
        (await alice.SendAsync(InChangeSet(HttpMethod.Put, $"/annotations/{marker.Id}", edit,
            new AnnotationUpdate { Label = "renamed", Colour = "#FF0000" }))).EnsureSuccessStatusCode();
        await MoveAsync(alice, marker.Id, 0, 1);

        (await RestoreAsync(alice, edit)).EnsureSuccessStatusCode();

        var now = Assert.Single(await AnnotationsAsync(alice, id));
        Assert.Equal(("marker", 0, 1), (now.Label, now.SliceFrom, now.SliceTo));
    }

    // Deleted since and brought back, it's still where the move left it.
    [Fact]
    public async Task PuttingBackASliceMove_Works_ThroughADeleteAndItsPutBack()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var marker = await AddOnSlicesAsync(alice, id, "marker", 3, 8);
        var move = await MoveAsync(alice, marker.Id, 2, 11);
        var delete = await alice.DeleteAsync($"/annotations/{marker.Id}");
        (await RestoreAsync(alice, ChangeSetOf(delete))).EnsureSuccessStatusCode();
        Assert.Equal((2, 11), await SlicesAsync(alice, id, marker.Id));

        (await RestoreAsync(alice, move)).EnsureSuccessStatusCode();

        Assert.Equal((3, 8), await SlicesAsync(alice, id, marker.Id));
    }

    // Moved and deleted in the one change, it comes back where it was before
    // either.
    [Fact]
    public async Task PuttingBackAMoveAndADeleteInOneChange_UndoesBoth()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var marker = await AddOnSlicesAsync(alice, id, "marker", 3, 8);
        var change = await MoveAsync(alice, marker.Id, 2, 11);
        (await alice.SendAsync(InChangeSet(HttpMethod.Delete, $"/annotations/{marker.Id}", change))).EnsureSuccessStatusCode();

        (await RestoreAsync(alice, change)).EnsureSuccessStatusCode();

        Assert.Equal((3, 8), await SlicesAsync(alice, id, marker.Id));
    }

    // Nothing folds across a delete, so one change can have moved it twice. It
    // goes back to before the first.
    [Fact]
    public async Task PuttingBackTwoMovesInOneChange_EitherSideOfADelete_GoesToBeforeTheFirst()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var marker = await AddOnSlicesAsync(alice, id, "marker", 3, 8);
        var change = await MoveAsync(alice, marker.Id, 2, 11);
        (await alice.SendAsync(InChangeSet(HttpMethod.Delete, $"/annotations/{marker.Id}", change))).EnsureSuccessStatusCode();
        var delete = (await EntriesAsync(change)).Single(e => e.Op == HistoryOp.Delete).Id;
        (await alice.PostAsync($"/annotations/{marker.Id}/history/{delete}/restore", null)).EnsureSuccessStatusCode();
        await MoveAsync(alice, marker.Id, 1, 4, change);
        Assert.Equal(2, (await EntriesAsync(change)).Count(e => e.Op == HistoryOp.Update));

        (await RestoreAsync(alice, change)).EnsureSuccessStatusCode();

        Assert.Equal((3, 8), await SlicesAsync(alice, id, marker.Id));
    }

    // An open edit form is one change set: typing, a colour and moves of its
    // slices go back together, and so does another row in it.
    [Fact]
    public async Task PuttingBackAnEditThatMovedSlicesToo_PutsAllOfItBack()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var one = await AddOnSlicesAsync(alice, id, "one", 3, 8);
        var two = await AddOnSlicesAsync(alice, id, "two", null, null);
        var edit = await MoveAsync(alice, one.Id, 3, 9);
        await MoveAsync(alice, one.Id, 1, 9, edit);
        (await alice.SendAsync(InChangeSet(HttpMethod.Put, $"/annotations/{one.Id}", edit,
            new AnnotationUpdate { Label = "renamed", Colour = "#0000FF" }))).EnsureSuccessStatusCode();
        await MoveAsync(alice, two.Id, 5, 5, edit);

        (await RestoreAsync(alice, edit)).EnsureSuccessStatusCode();

        var back = (await AnnotationsAsync(alice, id)).ToDictionary(a => a.Id);
        Assert.Equal(("one", "#FF0000", 3, 8), (back[one.Id].Label, back[one.Id].Colour, back[one.Id].SliceFrom, back[one.Id].SliceTo));
        Assert.Equal((null, null), (back[two.Id].SliceFrom, back[two.Id].SliceTo));
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
        Assert.Equal(new[] { a.Id, b.Id }.Order(), (await AnnotationsAsync(alice, id)).Select(x => x.Id).Order());
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

    private static ImportSource SentBy(string from, Guid? collection = null, List<SourceRow>? rows = null, Guid? message = null) =>
        new(message ?? Guid.NewGuid(), from, $"User {from}", "annotations", "Tumour", collection, "003", rows);

    [Fact]
    public async Task AddingSomethingSent_SaysWhereItCameFrom_InTheListAndTheChange()
    {
        var bob = As("bob");
        var id = (await OwnAsync(bob)).CollectionId;
        var (from, to, message, theirs) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());

        var added = await bob.PostAsJsonAsync($"/collections/{id}/import", new ImportRequest(
            [new Annotation { Id = to, Label = "copy" }], [], null,
            SentBy("alice", theirs, [new SourceRow(HistoryLog.Annotation, from, to)], message)), Json);
        added.EnsureSuccessStatusCode();

        var list = (await bob.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}", Json))!;
        var change = Assert.Single(list);
        Assert.Equal("add from message", change.What);
        Assert.Equal(("bob", "User bob"), (change.UserId, change.UserName));
        Assert.Equal(new ChangeSetSource(message, "alice", "User alice", "annotations", "Tumour", theirs, "003", 1, 0), change.Source);

        var detail = (await bob.GetFromJsonAsync<ChangeSetChanges>($"/changesets/{change.Id}/changes", Json))!;
        Assert.Equal([new SourceRow(HistoryLog.Annotation, from, to)], detail.CopiedFrom);
        Assert.Equal(1, detail.Created);
        // The adder is the author of the copy - the original author is in Source.
        var row = (await added.Content.ReadFromJsonAsync<ImportResult>(Json))!.Annotations.Single();
        Assert.Equal(("bob", "User bob"), (row.CreatedById, row.CreatedByName));
    }

    [Fact]
    public async Task AddingSomethingSent_CountsAsAnAdd_NotAnImport()
    {
        var bob = As("bob");
        var id = (await OwnAsync(bob)).CollectionId;

        (await bob.PostAsJsonAsync($"/collections/{id}/import", new ImportRequest([new Annotation { Label = "copy" }], [], null, SentBy("alice")), Json)).EnsureSuccessStatusCode();

        var adds = (await bob.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}&kind=add", Json))!;
        Assert.Single(adds);
        Assert.Empty((await bob.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}&kind=import", Json))!);
    }

    [Fact]
    public async Task AFileImport_HasNoSource()
    {
        var bob = As("bob");
        var id = (await OwnAsync(bob)).CollectionId;

        (await bob.PostAsJsonAsync($"/collections/{id}/import", new ImportRequest([new Annotation { Label = "file" }], []), Json)).EnsureSuccessStatusCode();

        var change = Assert.Single((await bob.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}", Json))!);
        Assert.Equal("import", change.What);
        Assert.Null(change.Source);
        Assert.Null((await bob.GetFromJsonAsync<ChangeSetChanges>($"/changesets/{change.Id}/changes", Json))!.CopiedFrom);
    }

    [Fact]
    public async Task ASource_HasToSayWhoAndWhat_AndItsRowsHaveToBeInTheImport()
    {
        var bob = As("bob");
        var id = (await OwnAsync(bob)).CollectionId;
        var here = Guid.NewGuid();
        Task<HttpResponseMessage> Add(ImportSource source) => bob.PostAsJsonAsync($"/collections/{id}/import",
            new ImportRequest([new Annotation { Id = here, Label = "copy" }], [], null, source), Json);

        var bad = new[]
        {
            SentBy("alice") with { MessageId = Guid.Empty },
            SentBy("alice") with { FromUserId = " " },
            SentBy("alice") with { FromName = "" },
            SentBy("alice") with { Kind = "" },
            SentBy("alice") with { Name = new string('x', 301) },
            SentBy("alice", rows: [new SourceRow(HistoryLog.Annotation, Guid.NewGuid(), Guid.NewGuid())]),
            SentBy("alice", rows: [new SourceRow(HistoryLog.CellCount, Guid.NewGuid(), here)]),
            SentBy("alice", rows: [new SourceRow("nonsense", Guid.NewGuid(), here)]),
            SentBy("alice", rows: [new SourceRow(HistoryLog.Annotation, Guid.Empty, here)]),
        };
        foreach (var source in bad)
            Assert.Equal(HttpStatusCode.BadRequest, (await Add(source)).StatusCode);

        // A refused one leaves nothing behind.
        Assert.Empty((await bob.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}", Json))!);
    }

    [Fact]
    public async Task ASource_StillNeedsYouToBeAbleToEdit()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;

        var response = await As("bob").PostAsJsonAsync($"/collections/{id}/import",
            new ImportRequest([new Annotation { Label = "copy" }], [], null, SentBy("alice")), Json);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task ASource_SurvivesTheChangeBeingPutBack()
    {
        var bob = As("bob");
        var id = (await OwnAsync(bob)).CollectionId;
        var copy = Guid.NewGuid();
        var added = await bob.PostAsJsonAsync($"/collections/{id}/import", new ImportRequest([new Annotation { Id = copy, Label = "copy" }], [], null, SentBy("alice")), Json);
        var addedChange = ChangeSetOf(added);
        (await bob.DeleteAsync($"/annotations/{copy}")).EnsureSuccessStatusCode();
        var deleted = (await bob.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}", Json))!.First();

        (await bob.PostAsync($"/changesets/{deleted.Id}/restore", null)).EnsureSuccessStatusCode();

        var list = (await bob.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}", Json))!;
        Assert.Equal("User alice", list.Single(c => c.Id == addedChange).Source!.FromName);
        Assert.Equal(2, list.Count(c => c.Source is null));
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

    // What an open edit form does - a save on every pause, one change set.
    private async Task<HttpResponseMessage> EditAsync(HttpClient client, Annotation annotation, Guid changeSet, string label, string notes = "", string? colour = null)
    {
        var response = await client.SendAsync(InChangeSet(HttpMethod.Put, $"/annotations/{annotation.Id}", changeSet,
            new Annotation { Label = label, Notes = notes, Colour = colour ?? annotation.Colour }));
        response.EnsureSuccessStatusCode();
        return response;
    }

    [Fact]
    public async Task OneEdit_SavedManyTimes_IsOneEntry_FromHowItWasToHowItEnded()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var annotation = await AddAnnotationAsync(alice, id, "Region");
        var edit = Guid.NewGuid();

        await EditAsync(alice, annotation, edit, "Region 4");
        await EditAsync(alice, annotation, edit, "Region 4", notes: "mitoses");
        await EditAsync(alice, annotation, edit, "Region 4 (checked)", notes: "mitoses", colour: "#00FF00");

        var entry = Assert.Single(await EntriesAsync(edit));
        Assert.Equal(HistoryOp.Update, entry.Op);
        Assert.Equal(new Dictionary<string, string> { ["Label"] = "Region", ["Notes"] = "", ["Colour"] = "#FF0000" }, Columns(entry.Before));
        Assert.Equal(new Dictionary<string, string> { ["Label"] = "Region 4 (checked)", ["Notes"] = "mitoses", ["Colour"] = "#00FF00" }, Columns(entry.After));
    }

    [Fact]
    public async Task AColumnBackWhereItStarted_DropsOut_AndAnEditThatUndidItselfLeavesNothing()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var annotation = await AddAnnotationAsync(alice, id, "Region");
        var edit = Guid.NewGuid();

        await EditAsync(alice, annotation, edit, "Regoin", notes: "x");
        await EditAsync(alice, annotation, edit, "Region", notes: "x");
        var entry = Assert.Single(await EntriesAsync(edit));
        Assert.Equal(new Dictionary<string, string> { ["Notes"] = "" }, Columns(entry.Before));
        Assert.Equal(new Dictionary<string, string> { ["Notes"] = "x" }, Columns(entry.After));

        await EditAsync(alice, annotation, edit, "Region");
        Assert.Empty(await EntriesAsync(edit));
    }

    [Fact]
    public async Task Edits_InSeparateChangeSets_StaySeparate_AndOtherRowsArentFoldedIn()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var a = await AddAnnotationAsync(alice, id, "a");
        var b = await AddAnnotationAsync(alice, id, "b");
        var edit = Guid.NewGuid();
        var later = Guid.NewGuid();

        await EditAsync(alice, a, edit, "a2");
        await EditAsync(alice, b, edit, "b2");
        await EditAsync(alice, a, later, "a3");

        Assert.Equal([a.Id, b.Id], (await EntriesAsync(edit)).Select(e => e.EntityId));
        Assert.Equal("a2", Columns(Assert.Single(await EntriesAsync(edit), e => e.EntityId == a.Id).After)["Label"]);
        Assert.Equal("a2", Columns(Assert.Single(await EntriesAsync(later)).Before)["Label"]);
    }

    // Saves that overlap on a slow network - each waits on the live row the
    // one before it updated, so they fold one at a time.
    [PostgresFact]
    public async Task SavesOfOneEditAtTheSameMoment_StillFoldIntoOneEntry_EndingWhereTheRowDid()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var annotation = await AddAnnotationAsync(alice, id, "start");
        var edit = Guid.NewGuid();

        await Task.WhenAll(Enumerable.Range(0, 20).Select(i => EditAsync(alice, annotation, edit, $"label {i}")));

        var entry = Assert.Single(await EntriesAsync(edit));
        Assert.Equal("start", Columns(entry.Before)["Label"]);
        Assert.Equal(Assert.Single(await AnnotationsAsync(alice, id)).Label, Columns(entry.After)["Label"]);
    }

    // Two people with the same form open, pausing in turn. Folding alice's
    // second save into her first would make one entry from before bob's
    // typing to after it, and say she'd typed it.
    [Fact]
    public async Task NothingFoldsAcrossSomeoneElsesChange_SoEachEntryIsOnlyWhatItsPersonDid()
    {
        var (alice, bob) = (As("alice"), As("bob"));
        var (id, code) = await SessionWithLinkAsync(alice);
        (await bob.PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();
        var annotation = await AddAnnotationAsync(alice, id, "");
        var (hers, his) = (Guid.NewGuid(), Guid.NewGuid());

        await EditAsync(alice, annotation, hers, "duct");
        await EditAsync(alice, annotation, hers, "duct 4");
        await EditAsync(bob, annotation, his, "duct 4, checked");
        await EditAsync(alice, annotation, hers, "duct 4, checked twice");
        await EditAsync(alice, annotation, hers, "duct 4, checked twice!");

        async Task<List<(string, string)>> LabelsAsync(Guid change) =>
            (await EntriesAsync(change)).OrderBy(e => e.Id).Select(e => (Columns(e.Before)["Label"], Columns(e.After)["Label"])).ToList();
        Assert.Equal([("", "duct 4"), ("duct 4, checked", "duct 4, checked twice!")], await LabelsAsync(hers));
        Assert.Equal([("duct 4", "duct 4, checked")], await LabelsAsync(his));
    }

    // It used to go from before bob's, so putting it back took his out too.
    [Fact]
    public async Task PuttingBackAnEditSomeoneElseTypedInTheMiddleOf_LeavesTheirs()
    {
        var (alice, bob) = (As("alice"), As("bob"));
        var (id, code) = await SessionWithLinkAsync(alice);
        (await bob.PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();
        var annotation = await AddAnnotationAsync(alice, id, "start");
        var (hers, his) = (Guid.NewGuid(), Guid.NewGuid());
        await EditAsync(alice, annotation, hers, "start one");
        await EditAsync(bob, annotation, his, "start one two");
        await EditAsync(alice, annotation, hers, "start one two three");

        (await RestoreAsync(alice, hers)).EnsureSuccessStatusCode();

        Assert.Equal("start one two", Assert.Single(await AnnotationsAsync(alice, id)).Label);
    }

    // Someone else changing another column in between is enough - the entry's
    // the row's, not the column's.
    [Fact]
    public async Task NothingFoldsAcrossSomeoneElsesChange_ToAnotherRowsColumnsToo_ButOtherRowsDontCount()
    {
        var (alice, bob) = (As("alice"), As("bob"));
        var (id, code) = await SessionWithLinkAsync(alice);
        (await bob.PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();
        var (a, b) = (await AddAnnotationAsync(alice, id, "a"), await AddAnnotationAsync(alice, id, "b"));
        var hers = Guid.NewGuid();

        await EditAsync(alice, a, hers, "a1");
        await EditAsync(bob, b, Guid.NewGuid(), "b1");
        await EditAsync(alice, a, hers, "a2");
        Assert.Single(await EntriesAsync(hers));

        (await bob.PutAsJsonAsync("/annotations/bulk", new BulkUpdateRequest(id, [a.Id], Colour: "#00FF00"), Json)).EnsureSuccessStatusCode();
        await EditAsync(alice, a, hers, "a3", colour: "#00FF00");
        Assert.Equal(2, (await EntriesAsync(hers)).Count);
    }

    [Fact]
    public async Task PuttingAMergeBack_SaysWhichGroupsNotesWentBack()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var from = await AddGroupAsync(alice, id, "Stroma");
        var into = await AddGroupAsync(alice, id, "Margin");
        (await alice.PutAsJsonAsync($"/annotationgroups/{from.Id}", new { notes = "old" }, Json)).EnsureSuccessStatusCode();
        var merge = ChangeSetOf(await alice.PostAsJsonAsync($"/annotationgroups/{from.Id}/merge", new GroupMergeRequest(into.Id), Json));

        var restored = (await (await RestoreAsync(alice, merge)).Content.ReadFromJsonAsync<RestoredView>(Json))!;

        Assert.Equal([from.Id], restored.Groups.Select(g => g.Id));
        Assert.Equal([(into.Id, "")], restored.ChangedGroups.Select(g => (g.Id, g.Notes)));
        Assert.Empty(restored.ChangedCellCountGroups);
    }

    [Fact]
    public async Task NothingFoldsAcrossADelete()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var annotation = await AddAnnotationAsync(alice, id, "a");
        var change = Guid.NewGuid();

        await EditAsync(alice, annotation, change, "a2");
        (await alice.SendAsync(InChangeSet(HttpMethod.Delete, $"/annotations/{annotation.Id}", change))).EnsureSuccessStatusCode();

        Assert.Equal([HistoryOp.Update, HistoryOp.Delete], (await EntriesAsync(change)).Select(e => e.Op));
    }

    [Fact]
    public async Task PuttingBackAFoldedEdit_GoesBackToHowItWasBeforeTheEdit()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var annotation = await AddAnnotationAsync(alice, id, "Region");
        var edit = Guid.NewGuid();
        await EditAsync(alice, annotation, edit, "Region 4");
        await EditAsync(alice, annotation, edit, "Region 4 (checked)", notes: "n", colour: "#00FF00");

        (await RestoreAsync(alice, edit)).EnsureSuccessStatusCode();

        var back = Assert.Single(await AnnotationsAsync(alice, id));
        Assert.Equal(("Region", "", "#FF0000"), (back.Label, back.Notes, back.Colour));
    }

    [Fact]
    public async Task ABulkRecolourInTheSameChangeSetAsAnEdit_FoldsIntoIt()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var a = await AddAnnotationAsync(alice, id, "a");
        var change = Guid.NewGuid();

        await EditAsync(alice, a, change, "a2");
        (await alice.SendAsync(InChangeSet(HttpMethod.Put, "/annotations/bulk", change,
            new BulkUpdateRequest(id, [a.Id], Colour: "#00FF00")))).EnsureSuccessStatusCode();

        var entry = Assert.Single(await EntriesAsync(change));
        Assert.Equal(("a2", "#00FF00"), (Columns(entry.After)["Label"], Columns(entry.After)["Colour"]));
        Assert.Equal(("a", "#FF0000"), (Columns(entry.Before)["Label"], Columns(entry.Before)["Colour"]));
    }

    [Theory]
    [InlineData("""{"Label":"a"}""", """{"Label":"b"}""", """{"Label":"b"}""", """{"Label":"c"}""", """{"Label":"a"}""", """{"Label":"c"}""")]
    [InlineData("""{"Label":"a"}""", """{"Label":"b"}""", """{"Colour":"#1"}""", """{"Colour":"#2"}""", """{"Label":"a","Colour":"#1"}""", """{"Label":"b","Colour":"#2"}""")]
    [InlineData("""{"Label":"a","Colour":"#1"}""", """{"Label":"b","Colour":"#2"}""", """{"Label":"b"}""", """{"Label":"a"}""", """{"Colour":"#1"}""", """{"Colour":"#2"}""")]
    [InlineData("""{"GroupId":null}""", """{"GroupId":"7d1e4c4e-0000-4000-8000-000000000000"}""", """{"GroupId":"7d1e4c4e-0000-4000-8000-000000000000"}""", """{"GroupId":null}""", null, null)]
    // Postgres hands jsonb back with its own spacing and key order.
    [InlineData("""{"Label": "a", "Notes": ""}""", """{"Notes": "x", "Label": "b"}""", """{"Label":"b"}""", """{"Label":"c"}""", """{"Label":"a","Notes":""}""", """{"Notes":"x","Label":"c"}""")]
    public void Fold_KeepsTheFirstBefore_AndTheLatestAfter(string firstBefore, string firstAfter, string nextBefore, string nextAfter, string? before, string? after)
    {
        var (foldedBefore, foldedAfter) = HistoryLog.Fold(firstBefore, firstAfter, nextBefore, nextAfter);

        Assert.Equal(before is null ? null : Columns(before), foldedBefore is null ? null : Columns(foldedBefore));
        Assert.Equal(after is null ? null : Columns(after), foldedAfter is null ? null : Columns(foldedAfter));
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
            CollectionId = id,
            Label = "c",
            Count = 2,
            WithRoi = true,
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

        Assert.Equal(["delete annotation", "add group", "add annotation", "join session"], await WhatsAsync(alice, $"collectionId={id}&createdBy=bob"));
        Assert.Equal(8, (await WhatsAsync(alice, $"collectionId={id}&createdBy=alice&createdBy=bob")).Count);
        Assert.Equal(4, await alice.GetFromJsonAsync<int>($"/changesets/total?collectionId={id}&createdBy=alice"));
    }

    [Fact]
    public async Task ChangeSets_CanBeNarrowedToAKindOfChange_ChangeBeingAnythingElse()
    {
        var (id, alice, _, _) = await TwoPeopleAsync();

        Assert.Equal(["add group", "add annotation", "add annotation", "add annotation"], await WhatsAsync(alice, $"collectionId={id}&kind=add"));
        Assert.Equal(["delete annotation", "change annotations"], await WhatsAsync(alice, $"collectionId={id}&kind=delete&kind=change"));
        Assert.Equal(["join session", "make invite link"], await WhatsAsync(alice, $"collectionId={id}&kind=people"));
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
        Assert.Equal(8, (await WhatsAsync(alice, $"collectionId={id}&from={past}&to={future}")).Count);
        Assert.Equal(["make invite link", "join session", "add annotation", "add annotation", "change annotations", "add annotation", "add group", "delete annotation"],
            await WhatsAsync(alice, $"collectionId={id}&order=oldest"));
        Assert.Equal(["add annotation", "add annotation"], await WhatsAsync(alice, $"collectionId={id}&order=oldest&kind=add&createdBy=alice"));
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.GetAsync($"/changesets?collectionId={id}&order=sideways")).StatusCode);
    }

    [Fact]
    public async Task ChangeSetFacets_SayWhoMadeChanges_AndHowManyOfEachKind()
    {
        var (id, alice, _, _) = await TwoPeopleAsync();

        var facets = (await alice.GetFromJsonAsync<ChangeSetFacets>($"/changesets/facets?collectionId={id}", Json))!;

        Assert.Equal([("alice", "User alice", 4), ("bob", "User bob", 4)], facets.Authors.Select(a => (a.Id, a.Name, a.Count)));
        Assert.Equal([("add", 4), ("change", 1), ("delete", 1), ("people", 2)], facets.Kinds.Select(k => (k.Kind, k.Count)));
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
    [InlineData("rename collection", "change")]
    [InlineData("share collection", "people")]
    [InlineData("stop sharing collection", "people")]
    [InlineData("end session", "people")]
    [InlineData("join session", "people")]
    [InlineData("leave session", "people")]
    [InlineData("change role", "people")]
    [InlineData("remove member", "people")]
    [InlineData("make invite link", "people")]
    [InlineData("change invite link", "people")]
    [InlineData("stop invite link", "people")]
    public void AChangesKind_ComesFromWhatItDid(string what, string kind) => Assert.Equal(kind, ChangeKinds.Of(what));

    // A kind of its own in the list, and in none of the others.
    [Fact]
    public async Task EveryPeopleChange_IsOnlyInItsOwnKind()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        await WithDbAsync(async db =>
        {
            db.ChangeSets.AddRange(ChangeKinds.PeopleWhats.Select(what => new ChangeSet
            {
                Id = Guid.NewGuid(),
                CollectionId = id,
                UserId = "alice",
                UserName = "User alice",
                What = what,
                Created = DateTimeOffset.UtcNow,
            }));
            return await db.SaveChangesAsync();
        });

        foreach (var kind in ChangeKinds.All)
        {
            var listed = await WhatsAsync(alice, $"collectionId={id}&kind={kind}");
            Assert.Equal(kind == ChangeKinds.People ? ChangeKinds.PeopleWhats.Order() : [], listed.Order());
        }
        Assert.Equal([("people", ChangeKinds.PeopleWhats.Length)],
            (await alice.GetFromJsonAsync<ChangeSetFacets>($"/changesets/facets?collectionId={id}", Json))!.Kinds.Select(k => (k.Kind, k.Count)));
    }

    // --- Names, sharing, sessions, people and links ---

    private static async Task<(Guid Id, string Code)> SessionWithLinkAsync(HttpClient host, CollectionRole role = CollectionRole.Editor)
    {
        var start = await host.PostAsJsonAsync("/sessions", new EnsureRequest(NewSlide(), "Ki-67 review"), Json);
        var id = (await start.Content.ReadFromJsonAsync<CollectionView>(Json))!.CollectionId;
        return (id, await LinkAsync(host, id, role));
    }

    private static async Task<string> LinkAsync(HttpClient host, Guid id, CollectionRole role = CollectionRole.Editor)
    {
        var invite = await host.PostAsJsonAsync($"/collections/{id}/invites", new InviteRequest(role, 24), Json);
        invite.EnsureSuccessStatusCode();
        return (await invite.Content.ReadFromJsonAsync<InviteView>(Json))!.Code;
    }

    // Every change in it, oldest first, as who did what to whom: "Role Viewer
    // to Editor on User bob". Times are only said to be there.
    private static async Task<List<string>> StoryAsync(HttpClient client, Guid id)
    {
        var story = new List<string>();
        static string Value(System.Text.Json.JsonElement value) => value.ValueKind switch
        {
            System.Text.Json.JsonValueKind.Null => "nothing",
            System.Text.Json.JsonValueKind.String => DateTimeOffset.TryParse(value.GetString(), out _) ? "a time" : value.GetString()!,
            _ => value.GetRawText().ToLowerInvariant(),
        };
        foreach (var change in (await client.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}&order=oldest", Json))!)
        {
            var did = (await ChangesAsync(client, change.Id)).Changes
                .OrderBy(c => c.Entity).ThenBy(c => c.Column)
                .Select(c => $"{c.Column} {Value(c.Before)} to {Value(c.After)}{(c.Names.FirstOrDefault() is { } name ? $" on {name}" : "")}");
            story.Add($"{change.UserName}: {change.What} ({string.Join(", ", did)})");
        }
        return story;
    }

    [Fact]
    public async Task RenamingAndSharing_AreChanges_WithWhatItWas()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;

        (await alice.PutAsJsonAsync($"/collections/{id}", new RenameRequest("Margins"), Json)).EnsureSuccessStatusCode();
        (await alice.PutAsJsonAsync($"/collections/{id}/sharing", new SharingRequest(true), Json)).EnsureSuccessStatusCode();
        (await alice.PutAsJsonAsync($"/collections/{id}/sharing", new SharingRequest(false), Json)).EnsureSuccessStatusCode();

        Assert.Equal(
            [
                "User alice: rename collection (CollectionName User alice's collection to Margins on Margins)",
                "User alice: share collection (Shared false to true on Margins)",
                "User alice: stop sharing collection (Shared true to false on Margins)",
            ],
            await StoryAsync(alice, id));
    }

    [Fact]
    public async Task ASessionsPeopleAndLinks_AreAllChanges_ByWhoDidThem()
    {
        var (alice, bob, carol) = (As("alice"), As("bob"), As("carol"));
        var (id, first) = await SessionWithLinkAsync(alice, CollectionRole.Viewer);
        (await bob.PostAsync($"/invites/{first}/accept", null)).EnsureSuccessStatusCode();
        (await carol.PostAsync($"/invites/{first}/accept", null)).EnsureSuccessStatusCode();
        (await alice.PutAsJsonAsync($"/collections/{id}/members/bob", new MemberRequest("", CollectionRole.Editor), Json)).EnsureSuccessStatusCode();
        var second = await LinkAsync(alice, id);
        // A better link than the one they came in on.
        (await carol.PostAsync($"/invites/{second}/accept", null)).EnsureSuccessStatusCode();
        (await alice.PutAsJsonAsync($"/collections/{id}/invites/{second}", new InviteRequest(CollectionRole.Viewer, 24), Json)).EnsureSuccessStatusCode();
        (await alice.DeleteAsync($"/collections/{id}/members/bob")).EnsureSuccessStatusCode();
        (await carol.DeleteAsync($"/collections/{id}/members/carol")).EnsureSuccessStatusCode();
        (await alice.DeleteAsync($"/collections/{id}/invites/{second}")).EnsureSuccessStatusCode();
        await LinkAsync(alice, id);
        (await alice.PostAsync($"/collections/{id}/end", null)).EnsureSuccessStatusCode();

        Assert.Equal(
            [
                "User alice: make invite link (Expires nothing to a time, Role nothing to Viewer)",
                "User bob: join session (Role nothing to Viewer on User bob)",
                "User carol: join session (Role nothing to Viewer on User carol)",
                "User alice: change role (Role Viewer to Editor on User bob)",
                "User alice: make invite link (Expires nothing to a time, Role nothing to Editor, Stopped nothing to a time)",
                "User carol: change role (Role Viewer to Editor on User carol)",
                "User alice: change invite link (Expires a time to a time, Role Editor to Viewer)",
                "User alice: remove member (Role Editor to nothing on User bob)",
                "User carol: leave session (Role Editor to nothing on User carol)",
                "User alice: stop invite link (Stopped nothing to a time)",
                "User alice: make invite link (Expires nothing to a time, Role nothing to Editor)",
                "User alice: end session (Ended nothing to a time on Ki-67 review, Stopped nothing to a time)",
            ],
            await StoryAsync(alice, id));
    }

    [Fact]
    public async Task SavingASettingThatsAlreadyThere_IsntAChange()
    {
        var (alice, bob) = (As("alice"), As("bob"));
        var own = (await OwnAsync(alice)).CollectionId;
        (await alice.PutAsJsonAsync($"/collections/{own}", new RenameRequest(" User alice's collection "), Json)).EnsureSuccessStatusCode();
        (await alice.PutAsJsonAsync($"/collections/{own}/sharing", new SharingRequest(false), Json)).EnsureSuccessStatusCode();
        // Opening the slide again, as whatever you're called now.
        await OwnAsync(TestAuthHandler.As(_factory.CreateClient(), "alice", "Alice Moore"), (await alice.GetFromJsonAsync<CollectionView>($"/collections/{own}", Json))!.SlideId);
        Assert.Empty(await StoryAsync(alice, own));

        var (id, code) = await SessionWithLinkAsync(alice);
        (await bob.PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();
        var before = await StoryAsync(alice, id);
        (await bob.PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();
        (await alice.PutAsJsonAsync($"/collections/{id}/members/bob", new MemberRequest("", CollectionRole.Editor), Json)).EnsureSuccessStatusCode();
        (await alice.DeleteAsync($"/collections/{id}/invites/{code}")).EnsureSuccessStatusCode();
        (await alice.DeleteAsync($"/collections/{id}/invites/{code}")).EnsureSuccessStatusCode();
        Assert.Equal([.. before, "User alice: stop invite link (Stopped nothing to a time)"], await StoryAsync(alice, id));
    }

    // Turned down, so there's nothing to say they did.
    [Fact]
    public async Task ATurnedDownSetting_LeavesNoChangeSet()
    {
        var (alice, bob) = (As("alice"), As("bob"));
        var (id, code) = await SessionWithLinkAsync(alice, CollectionRole.Editor);
        (await bob.PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();
        var before = await StoryAsync(alice, id);

        Assert.Equal(HttpStatusCode.Forbidden, (await bob.PutAsJsonAsync($"/collections/{id}", new RenameRequest("mine"), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.PostAsync($"/collections/{id}/end", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await bob.DeleteAsync($"/collections/{id}/members/alice")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.DeleteAsync($"/collections/{id}/members/alice")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.PutAsJsonAsync($"/collections/{id}/sharing", new SharingRequest(true), Json)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.PostAsJsonAsync($"/collections/{id}/invites", new InviteRequest(CollectionRole.Owner, 24), Json)).StatusCode);

        Assert.Equal(before, await StoryAsync(alice, id));
    }

    // A link's code is the only thing between it and the session, and anyone
    // in the session - guests too - can read its history.
    [Fact]
    public async Task ALinksCode_IsNeverInTheHistory()
    {
        var alice = As("alice");
        var (id, first) = await SessionWithLinkAsync(alice);
        var second = await LinkAsync(alice, id);
        (await As("bob").PostAsync($"/invites/{second}/accept", null)).EnsureSuccessStatusCode();
        (await alice.PutAsJsonAsync($"/collections/{id}/invites/{second}", new InviteRequest(CollectionRole.Viewer, 1), Json)).EnsureSuccessStatusCode();
        (await alice.DeleteAsync($"/collections/{id}/invites/{second}")).EnsureSuccessStatusCode();

        var stored = await WithDbAsync(async db => (
            Entries: System.Text.Json.JsonSerializer.Serialize(await db.HistoryEntries.Where(e => e.CollectionId == id).ToListAsync()),
            Sets: System.Text.Json.JsonSerializer.Serialize(await db.ChangeSets.Where(c => c.CollectionId == id).ToListAsync())));
        var served = new List<string> { await alice.GetStringAsync($"/changesets?collectionId={id}") };
        foreach (var change in (await alice.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}", Json))!)
        {
            served.Add(await alice.GetStringAsync($"/changesets/{change.Id}/changes"));
            served.Add(await alice.GetStringAsync($"/changesets/{change.Id}/deleted"));
        }

        Assert.All([stored.Entries, stored.Sets, .. served], text =>
        {
            Assert.DoesNotContain(first, text);
            Assert.DoesNotContain(second, text);
        });
    }

    // Putting one back would let someone in again, so it's turned down, with
    // nothing left behind.
    [Fact]
    public async Task ASetting_CantBePutBack_AndNobodyComesBackWithIt()
    {
        var (alice, bob) = (As("alice"), As("bob"));
        var (id, code) = await SessionWithLinkAsync(alice);
        (await bob.PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();
        (await alice.DeleteAsync($"/collections/{id}/members/bob")).EnsureSuccessStatusCode();
        (await alice.PutAsJsonAsync($"/collections/{id}", new RenameRequest("Renamed"), Json)).EnsureSuccessStatusCode();
        (await alice.DeleteAsync($"/collections/{id}/invites/{code}")).EnsureSuccessStatusCode();
        var before = (await alice.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}", Json))!;

        foreach (var change in before)
        {
            Assert.Equal(0, change.Deleted);
            Assert.Equal(HttpStatusCode.Conflict, (await RestoreAsync(alice, change.Id)).StatusCode);
        }

        Assert.Equal(before.Count, await alice.GetFromJsonAsync<int>($"/changesets/total?collectionId={id}"));
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/annotations?collectionId={id}")).StatusCode);
        Assert.Equal("Renamed", (await alice.GetFromJsonAsync<CollectionView>($"/collections/{id}", Json))!.CollectionName);
        Assert.Equal(HttpStatusCode.Gone, (await bob.PostAsync($"/invites/{code}/accept", null)).StatusCode);
    }

    // Its links stopping is part of deleting it, and they stay stopped.
    [Fact]
    public async Task DeletingASession_SaysItsLinkStopped_AndPuttingItBackLeavesItStopped()
    {
        var (alice, bob) = (As("alice"), As("bob"));
        var (id, code) = await SessionWithLinkAsync(alice);
        (await bob.PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();
        var delete = ChangeSetOf(await alice.DeleteAsync($"/collections/{id}"));
        Assert.Contains(await EntriesAsync(delete), e => e.Entity == HistoryLog.Invite && e.Op == HistoryOp.Update);

        (await RestoreAsync(alice, delete)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.OK, (await bob.GetAsync($"/annotations?collectionId={id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Gone, (await As("carol").PostAsync($"/invites/{code}/accept", null)).StatusCode);
        Assert.Contains("User alice: delete collection (Stopped nothing to a time)", await StoryAsync(alice, id));
    }

    // --- Everything a change deleted ---

    [Fact]
    public async Task EverythingAChangeDeleted_CanBeListedAPageAtATime_InTheOrderItWent()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var ids = new List<Guid>();
        for (var i = 0; i < 12; i++) ids.Add((await AddOnSlicesAsync(alice, id, $"Region {i}", i, i + 2)).Id);
        var delete = ChangeSetOf(await alice.PostAsJsonAsync("/annotations/bulk-delete", new BulkDeleteRequest(id, ids), Json));

        var all = (await alice.GetFromJsonAsync<DeletedPage>($"/changesets/{delete}/deleted", Json))!;
        var pages = new List<DeletedRow>();
        for (var skip = 0; skip < 15; skip += 5)
        {
            var page = (await alice.GetFromJsonAsync<DeletedPage>($"/changesets/{delete}/deleted?skip={skip}&take=5", Json))!;
            Assert.Equal(12, page.Total);
            pages.AddRange(page.Rows);
        }

        Assert.Equal((12, 12), (all.Total, all.Rows.Count));
        Assert.Equal(all.Rows, pages);
        Assert.Equal(ids.Order(), pages.Select(r => r.Id).Order());
        Assert.All(pages, r => Assert.Equal(("annotation", $"Region {r.SliceFrom}", r.SliceFrom + 2), (r.Entity, r.Name, r.SliceTo)));
        // The first few are the ones the change already names.
        Assert.Equal((await ChangesAsync(alice, delete)).DeletedRows, pages.Take(ChangeSetChangesEndpoint.NamesShown));
    }

    [Theory]
    [InlineData("region 1", 3)]
    [InlineData("  REGION 11 ", 1)]
    [InlineData("100%", 1)]
    [InlineData("_", 1)]
    [InlineData("'; --", 0)]
    [InlineData("", 14)]
    public async Task WhatAChangeDeleted_CanBeFoundByName(string search, int found)
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var ids = new List<Guid>();
        foreach (var label in Enumerable.Range(0, 12).Select(i => $"Region {i}").Append("100% sure").Append("a_b"))
            ids.Add((await AddAnnotationAsync(alice, id, label)).Id);
        var delete = ChangeSetOf(await alice.PostAsJsonAsync("/annotations/bulk-delete", new BulkDeleteRequest(id, ids), Json));

        var page = (await alice.GetFromJsonAsync<DeletedPage>($"/changesets/{delete}/deleted?search={Uri.EscapeDataString(search)}&take=2", Json))!;

        Assert.Equal((found, Math.Min(found, 2)), (page.Total, page.Rows.Count));
    }

    // A count's region goes with it, so isn't one of its own.
    [Fact]
    public async Task WhatAChangeDeleted_IsEveryKindOfRow_AndStaysListedOnceItsBack()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var annotation = await AddAnnotationAsync(alice, id, "Duct");
        var group = await AddGroupAsync(alice, id, "Stroma", [annotation.Id]);
        var counted = await alice.PostAsJsonAsync("/cellcounts", new CellCount
        {
            CollectionId = id,
            Label = "Mitoses",
            Dots = "[]",
            Slice = 4,
            RegionOfInterest = new RegionOfInterest { GeoJson = "{}" },
        });
        var count = (await counted.Content.ReadFromJsonAsync<CellCount>(Json))!;
        var change = Guid.NewGuid();
        foreach (var url in new[] { $"/annotationgroups/{group.Id}", $"/annotations/{annotation.Id}", $"/cellcounts/{count.Id}" })
            (await alice.SendAsync(InChangeSet(HttpMethod.Delete, url, change))).EnsureSuccessStatusCode();

        async Task<List<(string, string?, int?)>> ListedAsync() =>
            (await alice.GetFromJsonAsync<DeletedPage>($"/changesets/{change}/deleted", Json))!.Rows.Select(r => (r.Entity, r.Name, r.SliceFrom)).ToList();
        List<(string, string?, int?)> expected = [("group", "Stroma", null), ("annotation", "Duct", null), ("cellCount", "Mitoses", 4)];
        Assert.Equal(expected, await ListedAsync());

        (await RestoreAsync(alice, change)).EnsureSuccessStatusCode();
        Assert.Equal(expected, await ListedAsync());
    }

    [Fact]
    public async Task WhatAChangeDeleted_IsForPeopleInTheCollection()
    {
        var alice = As("alice");
        var id = (await OwnAsync(alice)).CollectionId;
        var delete = ChangeSetOf(await alice.DeleteAsync($"/annotations/{(await AddAnnotationAsync(alice, id)).Id}"));

        Assert.Equal(HttpStatusCode.NotFound, (await As("bob").GetAsync($"/changesets/{delete}/deleted")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/changesets/{Guid.NewGuid()}/deleted")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.GetAsync($"/changesets/{delete}/deleted?take=0")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.GetAsync($"/changesets/{delete}/deleted?skip=-1")).StatusCode);
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
