using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using AnnotationStore.History;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace AnnotationStore.Tests;

// GET /slides/summary - what the viewer's gallery shows on each slide's card.
// It answers for every slide a person has anything on, so each test has
// people of its own. A shared collection counts for everyone, so the test
// that shares one always stops sharing it before it finishes.
public class SlideSummaryTests : IClassFixture<CellCountApiFactory>
{
    private static readonly JsonSerializerOptions Json = TestJson.Options;

    private readonly CellCountApiFactory _factory;

    public SlideSummaryTests(CellCountApiFactory factory)
    {
        _factory = factory;
    }

    private HttpClient As(string userId) => TestAuthHandler.As(_factory.CreateClient(), userId, $"User {userId}");

    private static string NewUser(string name) => $"{name}-{Guid.NewGuid():N}";

    private static string NewSlide() => Guid.NewGuid().ToString();

    private static async Task<List<SlideSummary>> SummaryAsync(HttpClient client) =>
        (await client.GetFromJsonAsync<List<SlideSummary>>("/slides/summary", Json))!;

    private static async Task<Annotation> AddAnnotationAsync(HttpClient client, Guid collectionId)
    {
        var response = await client.PostAsJsonAsync("/annotations", new Annotation { CollectionId = collectionId, Label = "a" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<Annotation>(Json))!;
    }

    private static async Task AddCellCountAsync(HttpClient client, Guid collectionId)
    {
        var response = await client.PostAsJsonAsync("/cellcounts", new CellCount { CollectionId = collectionId, Label = "c", Dots = "[]" });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    private static async Task<Guid> StartAsync(HttpClient host, string slideId)
    {
        var response = await host.PostAsJsonAsync("/sessions", new EnsureRequest(slideId));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<CollectionView>(Json))!.CollectionId;
    }

    private static async Task JoinAsync(HttpClient host, Guid sessionId, HttpClient who, CollectionRole role = CollectionRole.Editor)
    {
        var invite = await host.PostAsJsonAsync($"/collections/{sessionId}/invites", new InviteRequest(role, 24), Json);
        Assert.Equal(HttpStatusCode.Created, invite.StatusCode);
        var code = (await invite.Content.ReadFromJsonAsync<InviteView>(Json))!.Code;
        (await who.PostAsync($"/invites/{code}/accept", null)).EnsureSuccessStatusCode();
    }

    private static async Task EndAsync(HttpClient host, Guid sessionId) =>
        (await host.PostAsync($"/collections/{sessionId}/end", null)).EnsureSuccessStatusCode();

    private static async Task ShareAsync(HttpClient owner, Guid collectionId, bool shared) =>
        (await owner.PutAsJsonAsync($"/collections/{collectionId}/sharing", new SharingRequest(shared), Json)).EnsureSuccessStatusCode();

    // Deletes it, and answers with the change set that puts it back.
    private static async Task<Guid> DeleteAsync(HttpClient owner, Guid collectionId)
    {
        var response = await owner.DeleteAsync($"/collections/{collectionId}");
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        return Guid.Parse(response.Headers.GetValues(ChangeSetEndpoints.Header).Single());
    }

    private static async Task RestoreAsync(HttpClient owner, Guid changeSet) =>
        (await owner.PostAsync($"/changesets/{changeSet}/restore", null)).EnsureSuccessStatusCode();

    [Fact]
    public async Task NothingYet_IsAnEmptyList()
    {
        var response = await As(NewUser("alice")).GetAsync("/slides/summary");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("[]", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task YourOwnCollection_Counts_OnceTheresAnAnnotationInIt()
    {
        var alice = As(NewUser("alice"));
        var slideId = NewSlide();
        var id = await TestJson.EnsureCollectionAsync(alice, slideId);

        // Only opened - everyone who opens a slide has one of these.
        Assert.Empty(await SummaryAsync(alice));

        await AddAnnotationAsync(alice, id);
        Assert.Equal([new SlideSummary(slideId, 1, 0)], await SummaryAsync(alice));

        // It's collections being counted, not what's in them.
        await AddAnnotationAsync(alice, id);
        await AddCellCountAsync(alice, id);
        Assert.Equal([new SlideSummary(slideId, 1, 0)], await SummaryAsync(alice));
    }

    [Fact]
    public async Task ACellCountOnItsOwn_Counts()
    {
        var alice = As(NewUser("alice"));
        var slideId = NewSlide();
        var id = await TestJson.EnsureCollectionAsync(alice, slideId);

        await AddCellCountAsync(alice, id);

        Assert.Equal([new SlideSummary(slideId, 1, 0)], await SummaryAsync(alice));
    }

    [Fact]
    public async Task TakingTheLastThingOut_StopsItCounting()
    {
        var alice = As(NewUser("alice"));
        var id = await TestJson.EnsureCollectionAsync(alice, NewSlide());
        var annotation = await AddAnnotationAsync(alice, id);
        Assert.Single(await SummaryAsync(alice));

        Assert.Equal(HttpStatusCode.NoContent, (await alice.DeleteAsync($"/annotations/{annotation.Id}")).StatusCode);

        Assert.Empty(await SummaryAsync(alice));
    }

    [Fact]
    public async Task EverySlide_IsARowOfItsOwn_SortedBySlideId()
    {
        var alice = As(NewUser("alice"));
        var run = Guid.NewGuid().ToString("N");
        // Capitals before lower case, and 10 before 9 - by the characters, not
        // how a database's collation would have it.
        foreach (var slideId in new[] { $"{run}-b", $"{run}-9", $"{run}-a", $"{run}-C", $"{run}-10" })
            await AddAnnotationAsync(alice, await TestJson.EnsureCollectionAsync(alice, slideId));
        // A session with something in it on one of them, and a slide only opened.
        await AddCellCountAsync(alice, await StartAsync(alice, $"{run}-a"));
        await TestJson.EnsureCollectionAsync(alice, $"{run}-opened");

        var raw = await alice.GetFromJsonAsync<JsonElement>("/slides/summary");

        Assert.All(raw.EnumerateArray(), row =>
            Assert.Equal(["slideId", "collections", "liveSessions"], row.EnumerateObject().Select(p => p.Name)));
        Assert.Equal(
            [
                new SlideSummary($"{run}-10", 1, 0),
                new SlideSummary($"{run}-9", 1, 0),
                new SlideSummary($"{run}-C", 1, 0),
                new SlideSummary($"{run}-a", 2, 1),
                new SlideSummary($"{run}-b", 1, 0),
            ],
            raw.Deserialize<List<SlideSummary>>(Json)!);
    }

    [Fact]
    public async Task SomeoneElsesCollection_CountsOnlyWhileItsShared()
    {
        var alice = As(NewUser("alice"));
        var bob = As(NewUser("bob"));
        var slideId = NewSlide();
        var alices = await TestJson.EnsureCollectionAsync(alice, slideId);
        await AddAnnotationAsync(alice, alices);
        var alicesEmpty = await TestJson.EnsureCollectionAsync(alice, NewSlide());

        Assert.Empty(await SummaryAsync(bob));

        await ShareAsync(alice, alices, true);
        await ShareAsync(alice, alicesEmpty, true);
        try
        {
            // The shared one with nothing in it still isn't a row.
            Assert.Equal([new SlideSummary(slideId, 1, 0)], await SummaryAsync(bob));
            // Hers and shared is still the one collection.
            Assert.Equal([new SlideSummary(slideId, 1, 0)], await SummaryAsync(alice));

            await AddCellCountAsync(bob, await TestJson.EnsureCollectionAsync(bob, slideId));
            Assert.Equal([new SlideSummary(slideId, 2, 0)], await SummaryAsync(bob));
        }
        finally
        {
            // Even if that failed, or everyone in the other tests would see it.
            await ShareAsync(alice, alices, false);
            await ShareAsync(alice, alicesEmpty, false);
        }

        Assert.Equal([new SlideSummary(slideId, 1, 0)], await SummaryAsync(bob));
    }

    [Fact]
    public async Task ALiveSession_Counts_EvenWithNothingInIt()
    {
        var alice = As(NewUser("alice"));
        var bob = As(NewUser("bob"));
        var carol = As(NewUser("carol"));
        var slideId = NewSlide();
        var session = await StartAsync(alice, slideId);

        Assert.Equal([new SlideSummary(slideId, 0, 1)], await SummaryAsync(alice));
        Assert.Empty(await SummaryAsync(bob));

        await JoinAsync(alice, session, bob, CollectionRole.Viewer);

        Assert.Equal([new SlideSummary(slideId, 0, 1)], await SummaryAsync(bob));
        Assert.Empty(await SummaryAsync(carol));
    }

    [Fact]
    public async Task ASessionWithWorkInIt_CountsForThePeopleInIt_AndNobodyElse()
    {
        var alice = As(NewUser("alice"));
        var bob = As(NewUser("bob"));
        var carol = As(NewUser("carol"));
        var slideId = NewSlide();
        var session = await StartAsync(alice, slideId);
        await JoinAsync(alice, session, bob);
        await AddAnnotationAsync(bob, session);

        Assert.Equal([new SlideSummary(slideId, 1, 1)], await SummaryAsync(alice));
        Assert.Equal([new SlideSummary(slideId, 1, 1)], await SummaryAsync(bob));
        Assert.Empty(await SummaryAsync(carol));
    }

    [Fact]
    public async Task EndingASession_TakesItOffLive_ButItsWorkStillCounts()
    {
        var alice = As(NewUser("alice"));
        var bob = As(NewUser("bob"));
        var slideId = NewSlide();
        var session = await StartAsync(alice, slideId);
        await JoinAsync(alice, session, bob);
        await AddAnnotationAsync(alice, session);
        var emptySlide = NewSlide();
        var empty = await StartAsync(alice, emptySlide);
        Assert.Equal(
            new[] { new SlideSummary(slideId, 1, 1), new SlideSummary(emptySlide, 0, 1) }.OrderBy(s => s.SlideId, StringComparer.Ordinal).ToList(),
            await SummaryAsync(alice));

        await EndAsync(alice, session);
        await EndAsync(alice, empty);

        // The ended one with nothing in it has nothing left to say.
        Assert.Equal([new SlideSummary(slideId, 1, 0)], await SummaryAsync(alice));
        Assert.Equal([new SlideSummary(slideId, 1, 0)], await SummaryAsync(bob));
    }

    [Fact]
    public async Task LeavingASession_StopsItCounting()
    {
        var bobId = NewUser("bob");
        var alice = As(NewUser("alice"));
        var bob = As(bobId);
        var slideId = NewSlide();
        var session = await StartAsync(alice, slideId);
        await JoinAsync(alice, session, bob);
        await AddAnnotationAsync(alice, session);
        Assert.Equal([new SlideSummary(slideId, 1, 1)], await SummaryAsync(bob));

        Assert.Equal(HttpStatusCode.NoContent, (await bob.DeleteAsync($"/collections/{session}/members/{bobId}")).StatusCode);

        Assert.Empty(await SummaryAsync(bob));
        Assert.Equal([new SlideSummary(slideId, 1, 1)], await SummaryAsync(alice));
    }

    [Fact]
    public async Task YourOwnAndYourSessions_AddUp_OnTheOneSlide()
    {
        var alice = As(NewUser("alice"));
        var bob = As(NewUser("bob"));
        var slideId = NewSlide();
        await AddAnnotationAsync(alice, await TestJson.EnsureCollectionAsync(alice, slideId));
        await AddCellCountAsync(alice, await StartAsync(alice, slideId));
        // Bob's has nothing in it yet, so it's live without being a collection to open.
        await JoinAsync(bob, await StartAsync(bob, slideId), alice);

        Assert.Equal([new SlideSummary(slideId, 2, 2)], await SummaryAsync(alice));
        Assert.Equal([new SlideSummary(slideId, 0, 1)], await SummaryAsync(bob));
    }

    [Fact]
    public async Task ADeletedCollection_DoesntCount_UntilItsPutBack()
    {
        var alice = As(NewUser("alice"));
        var bob = As(NewUser("bob"));
        var slideId = NewSlide();
        var own = await TestJson.EnsureCollectionAsync(alice, slideId);
        await AddAnnotationAsync(alice, own);
        var session = await StartAsync(alice, slideId);
        await JoinAsync(alice, session, bob);
        await AddAnnotationAsync(bob, session);
        Assert.Equal([new SlideSummary(slideId, 2, 1)], await SummaryAsync(alice));

        var deletedSession = await DeleteAsync(alice, session);

        // What was in it and who was in it are still there - they just don't count.
        Assert.Equal([new SlideSummary(slideId, 1, 0)], await SummaryAsync(alice));
        Assert.Empty(await SummaryAsync(bob));

        var deletedOwn = await DeleteAsync(alice, own);
        Assert.Empty(await SummaryAsync(alice));

        await RestoreAsync(alice, deletedSession);
        Assert.Equal([new SlideSummary(slideId, 1, 1)], await SummaryAsync(alice));
        Assert.Equal([new SlideSummary(slideId, 1, 1)], await SummaryAsync(bob));

        await RestoreAsync(alice, deletedOwn);
        Assert.Equal([new SlideSummary(slideId, 2, 1)], await SummaryAsync(alice));
    }

    [Fact]
    public async Task AGuest_IsTurnedDown()
    {
        var alice = As(NewUser("alice"));
        var slideId = NewSlide();
        var session = await StartAsync(alice, slideId);
        var guest = GuestTokens.With(_factory.CreateClient(), GuestTokens.Make(GuestTokens.Key(_factory), session));

        // The token's a good one - it's this endpoint that isn't for guests.
        Assert.Equal(HttpStatusCode.OK, (await guest.GetAsync($"/collections?slideId={slideId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await guest.GetAsync("/slides/summary")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await GuestTokens.With(_factory.CreateClient(), "not.a.token").GetAsync("/slides/summary")).StatusCode);
    }

    // The gallery asks once for every slide there is, so it can't be a query a slide.
    [Fact]
    public async Task ItsTwoQueries_HoweverManySlidesThereAre()
    {
        var sql = new SqlCounter();
        using var counted = _factory.WithWebHostBuilder(builder => builder.ConfigureLogging(logging => logging.AddProvider(sql)));
        var alice = TestAuthHandler.As(counted.CreateClient(), NewUser("alice"));
        await AddAnnotationAsync(alice, await TestJson.EnsureCollectionAsync(alice, NewSlide()));

        sql.Reset();
        Assert.Single(await SummaryAsync(alice));
        Assert.Equal(2, sql.Count);

        for (var i = 0; i < 12; i++)
        {
            var slideId = NewSlide();
            await AddAnnotationAsync(alice, await TestJson.EnsureCollectionAsync(alice, slideId));
            if (i % 3 == 0) await AddCellCountAsync(alice, await StartAsync(alice, slideId));
        }

        sql.Reset();
        Assert.Equal(13, (await SummaryAsync(alice)).Count);
        Assert.Equal(2, sql.Count);
    }

    // The tests run on SQLite unless they're pointed at a Postgres. Npgsql
    // turning the same two queries into SQL needs no server, so that's
    // checked every time.
    [Fact]
    public void BothQueries_TranslateOnPostgres_AsOneGroupedStatementEach()
    {
        using var db = new AnnotationDbContext(
            new DbContextOptionsBuilder<AnnotationDbContext>().UseNpgsql("Host=nowhere").Options);

        var withWork = SlideSummaryEndpoints.CollectionsWithWork(db, "alice").ToQueryString();
        var live = SlideSummaryEndpoints.LiveSessions(db, "alice").ToQueryString();

        foreach (var sql in new[] { withWork, live })
        {
            Assert.Contains("GROUP BY c.\"SlideId\"", sql);
            // Deleted collections are hidden by the context's own filter.
            Assert.Contains("c.\"Deleted\" IS NULL", sql);
        }
        // Whether there's anything in it is asked of the database, without
        // reading a row of it.
        Assert.Contains("EXISTS", withWork);
        Assert.DoesNotContain("\"GeoJson\"", withWork);
        Assert.DoesNotContain("\"Dots\"", withWork);
    }

    // Counts the SQL commands EF Core runs, from its own log.
    private sealed class SqlCounter : ILoggerProvider, ILogger
    {
        private int _count;

        public int Count => _count;

        public void Reset() => Interlocked.Exchange(ref _count, 0);

        public ILogger CreateLogger(string categoryName) =>
            categoryName == DbLoggerCategory.Database.Command.Name ? this : NullLogger.Instance;

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (eventId.Id == RelationalEventId.CommandExecuted.Id) Interlocked.Increment(ref _count);
        }

        public void Dispose()
        {
        }
    }
}
