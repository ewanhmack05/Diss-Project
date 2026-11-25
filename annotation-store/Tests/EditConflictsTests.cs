using System.Diagnostics.Metrics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
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
            if (instrument.Meter.Name == EditConflicts.MeterName && instrument.Name == "annotation_store.conflicting_saves")
                listener.EnableMeasurementEvents(instrument);
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

    // --- Labels and notes, which are merged live ---

    private static Task<HttpResponseMessage> TypeAsync(
        HttpClient client, Guid id, string label, string? wasLabel, string notes = "", string? wasNotes = null, Guid? changeSet = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, $"/annotations/{id}")
        {
            Content = JsonContent.Create(new AnnotationUpdate
            {
                Label = label,
                WasLabel = wasLabel,
                Notes = notes,
                WasNotes = wasNotes,
                Colour = "#FF0000",
                WasColour = "#FF0000",
            }, options: Json),
        };
        if (changeSet is { } inside) request.Headers.Add(ChangeSetEndpoints.Header, inside.ToString());
        return client.SendAsync(request);
    }

    private static Task<HttpResponseMessage> TypeOnCountAsync(
        HttpClient client, Guid id, string label, string? wasLabel, string notes = "", string? wasNotes = null) =>
        client.PutAsJsonAsync($"/cellcounts/{id}", new CellCountUpdate { Label = label, WasLabel = wasLabel, Notes = notes, WasNotes = wasNotes, Count = 1 }, Json);

    // Whatever the policy - it isn't a question of whose to keep.
    [Theory]
    [InlineData(EditPolicy.LastWriteWins)]
    [InlineData(EditPolicy.FirstComeWins)]
    public async Task TextSavedFromTextThatsChangedSince_IsTurnedDown_SayingWhatItIsNow(EditPolicy policy)
    {
        var session = await SessionAsync(policy);
        var (alice, bob) = (As("alice"), As("bob"));
        var annotation = await AddAsync(alice, session.CollectionId, "");
        (await TypeAsync(alice, annotation.Id, "a", wasLabel: "")).EnsureSuccessStatusCode();
        var turnedDown = Guid.NewGuid();

        var stale = await TypeAsync(bob, annotation.Id, "x", wasLabel: "", changeSet: turnedDown);

        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        var conflict = (await stale.Content.ReadFromJsonAsync<ConflictView>(Json))!;
        Assert.True(conflict.Text);
        Assert.Equal((annotation.Id, "User alice"), (conflict.Id, conflict.ChangedBy));
        Assert.Equal(["Label"], conflict.Changed);
        var now = ((System.Text.Json.JsonElement)conflict.Current).Deserialize<TextNow>(Json)!;
        Assert.Equal(("a", ""), (now.Label, now.Notes));
        Assert.Equal((false, 0), await ChangeSetAsync(turnedDown));
        Assert.Equal("a", (await GetAsync(alice, session.CollectionId, annotation.Id)).Label);
        // Not one of the policy's conflicts, so not counted with them.
        Assert.Equal(0, Counted(policy, HistoryLog.Annotation));

        // Worked out again from there, it's through.
        (await TypeAsync(bob, annotation.Id, "ax", wasLabel: "a", changeSet: turnedDown)).EnsureSuccessStatusCode();
        Assert.Equal((true, 1), await ChangeSetAsync(turnedDown));
    }

    // Typing in the notes while someone else types in the label: each save
    // only sets its own box.
    [Fact]
    public async Task ABoxThatIsntBeingChanged_StaysAsItIs_HoweverOldTheCopy()
    {
        var session = await SessionAsync(null);
        var (alice, bob) = (As("alice"), As("bob"));
        var annotation = await AddAsync(alice, session.CollectionId, "old");
        (await TypeAsync(alice, annotation.Id, "new", wasLabel: "old")).EnsureSuccessStatusCode();

        var notes = await TypeAsync(bob, annotation.Id, "old", wasLabel: "old", notes: "seen", wasNotes: "");

        notes.EnsureSuccessStatusCode();
        var now = await GetAsync(alice, session.CollectionId, annotation.Id);
        Assert.Equal(("new", "seen"), (now.Label, now.Notes));
        Assert.Equal(1, await EntriesAsync(notes));
    }

    [Fact]
    public async Task TextWithNoWas_IsntChecked_AndOneThatsAlreadyThereIsFine()
    {
        var session = await SessionAsync(null);
        var (alice, bob) = (As("alice"), As("bob"));
        var annotation = await AddAsync(alice, session.CollectionId, "");
        (await TypeAsync(alice, annotation.Id, "same", wasLabel: "")).EnsureSuccessStatusCode();

        // A save whose answer was lost on the way, sent again.
        (await TypeAsync(alice, annotation.Id, "same", wasLabel: "")).EnsureSuccessStatusCode();
        // A script, or a viewer from before this.
        (await TypeAsync(bob, annotation.Id, "written over", wasLabel: null)).EnsureSuccessStatusCode();

        Assert.Equal("written over", (await GetAsync(alice, session.CollectionId, annotation.Id)).Label);
    }

    // The gap this closes: a form that was open all along saving its old text
    // over what's just been put back.
    [Fact]
    public async Task AFormOpenSinceBeforeAPutBack_CantSaveItsOldTextOverIt()
    {
        var session = await SessionAsync(null);
        var (alice, bob) = (As("alice"), As("bob"));
        var annotation = await AddAsync(alice, session.CollectionId, "Duct");
        var edit = Guid.NewGuid();
        (await TypeAsync(alice, annotation.Id, "Not a duct", wasLabel: "Duct", changeSet: edit)).EnsureSuccessStatusCode();
        (await alice.PostAsync($"/changesets/{edit}/restore", null)).EnsureSuccessStatusCode();

        var stale = await TypeAsync(bob, annotation.Id, "Not a duct at all", wasLabel: "Not a duct");

        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("Duct", (await GetAsync(alice, session.CollectionId, annotation.Id)).Label);
    }

    [Fact]
    public async Task ACountsText_IsCheckedTheSameWay_AndSaysNothingOfItsDots()
    {
        var session = await SessionAsync(null);
        var (alice, bob) = (As("alice"), As("bob"));
        var count = await AddCountAsync(alice, session.CollectionId, "c");
        (await TypeOnCountAsync(alice, count.Id, "mitoses", wasLabel: "c")).EnsureSuccessStatusCode();

        var stale = await TypeOnCountAsync(bob, count.Id, "cells", wasLabel: "c");

        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        var body = await stale.Content.ReadAsStringAsync();
        Assert.Contains("\"text\":true", body);
        Assert.DoesNotContain("dots", body);
        (await TypeOnCountAsync(bob, count.Id, "c", wasLabel: "c", notes: "seen", wasNotes: "")).EnsureSuccessStatusCode();
        var now = (await alice.GetFromJsonAsync<CellCount>($"/cellcounts/{count.Id}", Json))!;
        Assert.Equal(("mitoses", "seen", 1), (now.Label, now.Notes, now.Count));
    }

    private static long TextAt(HttpResponseMessage response) => long.Parse(Assert.Single(response.Headers.GetValues(EditConflicts.TextAtHeader)));

    // Answers and ops can get to a viewer in any order, so each says when.
    [Fact]
    public async Task EveryAnswerAboutTheText_SaysWhenThatWas()
    {
        var session = await SessionAsync(null);
        var (alice, bob) = (As("alice"), As("bob"));
        var annotation = await AddAsync(alice, session.CollectionId, "");
        var count = await AddCountAsync(alice, session.CollectionId, "c");
        var edit = Guid.NewGuid();

        var saved = await TypeAsync(alice, annotation.Id, "a", wasLabel: "", changeSet: edit);
        var stale = await TypeAsync(bob, annotation.Id, "x", wasLabel: "");
        var again = await TypeAsync(bob, annotation.Id, "ax", wasLabel: "a");
        var restored = await alice.PostAsync($"/changesets/{edit}/restore", null);

        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.True(TextAt(saved) < TextAt(stale) && TextAt(stale) < TextAt(again) && TextAt(again) < TextAt(restored));
        // Fits in a number in the viewer.
        Assert.True(TextAt(restored) < 1L << 53);
        Assert.True(TextAt(await TypeOnCountAsync(alice, count.Id, "d", wasLabel: "c")) < TextAt(await TypeOnCountAsync(bob, count.Id, "x", wasLabel: "c")));
    }

    [Fact]
    public async Task AViewerOnAnotherAddress_CanReadWhenThatWas()
    {
        var session = await SessionAsync(null);
        var annotation = await AddAsync(As("alice"), session.CollectionId, "");
        var request = new HttpRequestMessage(HttpMethod.Put, $"/annotations/{annotation.Id}")
        {
            Content = JsonContent.Create(new AnnotationUpdate { Label = "a", WasLabel = "", Colour = "#FF0000", WasColour = "#FF0000" }, options: Json),
        };
        request.Headers.Add("Origin", "http://localhost:5173");

        var response = await As("alice").SendAsync(request);

        Assert.Contains(EditConflicts.TextAtHeader, string.Join(",", response.Headers.GetValues("Access-Control-Expose-Headers")));
    }

    // Two pauses in the same instant: one gets in, and the other has to look
    // again - never both from the same text, which would lose the first.
    [PostgresFact]
    public async Task SavesOfTheSameTextAtTheSameMoment_LoseNobodysTyping()
    {
        var session = await SessionAsync(null);
        var (alice, bob) = (As("alice"), As("bob"));
        var annotation = await AddAsync(alice, session.CollectionId, "");
        var count = await AddCountAsync(alice, session.CollectionId, "");

        var saved = new List<(long At, int Length)>();
        async Task TypeUntilInAsync(HttpClient client, string mark, Func<string, string, Task<HttpResponseMessage>> save)
        {
            for (var (was, tries) = ("", 0); ; tries++)
            {
                Assert.True(tries < 50);
                var response = await save(was + mark, was);
                if (response.IsSuccessStatusCode)
                {
                    lock (saved) saved.Add((TextAt(response), was.Length + 1));
                    return;
                }
                var conflict = (await response.Content.ReadFromJsonAsync<ConflictView>(Json))!;
                was = ((System.Text.Json.JsonElement)conflict.Current).Deserialize<TextNow>(Json)!.Label;
            }
        }
        await Task.WhenAll(Enumerable.Range(0, 16).Select(i => TypeUntilInAsync(i % 2 == 0 ? alice : bob, $"{(char)('a' + i)}",
            (label, was) => TypeAsync(i % 2 == 0 ? alice : bob, annotation.Id, label, was))));
        await Task.WhenAll(Enumerable.Range(0, 16).Select(i => TypeUntilInAsync(i % 2 == 0 ? alice : bob, $"{(char)('a' + i)}",
            (label, was) => TypeOnCountAsync(i % 2 == 0 ? alice : bob, count.Id, label, was))));

        Assert.Equal("abcdefghijklmnop", string.Concat((await GetAsync(alice, session.CollectionId, annotation.Id)).Label.Order()));
        // The newest text is the one that says it is - each has a letter more.
        Assert.Equal(Enumerable.Range(1, 16), saved.Take(16).OrderBy(s => s.At).Select(s => s.Length));
        Assert.Equal(Enumerable.Range(1, 16), saved.Skip(16).OrderBy(s => s.At).Select(s => s.Length));
        Assert.Equal("abcdefghijklmnop", string.Concat((await alice.GetFromJsonAsync<CellCount>($"/cellcounts/{count.Id}", Json))!.Label.Order()));
    }

    private static async Task<CellCount> AddCountAsync(HttpClient client, Guid collectionId, string label)
    {
        var response = await client.PostAsJsonAsync("/cellcounts",
            new CellCount { CollectionId = collectionId, Label = label, Dots = "[{\"x\":1,\"y\":2}]", Count = 1 }, Json);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CellCount>(Json))!;
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

    private async Task<CountGroupView> CountGroupAsync(HttpClient client, Guid session, string name = "Mitoses")
    {
        var response = await client.PostAsJsonAsync("/cellcountgroups", new NewCountGroupRequest(session, name), Json);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CountGroupView>(Json))!;
    }

    // A 3D marker made deeper, or a 2D shape moved: PUT /annotations/{id}/slices.
    private static Task<HttpResponseMessage> SlicesAsync(HttpClient client, Guid id, int? from, int? to, SliceRange? was = null) =>
        client.PutAsJsonAsync($"/annotations/{id}/slices", new SliceRangeUpdate(from, to, was), Json);

    private static async Task<Annotation> MarkerAsync(HttpClient client, Guid collectionId, int? from, int? to)
    {
        var response = await client.PostAsJsonAsync("/annotations",
            new Annotation { CollectionId = collectionId, Label = "marker", Colour = "#FF0000", Shape = "rectangle", SliceFrom = from, SliceTo = to }, Json);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<Annotation>(Json))!;
    }

    [Fact]
    public async Task Slices_MovesIt_AndLeavesLabelAndColourAlone_WithOneHistoryEntry()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var alice = As("alice");
        var marker = await MarkerAsync(alice, session.CollectionId, 3, 8);

        var moved = await SlicesAsync(alice, marker.Id, 2, 11, new SliceRange(3, 8));

        moved.EnsureSuccessStatusCode();
        var now = await GetAsync(alice, session.CollectionId, marker.Id);
        Assert.Equal((2, 11, "marker", "#FF0000"), (now.SliceFrom, now.SliceTo, now.Label, now.Colour));
        Assert.Equal(1, await EntriesAsync(moved));
    }

    [Fact]
    public async Task Slices_CanPutAShapeOnEverySlice_AndBackOnOne()
    {
        var session = await SessionAsync(null);
        var alice = As("alice");
        var shape = await MarkerAsync(alice, session.CollectionId, 4, 4);

        (await SlicesAsync(alice, shape.Id, null, null)).EnsureSuccessStatusCode();
        Assert.Equal((null, null), ((await GetAsync(alice, session.CollectionId, shape.Id)).SliceFrom, (await GetAsync(alice, session.CollectionId, shape.Id)).SliceTo));
        (await SlicesAsync(alice, shape.Id, 6, 6)).EnsureSuccessStatusCode();
        Assert.Equal(6, (await GetAsync(alice, session.CollectionId, shape.Id)).SliceFrom);
    }

    [Theory]
    [InlineData(2, null, "sliceFrom and sliceTo go together - set both or neither")]
    [InlineData(-1, 3, "sliceFrom can't be below 0")]
    [InlineData(5, 2, "sliceFrom can't be after sliceTo")]
    public async Task Slices_RefusesARangeThatDoesntMakeSense(int? from, int? to, string message)
    {
        var session = await SessionAsync(null);
        var alice = As("alice");
        var marker = await MarkerAsync(alice, session.CollectionId, 3, 8);

        var refused = await SlicesAsync(alice, marker.Id, from, to);

        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        Assert.Equal(message, await refused.Content.ReadFromJsonAsync<string>(Json));
        Assert.Equal(3, (await GetAsync(alice, session.CollectionId, marker.Id)).SliceFrom);
    }

    [Fact]
    public async Task Slices_ToWhereItAlreadyIs_RecordsNothing()
    {
        var session = await SessionAsync(null);
        var alice = As("alice");
        var marker = await MarkerAsync(alice, session.CollectionId, 3, 8);

        var same = await SlicesAsync(alice, marker.Id, 3, 8);

        same.EnsureSuccessStatusCode();
        Assert.False(same.Headers.Contains(ChangeSetEndpoints.Header));
    }

    [Fact]
    public async Task FirstComeWins_TurnsDownSlicesFromAnOldCopy_SayingWhoAndWhichEnd_AndSavingFromTheirsWorks()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var marker = await MarkerAsync(alice, session.CollectionId, 3, 8);
        var before = Counted(EditPolicy.FirstComeWins, HistoryLog.Annotation);
        (await SlicesAsync(alice, marker.Id, 0, 8, new SliceRange(3, 8))).EnsureSuccessStatusCode();

        var refused = await SlicesAsync(bob, marker.Id, 3, 12, new SliceRange(3, 8));

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        var conflict = (await refused.Content.ReadFromJsonAsync<ConflictView>(Json))!;
        Assert.Equal("User alice", conflict.ChangedBy);
        // Only what Alice actually moved - her change left the last slice where it was.
        Assert.Equal(["SliceFrom"], conflict.Changed);
        Assert.Equal(before + 1, Counted(EditPolicy.FirstComeWins, HistoryLog.Annotation));
        Assert.Equal((0, 8), ((await GetAsync(bob, session.CollectionId, marker.Id)).SliceFrom, (await GetAsync(bob, session.CollectionId, marker.Id)).SliceTo));

        (await SlicesAsync(bob, marker.Id, 3, 12, new SliceRange(0, 8))).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task FirstComeWins_ARecolourSince_DoesntStopAMoveBetweenSlices()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var marker = await MarkerAsync(alice, session.CollectionId, 3, 8);
        (await SaveAsync(alice, marker.Id, "#00FF00", wasColour: "#FF0000", label: "marker")).EnsureSuccessStatusCode();

        (await SlicesAsync(bob, marker.Id, 1, 9, new SliceRange(3, 8))).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task LastWriteWins_LetsSlicesThrough_AndSaysItOverwrote()
    {
        var session = await SessionAsync(EditPolicy.LastWriteWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var marker = await MarkerAsync(alice, session.CollectionId, 3, 8);
        (await SlicesAsync(alice, marker.Id, 0, 8, new SliceRange(3, 8))).EnsureSuccessStatusCode();

        var through = await SlicesAsync(bob, marker.Id, 3, 12, new SliceRange(3, 8));

        through.EnsureSuccessStatusCode();
        Assert.True(through.Headers.Contains(EditConflicts.OverwroteHeader));
        Assert.Equal(12, (await GetAsync(bob, session.CollectionId, marker.Id)).SliceTo);
    }

    [Fact]
    public async Task Slices_FromSomeoneOutsideTheCollection_OrOnAMissingOne_IsNotFound()
    {
        var alice = As("alice");
        var session = await SessionAsync(null);
        var marker = await MarkerAsync(alice, session.CollectionId, 3, 8);

        Assert.Equal(HttpStatusCode.NotFound, (await SlicesAsync(As("mallory"), marker.Id, 0, 1)).StatusCode);
        Assert.Equal(3, (await GetAsync(alice, session.CollectionId, marker.Id)).SliceFrom);
        Assert.Equal(HttpStatusCode.NotFound, (await SlicesAsync(alice, Guid.NewGuid(), 0, 1)).StatusCode);
    }

    [Fact]
    public async Task FirstComeWins_TurnsDownACountGroupsNameFromAnOldCopy_SayingWho()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var group = await CountGroupAsync(alice, session.CollectionId);
        var before = Counted(EditPolicy.FirstComeWins, HistoryLog.CellCountGroup);
        (await alice.PutAsJsonAsync($"/cellcountgroups/{group.Id}", new CountGroupUpdateRequest("Alice's", WasName: "Mitoses"), Json)).EnsureSuccessStatusCode();

        var refused = await bob.PutAsJsonAsync($"/cellcountgroups/{group.Id}", new CountGroupUpdateRequest("Bob's", WasName: "Mitoses"), Json);

        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        var conflict = (await refused.Content.ReadFromJsonAsync<ConflictView>(Json))!;
        Assert.Equal((HistoryLog.CellCountGroup, "User alice"), (conflict.Entity, conflict.ChangedBy));
        Assert.Equal(before + 1, Counted(EditPolicy.FirstComeWins, HistoryLog.CellCountGroup));

        // Saying yes means saving again from what it is now.
        (await bob.PutAsJsonAsync($"/cellcountgroups/{group.Id}", new CountGroupUpdateRequest("Bob's", WasName: "Alice's"), Json)).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task LastWriteWins_LetsACountGroupsNameThrough_AndSaysItOverwrote()
    {
        var session = await SessionAsync(EditPolicy.LastWriteWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var group = await CountGroupAsync(alice, session.CollectionId);
        (await alice.PutAsJsonAsync($"/cellcountgroups/{group.Id}", new CountGroupUpdateRequest("Alice's", WasName: "Mitoses"), Json)).EnsureSuccessStatusCode();

        var through = await bob.PutAsJsonAsync($"/cellcountgroups/{group.Id}", new CountGroupUpdateRequest("Bob's", WasName: "Mitoses"), Json);

        through.EnsureSuccessStatusCode();
        Assert.True(through.Headers.Contains(EditConflicts.OverwroteHeader));
    }

    [Fact]
    public async Task FirstComeWins_ChangingNotes_LeavesAnotherPersonsNameAlone()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var group = await CountGroupAsync(alice, session.CollectionId);
        (await alice.PutAsJsonAsync($"/cellcountgroups/{group.Id}", new CountGroupUpdateRequest("Alice's", WasName: "Mitoses"), Json)).EnsureSuccessStatusCode();

        var saved = await bob.PutAsJsonAsync($"/cellcountgroups/{group.Id}", new CountGroupUpdateRequest(Notes: "Bob's notes", WasNotes: ""), Json);

        saved.EnsureSuccessStatusCode();
        var view = (await saved.Content.ReadFromJsonAsync<CountGroupView>(Json))!;
        Assert.Equal(("Alice's", "Bob's notes"), (view.Name, view.Notes));
    }

    [Fact]
    public async Task FirstComeWins_LeavesCountsSomeoneElseMoved_AndMovesTheRest()
    {
        var session = await SessionAsync(EditPolicy.FirstComeWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var id = session.CollectionId;
        var (first, second) = (await CountGroupAsync(alice, id, "First"), await CountGroupAsync(alice, id, "Second"));
        async Task<Guid> Count()
        {
            var response = await alice.PostAsJsonAsync("/cellcounts", new CellCount { CollectionId = id, Dots = "[]" }, Json);
            return (await response.Content.ReadFromJsonAsync<CellCount>(Json))!.Id;
        }
        var (taken, free) = (await Count(), await Count());
        (await alice.PutAsJsonAsync("/cellcounts/group", new CountGroupMoveRequest(id, [taken], first.Id, new() { [taken] = null }), Json)).EnsureSuccessStatusCode();

        var moved = await bob.PutAsJsonAsync("/cellcounts/group", new CountGroupMoveRequest(id, [taken, free], second.Id, new() { [taken] = null, [free] = null }), Json);

        var result = (await moved.Content.ReadFromJsonAsync<BulkResult>(Json))!;
        Assert.Equal(1, result.Count);
        var conflict = Assert.Single(result.Conflicts!);
        Assert.Equal((taken, first.Id, "User alice"), (conflict.Id, conflict.GroupId, conflict.ChangedBy));

        // All of it turned down leaves no change behind.
        var changes = (await bob.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}", Json))!.Count;
        var refused = await bob.PutAsJsonAsync("/cellcounts/group", new CountGroupMoveRequest(id, [taken], second.Id, new() { [taken] = null }), Json);
        Assert.Equal(0, (await refused.Content.ReadFromJsonAsync<BulkResult>(Json))!.Count);
        Assert.Equal(changes, (await bob.GetFromJsonAsync<List<ChangeSetView>>($"/changesets?collectionId={id}", Json))!.Count);
    }

    [Fact]
    public async Task LastWriteWins_MovesCountsAnyway_AndSaysHowManyItOverwrote()
    {
        var session = await SessionAsync(EditPolicy.LastWriteWins);
        var (alice, bob) = (As("alice"), As("bob"));
        var id = session.CollectionId;
        var (first, second) = (await CountGroupAsync(alice, id, "First"), await CountGroupAsync(alice, id, "Second"));
        var response = await alice.PostAsJsonAsync("/cellcounts", new CellCount { CollectionId = id, Dots = "[]" }, Json);
        var count = (await response.Content.ReadFromJsonAsync<CellCount>(Json))!.Id;
        (await alice.PutAsJsonAsync("/cellcounts/group", new CountGroupMoveRequest(id, [count], first.Id), Json)).EnsureSuccessStatusCode();

        var moved = await bob.PutAsJsonAsync("/cellcounts/group", new CountGroupMoveRequest(id, [count], second.Id, new() { [count] = null }), Json);

        var result = (await moved.Content.ReadFromJsonAsync<BulkResult>(Json))!;
        Assert.Equal((1, 1), (result.Count, result.Overwrote));
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
