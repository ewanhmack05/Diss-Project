using System.Net;
using System.Net.Http.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using AnnotationStore.History;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AnnotationStore.Tests;

// One annotation's or count's timeline, and putting it back to any point on it.
// See History/ItemHistory.cs.
public class ItemHistoryTests : IClassFixture<CellCountApiFactory>
{
    private static readonly System.Text.Json.JsonSerializerOptions Json = TestJson.Options;

    private readonly CellCountApiFactory _factory;

    public ItemHistoryTests(CellCountApiFactory factory)
    {
        _factory = factory;
    }

    private HttpClient As(string userId) => TestAuthHandler.As(_factory.CreateClient(), userId, $"User {userId}");

    private static async Task<Guid> OwnAsync(HttpClient client)
    {
        var response = await client.PostAsJsonAsync("/collections/ensure", new EnsureRequest(Guid.NewGuid().ToString()));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CollectionView>(Json))!.CollectionId;
    }

    private static async Task<Guid> SessionAsync(HttpClient host, HttpClient? editor = null, HttpClient? viewer = null)
    {
        var start = await host.PostAsJsonAsync("/sessions", new EnsureRequest(Guid.NewGuid().ToString()));
        var id = (await start.Content.ReadFromJsonAsync<CollectionView>(Json))!.CollectionId;
        foreach (var (client, role) in new[] { (editor, CollectionRole.Editor), (viewer, CollectionRole.Viewer) })
        {
            if (client is null) continue;
            var invite = await host.PostAsJsonAsync($"/collections/{id}/invites", new InviteRequest(role, 24), Json);
            var code = (await invite.Content.ReadFromJsonAsync<InviteView>(Json))!.Code;
            (await client.PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();
        }
        return id;
    }

    private static async Task<Annotation> AddAsync(HttpClient client, Guid collectionId, string label = "v1", string colour = "#FF0000", Guid? groupId = null)
    {
        var response = await client.PostAsJsonAsync("/annotations",
            new Annotation { CollectionId = collectionId, Label = label, Colour = colour, Shape = "Box", GeoJson = "{\"shape\":1}", GroupId = groupId });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<Annotation>(Json))!;
    }

    private static async Task EditAsync(HttpClient client, Guid id, string label, string notes = "", string colour = "#FF0000") =>
        (await client.PutAsJsonAsync($"/annotations/{id}", new Annotation { Label = label, Notes = notes, Colour = colour })).EnsureSuccessStatusCode();

    private static async Task<ItemTimeline> TimelineAsync(HttpClient client, Guid collectionId, Guid id, string path = "annotations", string paging = "") =>
        (await client.GetFromJsonAsync<ItemTimeline>($"/{path}/{id}/history?collectionId={collectionId}{paging}", Json))!;

    private static Task<HttpResponseMessage> GoBackAsync(HttpClient client, Guid id, long entry, long? latest = null, string path = "annotations") =>
        client.PostAsync($"/{path}/{id}/history/{entry}/restore{(latest is { } seen ? $"?latest={seen}" : "")}", null);

    private static async Task<Annotation> ReadAsync(HttpClient client, Guid collectionId, Guid id) =>
        (await client.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={collectionId}", Json))!.Single(a => a.Id == id);

    private async Task<int> ChangeSetCountAsync(Guid collectionId)
    {
        using var scope = _factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AnnotationDbContext>().ChangeSets.CountAsync(c => c.CollectionId == collectionId);
    }

    private static HistoryEntry Entry(HistoryOp op, string? before = null) => new() { Op = op, Before = before };

    [Fact]
    public void WalkBack_UndoesEachEntry_NewestFirst()
    {
        var walked = ItemHistory.WalkBack([
            Entry(HistoryOp.Update, """{"Label":"b"}"""),
            Entry(HistoryOp.Update, """{"Label":"a","Colour":"red"}"""),
        ]);

        Assert.Equal("a", walked.Columns["Label"].GetString());
        Assert.Equal("red", walked.Columns["Colour"].GetString());
        Assert.False(walked.Whole);
        Assert.False(walked.Absent);
    }

    // Edited, deleted, put back, edited - going back past all of that lands on
    // the delete's copy, with the edit before the delete undone on top of it.
    [Fact]
    public void WalkBack_GoesThroughADeleteAndTheCreateThatBroughtItBack()
    {
        var walked = ItemHistory.WalkBack([
            Entry(HistoryOp.Update, """{"Label":"after"}"""),
            Entry(HistoryOp.Create),
            Entry(HistoryOp.Delete, """{"Label":"deleted as","Colour":"red","GeoJson":"{}"}"""),
            Entry(HistoryOp.Update, """{"Label":"first"}"""),
        ]);

        Assert.True(walked.Whole);
        Assert.False(walked.Absent);
        Assert.Equal("first", walked.Columns["Label"].GetString());
        Assert.Equal("red", walked.Columns["Colour"].GetString());
        Assert.Equal("{}", walked.Columns["GeoJson"].GetString());
    }

    [Fact]
    public void WalkBack_PastItsCreate_MeansItWasntThere()
    {
        Assert.True(ItemHistory.WalkBack([Entry(HistoryOp.Update, """{"Label":"b"}"""), Entry(HistoryOp.Create)]).Absent);
    }

    [Fact]
    public void WalkBack_OfNothing_ChangesNothing()
    {
        var walked = ItemHistory.WalkBack([]);

        Assert.Empty(walked.Columns);
        Assert.False(walked.Whole || walked.Absent);
    }

    [Fact]
    public async Task Timeline_IsEveryEntryForThatRowOnly_NewestFirst_WithWhoAndWhat()
    {
        var alice = As("alice");
        var bob = As("bob");
        var id = await SessionAsync(alice, editor: bob);
        var annotation = await AddAsync(alice, id);
        await AddAsync(alice, id, "someone else's");
        await EditAsync(bob, annotation.Id, "v2");

        var timeline = await TimelineAsync(alice, id, annotation.Id);

        Assert.Equal(2, timeline.Total);
        Assert.Equal(timeline.Versions[0].Id, timeline.Latest);
        var edit = timeline.Versions[0];
        Assert.Equal(("update", "bob", "User bob", "change annotation"), (edit.Op, edit.UserId, edit.UserName, edit.What));
        var label = Assert.Single(edit.Changes);
        Assert.Equal(("Label", "v1", "v2"), (label.Column, label.Before.GetString(), label.After.GetString()));
        var add = timeline.Versions[1];
        Assert.Equal(("create", "alice"), (add.Op, add.UserId));
        Assert.Empty(add.Changes);
    }

    [Fact]
    public async Task Timeline_PagesAndNamesItsGroups_AndNeverSendsADeletedCopy()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var annotation = await AddAsync(alice, id);
        var group = await (await alice.PostAsJsonAsync("/annotationgroups", new NewGroupRequest(id, "Tumour", [annotation.Id]), Json))
            .Content.ReadFromJsonAsync<GroupView>(Json);
        await alice.DeleteAsync($"/annotations/{annotation.Id}");

        var page = await TimelineAsync(alice, id, annotation.Id, paging: "&skip=0&take=1");
        Assert.Equal(3, page.Total);
        var delete = Assert.Single(page.Versions);
        Assert.Equal("delete", delete.Op);
        Assert.Empty(delete.Changes);

        var next = await TimelineAsync(alice, id, annotation.Id, paging: "&skip=1&take=1");
        Assert.Equal("GroupId", Assert.Single(Assert.Single(next.Versions).Changes).Column);
        Assert.Equal("Tumour", next.Groups[group!.Id]);
        Assert.Equal(page.Latest, next.Latest);

        Assert.Equal(HttpStatusCode.BadRequest, (await alice.GetAsync($"/annotations/{annotation.Id}/history?collectionId={id}&take=0")).StatusCode);
    }

    [Fact]
    public async Task GoingBack_UndoesEverythingSince_WhoeverDidIt_AsAChangeOfItsOwn()
    {
        var alice = As("alice");
        var bob = As("bob");
        var id = await SessionAsync(alice, editor: bob);
        var annotation = await AddAsync(alice, id);
        await EditAsync(alice, annotation.Id, "v2", "notes 2");
        var v2 = (await TimelineAsync(alice, id, annotation.Id)).Versions[0].Id;
        await EditAsync(bob, annotation.Id, "v3", "notes 3", "#0000FF");

        var response = await GoBackAsync(alice, annotation.Id, v2);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var restored = (await response.Content.ReadFromJsonAsync<RestoredView>(Json))!;
        Assert.Equal(annotation.Id, Assert.Single(restored.ChangedAnnotations).Id);
        Assert.Empty(restored.Annotations);
        Assert.Equal(new RestoreResult(0, 0, 0, 0, false), restored.Counts);

        var now = await ReadAsync(alice, id, annotation.Id);
        Assert.Equal(("v2", "notes 2", "#FF0000"), (now.Label, now.Notes, now.Colour));
        Assert.Equal("{\"shape\":1}", now.GeoJson);

        var latest = (await TimelineAsync(alice, id, annotation.Id)).Versions[0];
        Assert.Equal(("update", "alice", "restore annotation"), (latest.Op, latest.UserId, latest.What));
        Assert.Equal(["Colour", "Label", "Notes"], latest.Changes.Select(c => c.Column).Order());

        // And that can be gone back on too - nothing's lost.
        var v3 = (await TimelineAsync(alice, id, annotation.Id)).Versions[1].Id;
        (await GoBackAsync(bob, annotation.Id, v3)).EnsureSuccessStatusCode();
        Assert.Equal("v3", (await ReadAsync(alice, id, annotation.Id)).Label);
    }

    [Fact]
    public async Task GoingBackToWhenItWasAdded_IsHowItStarted()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var annotation = await AddAsync(alice, id);
        await EditAsync(alice, annotation.Id, "v2");
        await EditAsync(alice, annotation.Id, "v3");
        var added = (await TimelineAsync(alice, id, annotation.Id)).Versions[^1];

        (await GoBackAsync(alice, annotation.Id, added.Id)).EnsureSuccessStatusCode();

        Assert.Equal("v1", (await ReadAsync(alice, id, annotation.Id)).Label);
    }

    [Fact]
    public async Task ALaterChangeNotSeen_TurnsItDown_AndChangesNothing()
    {
        var alice = As("alice");
        var bob = As("bob");
        var id = await SessionAsync(alice, editor: bob);
        var annotation = await AddAsync(alice, id);
        await EditAsync(alice, annotation.Id, "v2");
        var seen = await TimelineAsync(alice, id, annotation.Id);
        await EditAsync(bob, annotation.Id, "bob's, while alice was looking");
        var changeSets = await ChangeSetCountAsync(id);

        var refused = await GoBackAsync(alice, annotation.Id, seen.Versions[1].Id, seen.Latest);

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal("bob's, while alice was looking", (await ReadAsync(alice, id, annotation.Id)).Label);
        Assert.Equal(changeSets, await ChangeSetCountAsync(id));

        var fresh = await TimelineAsync(alice, id, annotation.Id);
        (await GoBackAsync(alice, annotation.Id, seen.Versions[1].Id, fresh.Latest)).EnsureSuccessStatusCode();
        Assert.Equal("v1", (await ReadAsync(alice, id, annotation.Id)).Label);
    }

    [Fact]
    public async Task GoingBackToHowItAlreadyIs_IsntAChange()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var annotation = await AddAsync(alice, id);
        await EditAsync(alice, annotation.Id, "v2");
        var timeline = await TimelineAsync(alice, id, annotation.Id);
        var changeSets = await ChangeSetCountAsync(id);

        var response = await GoBackAsync(alice, annotation.Id, timeline.Versions[0].Id, timeline.Latest);

        var restored = (await response.Content.ReadFromJsonAsync<RestoredView>(Json))!;
        Assert.Empty(restored.ChangedAnnotations);
        Assert.Equal(changeSets, await ChangeSetCountAsync(id));
        Assert.Equal(2, (await TimelineAsync(alice, id, annotation.Id)).Total);
    }

    [Fact]
    public async Task Preview_SaysWhatWouldChange_AndChangesNothing()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var annotation = await AddAsync(alice, id);
        await EditAsync(alice, annotation.Id, "v2", colour: "#00FF00");
        var timeline = await TimelineAsync(alice, id, annotation.Id);
        var changeSets = await ChangeSetCountAsync(id);

        var preview = (await alice.GetFromJsonAsync<ItemPreview>($"/annotations/{annotation.Id}/history/{timeline.Versions[1].Id}", Json))!;

        Assert.False(preview.Gone);
        Assert.Equal(timeline.Latest, preview.Latest);
        var byColumn = preview.Changes.ToDictionary(c => c.Column);
        Assert.Equal(2, byColumn.Count);
        Assert.Equal(("v2", "v1"), (byColumn["Label"].Before.GetString(), byColumn["Label"].After.GetString()));
        Assert.Equal(("#00FF00", "#FF0000"), (byColumn["Colour"].Before.GetString(), byColumn["Colour"].After.GetString()));
        Assert.Equal("v2", (await ReadAsync(alice, id, annotation.Id)).Label);
        Assert.Equal(changeSets, await ChangeSetCountAsync(id));
    }

    [Fact]
    public async Task ADeletedAnnotation_ComesBackHowItWasAtThatPoint()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var annotation = await AddAsync(alice, id);
        await EditAsync(alice, annotation.Id, "v2");
        var v2 = (await TimelineAsync(alice, id, annotation.Id)).Versions[0].Id;
        await EditAsync(alice, annotation.Id, "v3");
        // Read back, since Postgres keeps fewer decimal places than the POST answered with.
        var created = (await ReadAsync(alice, id, annotation.Id)).Created;
        var delete = await alice.DeleteAsync($"/annotations/{annotation.Id}");
        var deleteSet = Guid.Parse(delete.Headers.GetValues(ChangeSetEndpoints.Header).Single());

        var preview = (await alice.GetFromJsonAsync<ItemPreview>($"/annotations/{annotation.Id}/history/{v2}", Json))!;
        Assert.True(preview.Gone);
        var label = preview.Changes.Single(c => c.Column == "Label");
        Assert.Equal(System.Text.Json.JsonValueKind.Null, label.Before.ValueKind);
        Assert.Equal("v2", label.After.GetString());

        var response = await GoBackAsync(alice, annotation.Id, v2);

        var restored = (await response.Content.ReadFromJsonAsync<RestoredView>(Json))!;
        Assert.Equal(new RestoreResult(1, 0, 0, 0, false), restored.Counts);
        Assert.Equal(annotation.Id, Assert.Single(restored.Annotations).Id);
        var now = await ReadAsync(alice, id, annotation.Id);
        Assert.Equal(("v2", "{\"shape\":1}", created), (now.Label, now.GeoJson, now.Created));

        // The change set's own Put back has nothing left to do.
        var list = (await alice.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}", Json))!;
        Assert.Equal(0, list.Single(c => c.Id == deleteSet).Deleted);
        var again = await alice.PostAsync($"/changesets/{deleteSet}/restore", null);
        Assert.Equal(new RestoreResult(0, 0, 0, 0, false), (await again.Content.ReadFromJsonAsync<RestoredView>(Json))!.Counts);
    }

    [Fact]
    public async Task GoingBackToADelete_MeansHowItWasWhenItWasDeleted()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var annotation = await AddAsync(alice, id);
        await EditAsync(alice, annotation.Id, "as deleted");
        await alice.DeleteAsync($"/annotations/{annotation.Id}");
        var deleted = (await TimelineAsync(alice, id, annotation.Id)).Versions[0];
        Assert.Equal("delete", deleted.Op);

        (await GoBackAsync(alice, annotation.Id, deleted.Id, deleted.Id)).EnsureSuccessStatusCode();

        Assert.Equal("as deleted", (await ReadAsync(alice, id, annotation.Id)).Label);
        Assert.Equal("create", (await TimelineAsync(alice, id, annotation.Id)).Versions[0].Op);
    }

    // Back past a delete and its put back, with the row here now.
    [Fact]
    public async Task GoingBack_PastADeleteThatWasPutBack_StillLandsRight()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var annotation = await AddAsync(alice, id);
        await EditAsync(alice, annotation.Id, "v2");
        var v2 = (await TimelineAsync(alice, id, annotation.Id)).Versions[0].Id;
        await EditAsync(alice, annotation.Id, "v3");
        var delete = await alice.DeleteAsync($"/annotations/{annotation.Id}");
        (await alice.PostAsync($"/changesets/{delete.Headers.GetValues(ChangeSetEndpoints.Header).Single()}/restore", null)).EnsureSuccessStatusCode();
        await EditAsync(alice, annotation.Id, "v4");

        (await GoBackAsync(alice, annotation.Id, v2)).EnsureSuccessStatusCode();

        Assert.Equal("v2", (await ReadAsync(alice, id, annotation.Id)).Label);
    }

    [Fact]
    public async Task ACellCount_GoesBack_AndComesBackWithItsDotsAndRegion()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var response = await alice.PostAsJsonAsync("/cellcounts", new CellCount
        {
            CollectionId = id,
            Label = "c1",
            Dots = "[{\"x\":1,\"y\":2,\"colour\":\"#ff0000\"}]",
            Count = 1,
            WithRoi = true,
            RegionOfInterest = new RegionOfInterest { GeoJson = "{\"roi\":1}" },
        });
        var count = (await response.Content.ReadFromJsonAsync<CellCount>(Json))!;
        (await alice.PutAsJsonAsync($"/cellcounts/{count.Id}", new CellCount { Label = "c2", Notes = "", WithRoi = true, Count = 1 })).EnsureSuccessStatusCode();
        var timeline = await TimelineAsync(alice, id, count.Id, "cellcounts");
        Assert.Equal(["update", "create"], timeline.Versions.Select(v => v.Op));

        // While it's here: only the label changes, and the answer has no dots.
        var back = await GoBackAsync(alice, count.Id, timeline.Versions[1].Id, path: "cellcounts");
        var changed = (await back.Content.ReadFromJsonAsync<RestoredView>(Json))!;
        Assert.Equal("c1", Assert.Single(changed.ChangedCellCounts).Label);
        Assert.Null(changed.ChangedCellCounts[0].Dots);

        // Once it's deleted: back whole, dots and region and all.
        await alice.DeleteAsync($"/cellcounts/{count.Id}");
        var latest = (await TimelineAsync(alice, id, count.Id, "cellcounts")).Versions[0];
        var returned = await GoBackAsync(alice, count.Id, latest.Id, latest.Id, "cellcounts");
        var restored = (await returned.Content.ReadFromJsonAsync<RestoredView>(Json))!;
        Assert.Equal(new RestoreResult(0, 0, 1, 0, false), restored.Counts);
        Assert.Equal(count.Id, Assert.Single(restored.CellCounts).Id);

        var full = (await alice.GetFromJsonAsync<CellCount>($"/cellcounts/{count.Id}", Json))!;
        Assert.Equal(("c1", count.Dots), (full.Label, full.Dots));
        Assert.Equal("{\"roi\":1}", full.RegionOfInterest!.GeoJson);
    }

    [Fact]
    public async Task AGroupThatsGone_ComesBackAsNone_AndAMergedOneAsWhereItWent()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var a = await AddAsync(alice, id, "a");
        var b = await AddAsync(alice, id, "b");
        var from = (await (await alice.PostAsJsonAsync("/annotationgroups", new NewGroupRequest(id, "from", [a.Id]), Json)).Content.ReadFromJsonAsync<GroupView>(Json))!;
        var doomed = (await (await alice.PostAsJsonAsync("/annotationgroups", new NewGroupRequest(id, "doomed", [b.Id]), Json)).Content.ReadFromJsonAsync<GroupView>(Json))!;
        var into = (await (await alice.PostAsJsonAsync("/annotationgroups", new NewGroupRequest(id, "into", null), Json)).Content.ReadFromJsonAsync<GroupView>(Json))!;
        var inFrom = (await TimelineAsync(alice, id, a.Id)).Versions[0].Id;
        var inDoomed = (await TimelineAsync(alice, id, b.Id)).Versions[0].Id;
        (await alice.PostAsJsonAsync($"/annotationgroups/{from.Id}/merge", new GroupMergeRequest(into.Id), Json)).EnsureSuccessStatusCode();
        (await alice.DeleteAsync($"/annotationgroups/{doomed.Id}")).EnsureSuccessStatusCode();
        await EditAsync(alice, a.Id, "a2");
        await EditAsync(alice, b.Id, "b2");

        var preview = (await alice.GetFromJsonAsync<ItemPreview>($"/annotations/{b.Id}/history/{inDoomed}", Json))!;
        Assert.Equal("doomed", preview.GroupGone);
        (await GoBackAsync(alice, a.Id, inFrom)).EnsureSuccessStatusCode();
        (await GoBackAsync(alice, b.Id, inDoomed)).EnsureSuccessStatusCode();

        var nowA = await ReadAsync(alice, id, a.Id);
        var nowB = await ReadAsync(alice, id, b.Id);
        Assert.Equal(("a", (Guid?)into.Id), (nowA.Label, nowA.GroupId));
        Assert.Equal(("b", (Guid?)null), (nowB.Label, nowB.GroupId));
    }

    [Fact]
    public async Task AnyoneInItCanLook_OnlyEditorsCanGoBack()
    {
        var alice = As("alice");
        var bob = As("bob");
        var carol = As("carol");
        var id = await SessionAsync(alice, viewer: bob);
        var annotation = await AddAsync(alice, id);
        await EditAsync(alice, annotation.Id, "v2");
        var timeline = await TimelineAsync(bob, id, annotation.Id);
        var added = timeline.Versions[1].Id;

        (await bob.GetAsync($"/annotations/{annotation.Id}/history/{added}")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await GoBackAsync(bob, annotation.Id, added)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await carol.GetAsync($"/annotations/{annotation.Id}/history?collectionId={id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await carol.GetAsync($"/annotations/{annotation.Id}/history/{added}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await GoBackAsync(carol, annotation.Id, added)).StatusCode);

        (await alice.PostAsync($"/collections/{id}/end", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await GoBackAsync(alice, annotation.Id, added)).StatusCode);
        Assert.Equal("v2", (await ReadAsync(alice, id, annotation.Id)).Label);
    }

    // An entry only counts for its own row - and its own kind of row.
    [Fact]
    public async Task AnEntryFromAnotherRow_IsNotFound()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var a = await AddAsync(alice, id, "a");
        var b = await AddAsync(alice, id, "b");
        var entryOfA = (await TimelineAsync(alice, id, a.Id)).Versions[0].Id;

        Assert.Equal(HttpStatusCode.NotFound, (await GoBackAsync(alice, b.Id, entryOfA)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await GoBackAsync(alice, a.Id, entryOfA, path: "cellcounts")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/annotations/{b.Id}/history/{entryOfA}")).StatusCode);
    }

    [Fact]
    public async Task GoingBack_CountsAsPutBack_InTheHistoryFilter()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var annotation = await AddAsync(alice, id);
        await EditAsync(alice, annotation.Id, "v2");
        var added = (await TimelineAsync(alice, id, annotation.Id)).Versions[1].Id;
        var response = await GoBackAsync(alice, annotation.Id, added);
        var changeSet = Guid.Parse(response.Headers.GetValues(ChangeSetEndpoints.Header).Single());

        var restores = (await alice.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}&kind=restore", Json))!;
        var changes = (await alice.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}&kind=change", Json))!;
        var facets = (await alice.GetFromJsonAsync<ChangeSetFacets>($"/changesets/facets?collectionId={id}", Json))!;

        Assert.Equal(changeSet, Assert.Single(restores).Id);
        Assert.DoesNotContain(changes, c => c.Id == changeSet);
        Assert.Equal(1, facets.Kinds.Single(k => k.Kind == ChangeKinds.Restore).Count);
    }

    [Fact]
    public async Task AChange_SaysWhichRowsItDeleted_SoOneCanBeOpened()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var annotation = await AddAsync(alice, id, "gone");
        var delete = await alice.DeleteAsync($"/annotations/{annotation.Id}");
        var changeSet = delete.Headers.GetValues(ChangeSetEndpoints.Header).Single();

        var changes = (await alice.GetFromJsonAsync<ChangeSetChanges>($"/changesets/{changeSet}/changes", Json))!;

        var row = Assert.Single(changes.DeletedRows);
        Assert.Equal((HistoryLog.Annotation, annotation.Id, "gone"), (row.Entity, row.Id, row.Name));
    }

    // Two people bringing the same row back: there's no row to lock, so the
    // primary key decides, and only one of them does it. The rest are told it's
    // changed, or if they looked just after it came back, that it's already so.
    [PostgresFact]
    public async Task BringingBackAtTheSameMoment_OnlyOneDoesIt()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var annotation = await AddAsync(alice, id);
        await alice.DeleteAsync($"/annotations/{annotation.Id}");
        var deleted = (await TimelineAsync(alice, id, annotation.Id)).Versions[0].Id;

        var responses = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => GoBackAsync(alice, annotation.Id, deleted, deleted)));

        Assert.All(responses, r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }));
        var answers = await Task.WhenAll(responses.Where(r => r.StatusCode == HttpStatusCode.OK)
            .Select(r => r.Content.ReadFromJsonAsync<RestoredView>(Json)));
        Assert.Equal(1, answers.Sum(a => a!.Annotations.Count));
        var timeline = await TimelineAsync(alice, id, annotation.Id);
        Assert.Equal("create", timeline.Versions[0].Op);
        Assert.Equal(3, timeline.Total);
    }

    // The check and the going back happen with the row locked, so only the
    // first of several from the same view gets through.
    [PostgresFact]
    public async Task GoingBackAtTheSameMoment_FromTheSameView_OnlyOneGetsThrough()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var annotation = await AddAsync(alice, id);
        await EditAsync(alice, annotation.Id, "v2");
        var timeline = await TimelineAsync(alice, id, annotation.Id);

        var responses = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => GoBackAsync(alice, annotation.Id, timeline.Versions[1].Id, timeline.Latest)));

        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Equal(3, (await TimelineAsync(alice, id, annotation.Id)).Total);
    }
}
