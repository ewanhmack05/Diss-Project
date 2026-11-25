using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using AnnotationStore.History;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AnnotationStore.Tests;

// The whole collection back to a point in time, and the snapshots that save
// undoing everything since. See History/CollectionRollback.cs and Snapshots.cs.
public class CollectionRollbackTests : IClassFixture<CellCountApiFactory>
{
    private static readonly JsonSerializerOptions Json = TestJson.Options;
    private const string Header = ChangeSetEndpoints.Header;

    private readonly CellCountApiFactory _factory;

    public CollectionRollbackTests(CellCountApiFactory factory)
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

    private static Guid ChangeSetOf(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        return Guid.Parse(response.Headers.GetValues(Header).Single());
    }

    private static async Task<(Annotation Row, Guid ChangeSet)> AddAsync(HttpClient client, Guid collectionId, string label, Guid? groupId = null)
    {
        var response = await client.PostAsJsonAsync("/annotations",
            new Annotation { CollectionId = collectionId, Label = label, Colour = "#FF0000", Shape = "Box", GeoJson = $"{{\"of\":\"{label}\"}}", GroupId = groupId });
        var changeSet = ChangeSetOf(response);
        return ((await response.Content.ReadFromJsonAsync<Annotation>(Json))!, changeSet);
    }

    private static async Task<Guid> EditAsync(HttpClient client, Guid id, string label, string notes = "", string colour = "#FF0000") =>
        ChangeSetOf(await client.PutAsJsonAsync($"/annotations/{id}", new Annotation { Label = label, Notes = notes, Colour = colour }));

    private static async Task<Guid> MoveAsync(HttpClient client, Guid id, int? from, int? to) =>
        ChangeSetOf(await client.PutAsJsonAsync($"/annotations/{id}/slices", new SliceRangeUpdate(from, to), Json));

