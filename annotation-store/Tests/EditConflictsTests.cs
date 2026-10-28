using System.Diagnostics.Metrics;
using System.Net;
using System.Net.Http.Json;
using AnnotationStore.Annotations;
using AnnotationStore.Collections;
using AnnotationStore.Conflicts;
using AnnotationStore.History;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AnnotationStore.Tests;

// Two people changing the same thing - last write wins or first come wins,
// picked per session. See Conflicts/EditConflicts.cs. Every test that makes
// a conflict is in here, so the counter they read isn't moved by other
// classes running at the same time.
public class EditConflictsTests : IClassFixture<CellCountApiFactory>, IDisposable
{
    private static readonly System.Text.Json.JsonSerializerOptions Json = TestJson.Options;

    private readonly CellCountApiFactory _factory;
    private readonly MeterListener _listener = new();
    private readonly Dictionary<(string Policy, string Entity, string Outcome), long> _counted = [];

    public EditConflictsTests(CellCountApiFactory factory)
    {
        _factory = factory;
        _listener.InstrumentPublished = (instrument, listener) =>
        {
            if (instrument.Meter.Name == EditConflicts.MeterName) listener.EnableMeasurementEvents(instrument);
        };
        _listener.SetMeasurementEventCallback<long>((_, value, tags, _) =>
        {
            var all = tags.ToArray();
            string Tag(string name) => (string)all.First(t => t.Key == name).Value!;
            lock (_counted)
            {
                var key = (Tag("policy"), Tag("entity"), Tag("outcome"));
                _counted[key] = _counted.GetValueOrDefault(key) + value;
            }
        });
        _listener.Start();
    }

    public void Dispose() => _listener.Dispose();

    private long Counted(EditPolicy policy, string entity) =>
        _counted.GetValueOrDefault((policy.ToString(), entity, policy == EditPolicy.FirstComeWins ? "refused" : "overwrote"));

    private HttpClient As(string userId) => TestAuthHandler.As(_factory.CreateClient(), userId, $"User {userId}");

    // A session alice hosts with bob editing in it.
    private async Task<CollectionView> SessionAsync(EditPolicy? policy)
    {
        var alice = As("alice");
        var start = await alice.PostAsJsonAsync("/sessions", new EnsureRequest(Guid.NewGuid().ToString(), EditPolicy: policy), Json);
        Assert.Equal(HttpStatusCode.Created, start.StatusCode);
        var session = (await start.Content.ReadFromJsonAsync<CollectionView>(Json))!;
        var invite = await alice.PostAsJsonAsync($"/collections/{session.CollectionId}/invites", new InviteRequest(CollectionRole.Editor, 24), Json);
        var code = (await invite.Content.ReadFromJsonAsync<InviteView>(Json))!.Code;
        (await As("bob").PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();
        return session;
    }

    private static async Task<Annotation> AddAsync(HttpClient client, Guid collectionId, string label = "a", string colour = "#FF0000")
    {
        var response = await client.PostAsJsonAsync("/annotations", new Annotation { CollectionId = collectionId, Label = label, Colour = colour });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<Annotation>(Json))!;
    }

    private static Task<HttpResponseMessage> SaveAsync(HttpClient client, Guid id, string colour, string? wasColour, string label = "a") =>
        client.PutAsJsonAsync($"/annotations/{id}", new AnnotationUpdate { Label = label, Colour = colour, WasColour = wasColour }, Json);

    private static async Task<Annotation> GetAsync(HttpClient client, Guid collectionId, Guid id) =>
        (await client.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={collectionId}", Json))!.Single(a => a.Id == id);

    private async Task<int> EntriesAsync(HttpResponseMessage response)
    {
        var changeSet = Guid.Parse(response.Headers.GetValues(ChangeSetEndpoints.Header).Single());
        using var scope = _factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<AnnotationDbContext>().HistoryEntries.CountAsync(e => e.ChangeSetId == changeSet);
    }

    private async Task<(bool Exists, int Entries)> ChangeSetAsync(Guid changeSet)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
        return (await db.ChangeSets.AnyAsync(c => c.Id == changeSet), await db.HistoryEntries.CountAsync(e => e.ChangeSetId == changeSet));
    }