    private static async Task<(int?, int?)> SlicesAsync(HttpClient client, Guid collectionId, Guid id)
    {
        var row = (await client.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={collectionId}", Json))!.Single(a => a.Id == id);
        return (row.SliceFrom, row.SliceTo);
    }

    private async Task<T> WithDbAsync<T>(Func<AnnotationDbContext, Task<T>> read)
    {
        using var scope = _factory.Services.CreateScope();
        return await read(scope.ServiceProvider.GetRequiredService<AnnotationDbContext>());
    }

    private Task<CollectionSnapshot?> SnapshotAsync(Guid collectionId) =>
        WithDbAsync(db => Snapshots.TakeAsync(db, collectionId));

    // Everything that can change in the collection, plus the shapes and dots
    // that can't, so a row that comes back wrong shows up. Sorted so two can be
    // compared.
    private async Task<string> DumpAsync(HttpClient client, Guid collectionId)
    {
        var annotations = (await client.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={collectionId}", Json))!
            .OrderBy(a => a.Id).Select(a => new { a.Id, a.Label, a.Notes, a.Colour, a.GroupId, a.SliceFrom, a.SliceTo, a.GeoJson, a.Shape });
        var groups = (await client.GetFromJsonAsync<List<GroupView>>($"/annotationgroups?collectionId={collectionId}", Json))!
            .OrderBy(g => g.Id).Select(g => new { g.Id, g.Name, g.Notes });
        var counts = await WithDbAsync(db => db.CellCounts.Include(c => c.RegionOfInterest).Where(c => c.CollectionId == collectionId).AsNoTracking()
            .OrderBy(c => c.Id).Select(c => new { c.Id, c.Label, c.Notes, c.Count, c.Dots, Region = c.RegionOfInterest == null ? null : c.RegionOfInterest.GeoJson }).ToListAsync());
        return JsonSerializer.Serialize(new { annotations, groups, counts });
    }

    // A bit of everything, returning how the collection was after each change.
    private async Task<(Guid CollectionId, List<(Guid ChangeSet, string State)> Points)> StoryAsync(HttpClient alice)
    {
        var id = await OwnAsync(alice);
        var points = new List<(Guid, string)>();
        async Task Mark(Guid changeSet) => points.Add((changeSet, await DumpAsync(alice, id)));

        var (a, addA) = await AddAsync(alice, id, "a");
        await Mark(addA);
        var (b, addB) = await AddAsync(alice, id, "b");
        await Mark(addB);
        var group = await alice.PostAsJsonAsync("/annotationgroups", new NewGroupRequest(id, "Tumour", [a.Id, b.Id]), Json);
        var groupView = (await group.Content.ReadFromJsonAsync<GroupView>(Json))!;
        await Mark(ChangeSetOf(group));
        await Mark(await EditAsync(alice, a.Id, "a2", "first look"));
        var count = await alice.PostAsJsonAsync("/cellcounts", new CellCount
        {
            CollectionId = id,
            Label = "c",
            Dots = "[{\"x\":1,\"y\":2,\"colour\":\"#ff0000\"}]",
            Count = 1,
            WithRoi = true,
            RegionOfInterest = new RegionOfInterest { GeoJson = "{\"roi\":1}" },
        });
        var countRow = (await count.Content.ReadFromJsonAsync<CellCount>(Json))!;
        await Mark(ChangeSetOf(count));
        await Mark(ChangeSetOf(await alice.PutAsJsonAsync($"/cellcounts/{countRow.Id}", new CellCount { Label = "c2", Notes = "n", WithRoi = true, Count = 1 })));
        await Mark(ChangeSetOf(await alice.PutAsJsonAsync("/annotations/bulk", new BulkUpdateRequest(id, [a.Id, b.Id], "#0000FF"), Json)));
        await Mark(ChangeSetOf(await alice.DeleteAsync($"/annotations/{b.Id}")));
        await Mark(ChangeSetOf(await alice.PutAsJsonAsync($"/annotationgroups/{groupView.Id}", new GroupUpdateRequest("Renamed", "group notes"), Json)));
        var deleteCount = ChangeSetOf(await alice.DeleteAsync($"/cellcounts/{countRow.Id}"));
        await Mark(deleteCount);
        var putBack = await alice.PostAsync($"/changesets/{deleteCount}/restore", null);
        await Mark(ChangeSetOf(putBack));
        var (c, addC) = await AddAsync(alice, id, "c");
        await Mark(addC);
        await Mark(await MoveAsync(alice, a.Id, 3, 8));
        await Mark(await MoveAsync(alice, c.Id, 5, 5));
        await Mark(await MoveAsync(alice, a.Id, 0, 8));
        await Mark(await MoveAsync(alice, a.Id, 0, 1));
        await Mark(ChangeSetOf(await alice.DeleteAsync($"/annotationgroups/{groupView.Id}")));
        await Mark(ChangeSetOf(await alice.DeleteAsync($"/annotations/{c.Id}")));
        await Mark(await MoveAsync(alice, a.Id, null, null));
        await Mark(await EditAsync(alice, a.Id, "a3", "second look", "#00FF00"));
        return (id, points);
    }

    private static Task<HttpResponseMessage> RollBackAsync(HttpClient client, Guid changeSet, long? latest = null) =>
        client.PostAsync($"/changesets/{changeSet}/rollback{(latest is { } seen ? $"?latest={seen}" : "")}", null);

    private static async Task<RollbackView> PreviewAsync(HttpClient client, Guid changeSet) =>
        (await client.GetFromJsonAsync<RollbackView>($"/changesets/{changeSet}/rollback", Json))!;

    private Task<long> PointOfAsync(Guid changeSet) =>
        WithDbAsync(db => db.HistoryEntries.Where(e => e.ChangeSetId == changeSet).MaxAsync(e => e.Id));

    // The one that matters: every point goes back to exactly what was recorded
    // there at the time, shapes and dots included, whichever way it's worked out.
    [Fact]
    public async Task EveryPoint_GoesBackToExactlyHowItWas_ThroughEverythingSince()
    {
        var alice = As("alice");
        var (id, points) = await StoryAsync(alice);
        var end = await DumpAsync(alice, id);

        foreach (var (changeSet, state) in points)
        {
            (await RollBackAsync(alice, changeSet)).EnsureSuccessStatusCode();
            Assert.Equal(state, await DumpAsync(alice, id));

            // Each rollback's a change, so the last point goes back to how it all ended.
            (await RollBackAsync(alice, points[^1].ChangeSet)).EnsureSuccessStatusCode();
            Assert.Equal(end, await DumpAsync(alice, id));
        }
    }

    // Snapshots are only a shortcut, so they can't change the answer.
    [Fact]
    public async Task FromASnapshot_LandsOnTheSameAsFromWhatsThereNow()
    {
        var alice = As("alice");
        var (id, points) = await StoryAsync(alice);
        Assert.NotNull(await SnapshotAsync(id));
        await EditAsync(alice, (await alice.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={id}", Json))![0].Id, "after the snapshot");

        foreach (var (changeSet, _) in points)
        {
            var point = await PointOfAsync(changeSet);
            var (walked, fromSnapshot) = await WithDbAsync(async db =>
                (await CollectionRollback.PlanAsync(db, id, point, useSnapshots: false), await CollectionRollback.PlanAsync(db, id, point)));

            Assert.True(fromSnapshot.FromSnapshot);
            Assert.False(walked.FromSnapshot);
            Assert.Equal(Normal(walked), Normal(fromSnapshot));
            Assert.True(fromSnapshot.EntriesWalked < walked.EntriesWalked);
        }
    }

    private static string Normal(CollectionRollback.Plan plan)
    {
        static object Rows(Dictionary<(string Entity, Guid Id), Dictionary<string, JsonElement>> rows) => rows
            .OrderBy(r => r.Key.Id).Select(r => new { r.Key.Entity, r.Key.Id, Columns = r.Value.OrderBy(c => c.Key).Select(c => new { c.Key, Value = c.Value.ToString() }) });
        return JsonSerializer.Serialize(new { Add = Rows(plan.Add), Change = Rows(plan.Change), Remove = plan.Remove.OrderBy(r => r.Id).Select(r => r.Id) });
    }

    [Fact]
    public async Task ARollback_RollsBackFromASnapshotTooAndCanBeGoneBackOn()
    {
        var alice = As("alice");
        var (id, points) = await StoryAsync(alice);
        await SnapshotAsync(id);
        var end = await DumpAsync(alice, id);

        var view = (await (await RollBackAsync(alice, points[2].ChangeSet)).Content.ReadFromJsonAsync<RollbackView>(Json))!;

        Assert.True(view.FromSnapshot);
        Assert.Equal(points[2].State, await DumpAsync(alice, id));
        var live = (await alice.GetFromJsonAsync<RollbackView>($"/changesets/{points[0].ChangeSet}/rollback?snapshots=false", Json))!;
        Assert.False(live.FromSnapshot);
        (await RollBackAsync(alice, points[^1].ChangeSet)).EnsureSuccessStatusCode();
        Assert.Equal(end, await DumpAsync(alice, id));
    }

    [Fact]
    public async Task Preview_SaysWhatItWouldDo_AndChangesNothing()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (a, _) = await AddAsync(alice, id, "a");
        var (b, _) = await AddAsync(alice, id, "b");
        var point = await EditAsync(alice, a.Id, "a2");
        await EditAsync(alice, a.Id, "a3");
        await alice.DeleteAsync($"/annotations/{b.Id}");
        await AddAsync(alice, id, "c");
        var before = await DumpAsync(alice, id);
        var changeSets = await WithDbAsync(db => db.ChangeSets.CountAsync(c => c.CollectionId == id));

        var view = await PreviewAsync(alice, point);

        Assert.Equal(new RollbackCounts(1, 1, 1), view.Annotations);
        Assert.Equal(new RollbackCounts(0, 0, 0), view.Groups);
        Assert.Equal(3, view.EntriesWalked);
        Assert.False(view.FromSnapshot);
        Assert.Equal(before, await DumpAsync(alice, id));
        Assert.Equal(changeSets, await WithDbAsync(db => db.ChangeSets.CountAsync(c => c.CollectionId == id)));
    }

    [Fact]
    public async Task ALaterChangeNotSeen_TurnsItDown_AndChangesNothing()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (a, add) = await AddAsync(alice, id, "a");
        await EditAsync(alice, a.Id, "a2");
        var seen = (await PreviewAsync(alice, add)).Latest;
        await EditAsync(alice, a.Id, "someone else's");
        var state = await DumpAsync(alice, id);
        var changeSets = await WithDbAsync(db => db.ChangeSets.CountAsync(c => c.CollectionId == id));

        Assert.Equal(HttpStatusCode.Conflict, (await RollBackAsync(alice, add, seen)).StatusCode);

        Assert.Equal(state, await DumpAsync(alice, id));
        Assert.Equal(changeSets, await WithDbAsync(db => db.ChangeSets.CountAsync(c => c.CollectionId == id)));
        (await RollBackAsync(alice, add, (await PreviewAsync(alice, add)).Latest)).EnsureSuccessStatusCode();
        Assert.Equal("a", (await alice.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={id}", Json))![0].Label);
    }

    [Fact]
    public async Task GoingBackToBeforeADelete_BringsBackTheSliceRange()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var response = await alice.PostAsJsonAsync("/annotations",
            new Annotation { CollectionId = id, Label = "marker", Colour = "#FF0000", Shape = "Box", SliceFrom = 2, SliceTo = 5 });
        var add = ChangeSetOf(response);
        var marker = (await response.Content.ReadFromJsonAsync<Annotation>(Json))!;
        ChangeSetOf(await alice.DeleteAsync($"/annotations/{marker.Id}"));

        (await RollBackAsync(alice, add)).EnsureSuccessStatusCode();

        var back = Assert.Single((await alice.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={id}", Json))!);
        Assert.Equal((marker.Id, 2, 5), (back.Id, back.SliceFrom, back.SliceTo));
    }

    [Fact]
    public async Task GoingBackToBeforeASliceMove_PutsItBackOnItsSlices_AndCountsIt()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (marker, add) = await AddAsync(alice, id, "marker");
        var placed = await MoveAsync(alice, marker.Id, 3, 8);
        var moved = await MoveAsync(alice, marker.Id, 2, 11);

        Assert.Equal(new RollbackCounts(0, 1, 0), (await PreviewAsync(alice, placed)).Annotations);
        (await RollBackAsync(alice, placed)).EnsureSuccessStatusCode();
        Assert.Equal((3, 8), await SlicesAsync(alice, id, marker.Id));

        (await RollBackAsync(alice, add)).EnsureSuccessStatusCode();
        Assert.Equal((null, null), await SlicesAsync(alice, id, marker.Id));
        (await RollBackAsync(alice, moved)).EnsureSuccessStatusCode();
        Assert.Equal((2, 11), await SlicesAsync(alice, id, marker.Id));
    }

    // Its delete's copy has where it was moved to, so that's taken off again.
    [Fact]
    public async Task GoingBackToBeforeASliceMoveAndADelete_BringsItBackOnTheSlicesItHadThen()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (marker, _) = await AddAsync(alice, id, "marker");
        var placed = await MoveAsync(alice, marker.Id, 3, 8);
        await MoveAsync(alice, marker.Id, 2, 11);
        await alice.DeleteAsync($"/annotations/{marker.Id}");

        (await RollBackAsync(alice, placed)).EnsureSuccessStatusCode();

        Assert.Equal((3, 8), await SlicesAsync(alice, id, marker.Id));
    }

    // A delete from before the columns were there was of something on every
    // slice, whatever's happened to it since.
    [Fact]
    public async Task GoingBackPastADeleteFromBeforeSlices_IsEverySlice()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (a, add) = await AddAsync(alice, id, "a");
        var delete = ChangeSetOf(await alice.DeleteAsync($"/annotations/{a.Id}"));
        await WithDbAsync(async db =>
        {
            var entry = await db.HistoryEntries.SingleAsync(e => e.ChangeSetId == delete);
            var before = System.Text.Json.Nodes.JsonNode.Parse(entry.Before!)!.AsObject();
            before.Remove(nameof(Annotation.SliceFrom));
            before.Remove(nameof(Annotation.SliceTo));
            entry.Before = before.ToJsonString();
            return await db.SaveChangesAsync();
        });
        (await alice.PostAsync($"/changesets/{delete}/restore", null)).EnsureSuccessStatusCode();
        await MoveAsync(alice, a.Id, 4, 6);

        (await RollBackAsync(alice, add)).EnsureSuccessStatusCode();

        Assert.Equal((null, null), await SlicesAsync(alice, id, a.Id));
    }

    // A snapshot from before slices were in them can't say which slices
    // anything was on, so it's passed over - for a newer one that can, or for
    // what's there now.
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ASnapshotFromBeforeSlices_IsPassedOver(bool newerOneToo)
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (marker, _) = await AddAsync(alice, id, "marker");
        var placed = await MoveAsync(alice, marker.Id, 3, 8);
        var old = (await SnapshotAsync(id))!;
        await ForgetSlicesAsync(old.Id);
        await MoveAsync(alice, marker.Id, 2, 11);
        if (newerOneToo) await SnapshotAsync(id);
        await EditAsync(alice, marker.Id, "after");

        var preview = await PreviewAsync(alice, placed);
        (await RollBackAsync(alice, placed)).EnsureSuccessStatusCode();

        Assert.Equal(newerOneToo, preview.FromSnapshot);
        Assert.Equal((3, 8), await SlicesAsync(alice, id, marker.Id));
    }

    // With nothing in it to be on a slice, a snapshot's still good.
    [Fact]
    public async Task ASnapshotWithNoAnnotations_IsUsed()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var made = ChangeSetOf(await alice.PostAsJsonAsync("/annotationgroups", new NewGroupRequest(id, "Tumour", null), Json));
        await SnapshotAsync(id);
        await AddAsync(alice, id, "a");

        var preview = await PreviewAsync(alice, made);

        Assert.True(preview.FromSnapshot);
        Assert.Equal(new RollbackCounts(0, 0, 1), preview.Annotations);
    }

    private Task<int> ForgetSlicesAsync(long snapshotId) => WithDbAsync(async db =>
    {
        var snapshot = await db.Snapshots.SingleAsync(s => s.Id == snapshotId);
        var rows = System.Text.Json.Nodes.JsonNode.Parse(snapshot.Rows)!;
        foreach (var row in rows[HistoryLog.Annotation]!.AsObject())
        {
            row.Value!.AsObject().Remove(nameof(Annotation.SliceFrom));
            row.Value!.AsObject().Remove(nameof(Annotation.SliceTo));
        }
        snapshot.Rows = rows.ToJsonString();
        return await db.SaveChangesAsync();
    });

    // A snapshot missing a column that can change would put it back wrong
    // without saying so.
    [Fact]
    public async Task ASnapshot_HoldsExactlyWhatCanChange()
    {
        var alice = As("alice");
        var (id, points) = await StoryAsync(alice);
        (await RollBackAsync(alice, points[5].ChangeSet)).EnsureSuccessStatusCode();
        (await alice.PostAsJsonAsync("/cellcountgroups", new NewCountGroupRequest(id, "Mitoses"), Json)).EnsureSuccessStatusCode();

        var state = CollectionRollback.ParseState((await SnapshotAsync(id))!.Rows);

        Assert.Equal(ItemHistory.Changeable.Keys.Order(), state.Keys.Select(k => k.Entity).Distinct().Order());
        foreach (var ((entity, _), row) in state)
            Assert.Equal(ItemHistory.Changeable[entity].Order(), row.Keys.Order());
    }