    [Fact]
    public async Task ARefusedSaveInAnEditThatAlreadySaved_KeepsTheEditsChangeSet()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var annotation = await AddAsync(alice, session.CollectionId);
        var edit = Guid.NewGuid();
        var labelled = new HttpRequestMessage(HttpMethod.Put, $"/annotations/{annotation.Id}")
        {
            Content = JsonContent.Create(new AnnotationUpdate { Label = "first", Colour = "#FF0000", WasColour = "#FF0000" }, options: Json),
        };
        labelled.Headers.Add(ChangeSetEndpoints.Header, edit.ToString());
        (await alice.SendAsync(labelled)).EnsureSuccessStatusCode();
        (await SaveAsync(bob, annotation.Id, "#0000FF", wasColour: "#FF0000")).EnsureSuccessStatusCode();

        var recolour = new HttpRequestMessage(HttpMethod.Put, $"/annotations/{annotation.Id}")
        {
            Content = JsonContent.Create(new AnnotationUpdate { Label = "first", Colour = "#00FF00", WasColour = "#FF0000" }, options: Json),
        };
        recolour.Headers.Add(ChangeSetEndpoints.Header, edit.ToString());
        var refused = await alice.SendAsync(recolour);

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        Assert.Equal((true, 1), await ChangeSetAsync(edit));
    }

    [Fact]
    public async Task ABulkChangeTurnedDownForEveryRow_LeavesNoChangeSet_AndOneThatsPartlyThroughDoes()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var a = await AddAsync(alice, session.CollectionId, "a");
        var b = await AddAsync(alice, session.CollectionId, "b");
        (await SaveAsync(bob, a.Id, "#0000FF", wasColour: "#FF0000")).EnsureSuccessStatusCode();
        var allRefused = Guid.NewGuid();
        var partly = Guid.NewGuid();

        HttpRequestMessage Bulk(Guid changeSet, List<Guid> ids) =>
            new(HttpMethod.Put, "/annotations/bulk")
            {
                Content = JsonContent.Create(new BulkUpdateRequest(session.CollectionId, ids, Colour: "#00FF00",
                    WasColours: ids.ToDictionary(id => id, _ => "#FF0000")), options: Json),
                Headers = { { ChangeSetEndpoints.Header, changeSet.ToString() } },
            };
        var refused = (await (await alice.SendAsync(Bulk(allRefused, [a.Id]))).Content.ReadFromJsonAsync<BulkResult>(Json))!;
        var through = (await (await alice.SendAsync(Bulk(partly, [a.Id, b.Id]))).Content.ReadFromJsonAsync<BulkResult>(Json))!;

        Assert.Equal((0, 1), (refused.Count, refused.Conflicts!.Count));
        Assert.Equal((false, 0), await ChangeSetAsync(allRefused));
        Assert.Equal((1, 1), (through.Count, through.Conflicts!.Count));
        Assert.Equal((true, 1), await ChangeSetAsync(partly));
    }

    [Fact]
    public async Task ASession_IsLastWriteWins_UnlessTheHostPicksFirstComeWins()
    {
        var alice = As("alice");
        var slide = Guid.NewGuid().ToString();

        var plain = await SessionAsync(null);
        var strict = await SessionAsync(EditPolicy.FirstComeWins);
        var personal = (await (await alice.PostAsJsonAsync("/collections/ensure", new EnsureRequest(slide), Json))
            .Content.ReadFromJsonAsync<CollectionView>(Json))!;

        Assert.Equal(EditPolicy.LastWriteWins, plain.EditPolicy);
        Assert.Equal(EditPolicy.FirstComeWins, strict.EditPolicy);
        Assert.Equal(EditPolicy.LastWriteWins, personal.EditPolicy);
        var listed = (await alice.GetFromJsonAsync<List<CollectionView>>($"/collections?slideId={strict.SlideId}", Json))!;
        Assert.Equal(EditPolicy.FirstComeWins, listed.Single(c => c.CollectionId == strict.CollectionId).EditPolicy);
        // It goes over the wire as a word, like roles do.
        var raw = await (await alice.GetAsync($"/collections?slideId={strict.SlideId}")).Content.ReadAsStringAsync();
        Assert.Contains("\"editPolicy\":\"firstComeWins\"", raw);

        var nonsense = await alice.PostAsync("/sessions",
            JsonContent.Create(new Dictionary<string, string> { ["slideId"] = Guid.NewGuid().ToString(), ["editPolicy"] = "whoeverShouts" }));
        Assert.Equal(HttpStatusCode.BadRequest, nonsense.StatusCode);
    }

    [Fact]
    public async Task FirstComeWins_TurnsDownAColourFromAnOldCopy_SayingWhoChangedItAndToWhat()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var annotation = await AddAsync(alice, session.CollectionId);
        var before = Counted(EditPolicy.FirstComeWins, HistoryLog.Annotation);

        (await SaveAsync(bob, annotation.Id, "#0000FF", wasColour: "#FF0000")).EnsureSuccessStatusCode();
        var refused = await SaveAsync(alice, annotation.Id, "#00FF00", wasColour: "#FF0000");

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        var conflict = (await refused.Content.ReadFromJsonAsync<ConflictView>(Json))!;
        Assert.Equal((HistoryLog.Annotation, annotation.Id, "User bob"), (conflict.Entity, conflict.Id, conflict.ChangedBy));
        Assert.Equal(["Colour"], conflict.Changed);
        Assert.NotNull(conflict.ChangedAt);
        Assert.Equal("#0000FF", ((System.Text.Json.JsonElement)conflict.Current).GetProperty("colour").GetString());
        Assert.Equal("#0000FF", (await GetAsync(alice, session.CollectionId, annotation.Id)).Colour);
        // Turned down before it joins a change set, so there isn't one.
        Assert.False(refused.Headers.Contains(ChangeSetEndpoints.Header));
        Assert.Equal(before + 1, Counted(EditPolicy.FirstComeWins, HistoryLog.Annotation));

        // "Use mine" - sent again from what it is now.
        var mine = await SaveAsync(alice, annotation.Id, "#00FF00", wasColour: "#0000FF");
        Assert.Equal(HttpStatusCode.OK, mine.StatusCode);
        Assert.Equal("#00FF00", (await GetAsync(alice, session.CollectionId, annotation.Id)).Colour);
    }

    [Fact]
    public async Task LastWriteWins_LetsTheOldCopyThrough_AndCountsWhatItOverwrote()
    {
        var session = await SessionAsync(EditPolicy.LastWriteWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var annotation = await AddAsync(alice, session.CollectionId);
        var before = Counted(EditPolicy.LastWriteWins, HistoryLog.Annotation);

        (await SaveAsync(bob, annotation.Id, "#0000FF", wasColour: "#FF0000")).EnsureSuccessStatusCode();
        var overwrote = await SaveAsync(alice, annotation.Id, "#00FF00", wasColour: "#FF0000");

        Assert.Equal(HttpStatusCode.OK, overwrote.StatusCode);
        Assert.Equal(["1"], overwrote.Headers.GetValues(EditConflicts.OverwroteHeader));
        Assert.Equal("#00FF00", (await GetAsync(alice, session.CollectionId, annotation.Id)).Colour);
        Assert.Equal(before + 1, Counted(EditPolicy.LastWriteWins, HistoryLog.Annotation));
    }

    [Theory]
    [InlineData(EditPolicy.FirstComeWins)]
    [InlineData(EditPolicy.LastWriteWins)]
    public async Task ALabelEditFromAnOldCopy_NeverPutsBackTheOldColour_OrConflicts(EditPolicy policy)
    {
        var session = await SessionAsync(policy);
        var (alice, bob) = (As("alice"), As("bob"));
        var annotation = await AddAsync(alice, session.CollectionId);
        var before = Counted(policy, HistoryLog.Annotation);

        (await SaveAsync(bob, annotation.Id, "#0000FF", wasColour: "#FF0000")).EnsureSuccessStatusCode();
        // Alice's copy still says red - she's only changed the label.
        var saved = await SaveAsync(alice, annotation.Id, "#FF0000", wasColour: "#FF0000", label: "renamed");

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.False(saved.Headers.Contains(EditConflicts.OverwroteHeader));
        var now = await GetAsync(alice, session.CollectionId, annotation.Id);
        Assert.Equal(("renamed", "#0000FF"), (now.Label, now.Colour));
        Assert.Equal(before, Counted(policy, HistoryLog.Annotation));
    }

    [Fact]
    public async Task BothPickingTheSameColour_IsntAConflict()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var annotation = await AddAsync(alice, session.CollectionId);

        (await SaveAsync(bob, annotation.Id, "#0000FF", wasColour: "#FF0000")).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.OK, (await SaveAsync(alice, annotation.Id, "#0000FF", wasColour: "#FF0000")).StatusCode);
    }

    [Fact]
    public async Task ASaveWithoutAWas_IsntChecked_SoScriptsWorkAsBefore()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var annotation = await AddAsync(alice, session.CollectionId);
        var before = Counted(EditPolicy.FirstComeWins, HistoryLog.Annotation);

        (await SaveAsync(bob, annotation.Id, "#0000FF", wasColour: "#FF0000")).EnsureSuccessStatusCode();
        var unchecked_ = await alice.PutAsJsonAsync($"/annotations/{annotation.Id}", new Annotation { Label = "a", Colour = "#00FF00" }, Json);

        Assert.Equal(HttpStatusCode.OK, unchecked_.StatusCode);
        Assert.Equal("#00FF00", (await GetAsync(alice, session.CollectionId, annotation.Id)).Colour);
        Assert.Equal(before, Counted(EditPolicy.FirstComeWins, HistoryLog.Annotation));
    }

    [Fact]
    public async Task APersonalCollection_IsAlwaysLastWriteWins()
    {
        var alice = As("alice");
        var personal = (await (await alice.PostAsJsonAsync("/collections/ensure", new EnsureRequest(Guid.NewGuid().ToString()), Json))
            .Content.ReadFromJsonAsync<CollectionView>(Json))!;
        var annotation = await AddAsync(alice, personal.CollectionId);
        (await SaveAsync(alice, annotation.Id, "#0000FF", wasColour: "#FF0000")).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.OK, (await SaveAsync(alice, annotation.Id, "#00FF00", wasColour: "#FF0000")).StatusCode);
    }

    [Fact]
    public async Task ABulkRecolour_LeavesAloneWhatSomeoneElseRecolouredSince_AndChangesTheRest()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var a = await AddAsync(alice, session.CollectionId, "a");
        var b = await AddAsync(alice, session.CollectionId, "b");
        var c = await AddAsync(alice, session.CollectionId, "c");
        (await SaveAsync(bob, b.Id, "#0000FF", wasColour: "#FF0000", label: "b")).EnsureSuccessStatusCode();
        var before = Counted(EditPolicy.FirstComeWins, HistoryLog.Annotation);

        var response = await alice.PutAsJsonAsync("/annotations/bulk", new BulkUpdateRequest(session.CollectionId, [a.Id, b.Id, c.Id],
            Colour: "#00FF00", WasColours: new() { [a.Id] = "#FF0000", [b.Id] = "#FF0000", [c.Id] = "#FF0000" }), Json);

        var result = (await response.Content.ReadFromJsonAsync<BulkResult>(Json))!;
        Assert.Equal(2, result.Count);
        var conflict = Assert.Single(result.Conflicts!);
        Assert.Equal((b.Id, "#0000FF", "User bob"), (conflict.Id, conflict.Colour, conflict.ChangedBy));
        var now = (await alice.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={session.CollectionId}", Json))!.ToDictionary(x => x.Id, x => x.Colour);
        Assert.Equal(("#00FF00", "#0000FF", "#00FF00"), (now[a.Id], now[b.Id], now[c.Id]));
        Assert.Equal(before + 1, Counted(EditPolicy.FirstComeWins, HistoryLog.Annotation));
    }

    [Fact]
    public async Task ABulkRegroup_UnderLastWriteWins_ChangesEverything_AndCountsWhatItOverwrote()
    {
        var session = await SessionAsync(EditPolicy.LastWriteWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var a = await AddAsync(alice, session.CollectionId, "a");
        var b = await AddAsync(alice, session.CollectionId, "b");
        var bobs = await (await bob.PostAsJsonAsync("/annotationgroups", new NewGroupRequest(session.CollectionId, "bob's", [b.Id]), Json))
            .Content.ReadFromJsonAsync<GroupView>(Json);
        var alices = await (await alice.PostAsJsonAsync("/annotationgroups", new NewGroupRequest(session.CollectionId, "alice's"), Json))
            .Content.ReadFromJsonAsync<GroupView>(Json);
        var before = Counted(EditPolicy.LastWriteWins, HistoryLog.Annotation);

        var response = await alice.PutAsJsonAsync("/annotations/bulk", new BulkUpdateRequest(session.CollectionId, [a.Id, b.Id],
            SetGroup: true, GroupId: alices!.Id, WasGroups: new() { [a.Id] = null, [b.Id] = null }), Json);

        var result = (await response.Content.ReadFromJsonAsync<BulkResult>(Json))!;
        Assert.Equal((2, 1), (result.Count, result.Overwrote));
        Assert.Null(result.Conflicts);
        Assert.All((await alice.GetFromJsonAsync<List<Annotation>>($"/annotations?collectionId={session.CollectionId}", Json))!,
            x => Assert.Equal(alices.Id, x.GroupId));
        Assert.Equal(before + 1, Counted(EditPolicy.LastWriteWins, HistoryLog.Annotation));
        Assert.NotNull(bobs);
    }

    [Fact]
    public async Task ARenameFromAnOldCopy_IsTurnedDown_ButNotesLeftAsTheyWereDontStopIt()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var group = (await (await alice.PostAsJsonAsync("/annotationgroups", new NewGroupRequest(session.CollectionId, "Tumour"), Json))
            .Content.ReadFromJsonAsync<GroupView>(Json))!;
        (await bob.PutAsJsonAsync($"/annotationgroups/{group.Id}", new GroupUpdateRequest(Name: "Tumour A", WasName: "Tumour"), Json))
            .EnsureSuccessStatusCode();

        var refused = await alice.PutAsJsonAsync($"/annotationgroups/{group.Id}", new GroupUpdateRequest(Name: "Tumour B", WasName: "Tumour"), Json);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        var conflict = (await refused.Content.ReadFromJsonAsync<ConflictView>(Json))!;
        Assert.Equal((HistoryLog.Group, "User bob"), (conflict.Entity, conflict.ChangedBy));
        Assert.Equal(["Name"], conflict.Changed);

        // Her notes, with her old copy of the name sent back unchanged.
        var notes = await alice.PutAsJsonAsync($"/annotationgroups/{group.Id}",
            new GroupUpdateRequest(Name: "Tumour", Notes: "check margins", WasName: "Tumour", WasNotes: ""), Json);
        Assert.Equal(HttpStatusCode.OK, notes.StatusCode);
        var now = (await notes.Content.ReadFromJsonAsync<GroupView>(Json))!;
        Assert.Equal(("Tumour A", "check margins"), (now.Name, now.Notes));
    }

    // The viewer sends every batch of a big recolour at once, all making the
    // same change set inside their own transactions. The ones that lose that
    // race carry on because EF saves inside a savepoint - with savepoints
    // off, this fails with "current transaction is aborted".
    [PostgresFact]
    public async Task CheckedBatchesAtTheSameMoment_AllGoThrough_InOneChangeSet()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var alice = As("alice");
        var ids = new List<Guid>();
        for (var i = 0; i < 40; i++) ids.Add((await AddAsync(alice, session.CollectionId, $"a{i}")).Id);
        var changeSet = Guid.NewGuid();

        var responses = await Task.WhenAll(ids.Chunk(1).Select(batch => alice.SendAsync(new HttpRequestMessage(HttpMethod.Put, "/annotations/bulk")
        {
            Content = JsonContent.Create(new BulkUpdateRequest(session.CollectionId, [.. batch], Colour: "#00FF00",
                WasColours: batch.ToDictionary(id => id, _ => "#FF0000")), options: Json),
            Headers = { { ChangeSetEndpoints.Header, changeSet.ToString() } },
        })));

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Equal((true, 40), await ChangeSetAsync(changeSet));
    }

    // Two people's saves from the same copy landing together - the row lock
    // means exactly one gets through.
    [PostgresFact]
    public async Task SavesFromTheSameCopyAtTheSameMoment_OnlyOneGetsThrough()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var alice = As("alice");
        var annotation = await AddAsync(alice, session.CollectionId);
        var colours = Enumerable.Range(0, 10).Select(i => $"#0000{i:D2}").ToList();

        var responses = await Task.WhenAll(colours.Select(colour => SaveAsync(As(colour == colours[0] ? "alice" : "bob"), annotation.Id, colour, "#FF0000")));

        var won = Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.All(responses.Where(r => r != won), r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));
        Assert.Equal((await won.Content.ReadFromJsonAsync<Annotation>(Json))!.Colour, (await GetAsync(alice, session.CollectionId, annotation.Id)).Colour);
    }
}