    [Fact]
    public async Task GoingBackToHowItAlreadyIs_IsntAChange()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (_, add) = await AddAsync(alice, id, "a");
        var changeSets = await WithDbAsync(db => db.ChangeSets.CountAsync(c => c.CollectionId == id));

        (await RollBackAsync(alice, add)).EnsureSuccessStatusCode();

        Assert.Equal(changeSets, await WithDbAsync(db => db.ChangeSets.CountAsync(c => c.CollectionId == id)));
    }

    // Names, people and links are only a record. Going back past them leaves
    // them as they are, and one happening while you look isn't a 409.
    [Fact]
    public async Task GoingBack_LeavesTheNameThePeopleAndTheLinksAlone_AndIsntPutOffByThem()
    {
        var (alice, bob, carol) = (As("alice"), As("bob"), As("carol"));
        var start = await alice.PostAsJsonAsync("/sessions", new EnsureRequest(Guid.NewGuid().ToString(), "Before"), Json);
        var id = (await start.Content.ReadFromJsonAsync<CollectionView>(Json))!.CollectionId;
        var post = await alice.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "first", Colour = "#FF0000" }, Json);
        var point = Guid.Parse(post.Headers.GetValues(ChangeSetEndpoints.Header).Single());
        var invite = await alice.PostAsJsonAsync($"/collections/{id}/invites", new InviteRequest(CollectionRole.Editor, 24), Json);
        var code = (await invite.Content.ReadFromJsonAsync<InviteView>(Json))!.Code;
        (await bob.PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();
        (await bob.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "second", Colour = "#FF0000" }, Json)).EnsureSuccessStatusCode();
        var view = (await alice.GetFromJsonAsync<RollbackView>($"/changesets/{point}/rollback", Json))!;

        (await carol.PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();
        (await alice.DeleteAsync($"/collections/{id}/members/bob")).EnsureSuccessStatusCode();
        (await alice.PutAsJsonAsync($"/collections/{id}", new RenameRequest("After"), Json)).EnsureSuccessStatusCode();
        var back = await alice.PostAsync($"/changesets/{point}/rollback?latest={view.Latest}", null);

        back.EnsureSuccessStatusCode();
        Assert.Equal(["first"], (await alice.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={id}", Json))!.Select(a => a.Label));
        var now = (await alice.GetFromJsonAsync<CollectionView>($"/collections/{id}", Json))!;
        Assert.Equal("After", now.CollectionName);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/annotations?collectionId={id}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await carol.GetAsync($"/annotations?collectionId={id}")).StatusCode);

        // Someone joining is still a point to go back to.
        var joined = (await alice.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}&kind=people&createdBy=bob", Json))!.Single();
        Assert.Equal(HttpStatusCode.OK, (await alice.PostAsync($"/changesets/{joined.Id}/rollback", null)).StatusCode);
    }

    [Fact]
    public async Task ItsAChangeOfItsOwn_ThatCountsAsPutBack_WithOneEntryPerRow()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (a, add) = await AddAsync(alice, id, "a");
        await EditAsync(alice, a.Id, "a2");
        await AddAsync(alice, id, "b");

        var response = await RollBackAsync(alice, add);

        var changeSet = ChangeSetOf(response);
        var entries = await WithDbAsync(db => db.HistoryEntries.Where(e => e.ChangeSetId == changeSet).ToListAsync());
        Assert.Equal([HistoryOp.Update, HistoryOp.Delete], entries.Select(e => e.Op).Order());
        var restores = (await alice.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}&kind=restore", Json))!;
        Assert.Equal("restore collection", Assert.Single(restores).What);
    }

    [Fact]
    public async Task ImageAdjustments_StayAsTheyAre()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (_, add) = await AddAsync(alice, id, "a");
        var preset = await alice.PostAsJsonAsync("/imageadjustments", new ImageAdjustments.ImageAdjustments { CollectionId = id, AdjustmentName = "p", Adjustments = "{}" });
        preset.EnsureSuccessStatusCode();

        (await RollBackAsync(alice, add)).EnsureSuccessStatusCode();

        Assert.Equal(1, await WithDbAsync(db => db.ImageAdjustments.CountAsync(p => p.CollectionId == id)));
    }

    [Fact]
    public async Task AnyoneInItCanLook_OnlyEditorsCanGoBack()
    {
        var alice = As("alice");
        var bob = As("bob");
        var start = await alice.PostAsJsonAsync("/sessions", new EnsureRequest(Guid.NewGuid().ToString()));
        var id = (await start.Content.ReadFromJsonAsync<CollectionView>(Json))!.CollectionId;
        var invite = await alice.PostAsJsonAsync($"/collections/{id}/invites", new InviteRequest(CollectionRole.Viewer, 24), Json);
        (await bob.PostAsync($"/invites/{(await invite.Content.ReadFromJsonAsync<InviteView>(Json))!.Code}/accept", null)).EnsureSuccessStatusCode();
        var (_, add) = await AddAsync(alice, id, "a");
        await AddAsync(alice, id, "b");

        Assert.Equal(new RollbackCounts(0, 0, 1), (await PreviewAsync(bob, add)).Annotations);
        Assert.Equal(HttpStatusCode.Forbidden, (await RollBackAsync(bob, add)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await As("carol").GetAsync($"/changesets/{add}/rollback")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await RollBackAsync(As("carol"), add)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await RollBackAsync(alice, Guid.NewGuid())).StatusCode);

        (await alice.PostAsync($"/collections/{id}/end", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Conflict, (await RollBackAsync(alice, add)).StatusCode);
    }

    [Fact]
    public async Task ASnapshot_HoldsWhatCanChange_NotShapes()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (a, _) = await AddAsync(alice, id, "a");

        var snapshot = (await SnapshotAsync(id))!;

        Assert.Equal(await PointOfAsync(await WithDbAsync(db => db.HistoryEntries.Where(e => e.CollectionId == id).OrderBy(e => e.Id).Select(e => e.ChangeSetId).LastAsync())), snapshot.UpToEntry);
        var state = CollectionRollback.ParseState(snapshot.Rows);
        Assert.Equal("a", state[(HistoryLog.Annotation, a.Id)]["Label"].GetString());
        Assert.DoesNotContain("GeoJson", snapshot.Rows);
    }

    [Fact]
    public async Task NoSnapshot_WithNothingInIt()
    {
        var id = await OwnAsync(As("alice"));

        Assert.Null(await SnapshotAsync(id));
    }

    [Fact]
    public async Task DueCollections_AreOnesWithEnoughEntriesSinceTheirLastSnapshot()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var other = await OwnAsync(alice);
        await AddAsync(alice, id, "a");
        await AddAsync(alice, id, "b");
        await AddAsync(alice, other, "c");

        Assert.Contains(id, await WithDbAsync(db => Snapshots.DueAsync(db, every: 2)));
        Assert.DoesNotContain(other, await WithDbAsync(db => Snapshots.DueAsync(db, every: 2)));

        await SnapshotAsync(id);
        Assert.DoesNotContain(id, await WithDbAsync(db => Snapshots.DueAsync(db, every: 2)));

        await AddAsync(alice, id, "d");
        await AddAsync(alice, id, "e");
        Assert.Contains(id, await WithDbAsync(db => Snapshots.DueAsync(db, every: 2)));
    }

    // Saves at the same moment as a snapshot: going back must still land on
    // exactly how it was, so no entry can be stamped as in it without being in it.
    [PostgresFact]
    public async Task SnapshotsDuringSaves_StillAgreeWithWhatsThereNow()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var rows = new List<Annotation>();
        for (var i = 0; i < 12; i++) rows.Add((await AddAsync(alice, id, $"r{i}")).Row);

        var saves = Task.WhenAll(Enumerable.Range(0, 60).Select(i => EditAsync(alice, rows[i % rows.Count].Id, $"edit {i}")));
        var taken = new List<Task<CollectionSnapshot?>>();
        for (var i = 0; i < 6; i++)
        {
            taken.Add(SnapshotAsync(id));
            await Task.Delay(15);
        }
        await saves;
        await Task.WhenAll(taken);

        foreach (var snapshot in taken.Select(t => t.Result!))
        {
            var (walked, shortcut) = await WithDbAsync(async db =>
                (await CollectionRollback.PlanAsync(db, id, snapshot.UpToEntry, useSnapshots: false),
                 await CollectionRollback.PlanAsync(db, id, snapshot.UpToEntry)));
            Assert.Equal(Normal(walked), Normal(shortcut));
        }
    }

    // Everything in one transaction: two at once from the same view, one wins.
    [PostgresFact]
    public async Task RollbacksAtTheSameMoment_FromTheSameView_OnlyOneGetsThrough()
    {
        var alice = As("alice");
        var id = await OwnAsync(alice);
        var (a, add) = await AddAsync(alice, id, "a");
        await EditAsync(alice, a.Id, "a2");
        var seen = (await PreviewAsync(alice, add)).Latest;

        var responses = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => RollBackAsync(alice, add, seen)));

        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.All(responses.Where(r => r.StatusCode != HttpStatusCode.OK), r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));
        Assert.Single(await WithDbAsync(db => db.ChangeSets.Where(c => c.CollectionId == id && c.What == "restore collection").ToListAsync()));
    }
}
