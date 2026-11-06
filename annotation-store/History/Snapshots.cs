using System.Diagnostics.Metrics;
using System.Text.Json;
using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.History;

// A collection as it was once every entry up to UpToEntry had happened, so
// going back doesn't have to undo everything since from what's there now. Only
// what can change is kept (ItemHistory.Changeable) - shapes and dots are fixed
// once saved and are the bulk of a row, so a copy of them would be about 30
// times the size. They come from the live row, or from its delete's copy. In
// the history schema, apart from the data.
public class CollectionSnapshot
{
    public long Id { get; set; }
    public Guid CollectionId { get; set; }
    public long UpToEntry { get; set; }
    public DateTimeOffset Created { get; set; }
    // Entity to row id to column to value - see Snapshots.StateJsonAsync.
    public string Rows { get; set; } = "{}";
}

public static class Snapshots
{
    public const string MeterName = "AnnotationStore.History";
    // How many entries a collection gets past its last snapshot before the
    // next one's due. There can be more between them than this - the check only
    // runs now and then, and one bulk change can be 20,000 entries.
    public const int Every = 5000;

    private static readonly Meter Meter = new(MeterName);
    private static readonly Histogram<long> Sizes = Meter.CreateHistogram<long>(
        "annotation_store.snapshot_bytes", unit: "By", description: "How big each snapshot of a collection was");

    // Everything in the collection that can change, as JSON. The same shape
    // whether it's from a snapshot or what's there now.
    public static async Task<string> StateJsonAsync(AnnotationDbContext db, Guid collectionId)
    {
        var annotations = await db.Annotations.AsNoTracking().Where(a => a.CollectionId == collectionId)
            .Select(a => new { a.Id, a.Label, a.Notes, a.Colour, a.GroupId }).ToListAsync();
        var groups = await db.AnnotationGroups.AsNoTracking().Where(g => g.CollectionId == collectionId)
            .Select(g => new { g.Id, g.Name, g.Notes }).ToListAsync();
        var countGroups = await db.CellCountGroups.AsNoTracking().Where(g => g.CollectionId == collectionId)
            .Select(g => new { g.Id, g.Name, g.Notes }).ToListAsync();
        var counts = await db.CellCounts.AsNoTracking().Where(c => c.CollectionId == collectionId)
            .Select(c => new { c.Id, c.Label, c.Notes, c.GroupId, c.WithAnnotation, c.WithRoi, c.Count, c.DotSize }).ToListAsync();
        return JsonSerializer.Serialize(new Dictionary<string, object>
        {
            [HistoryLog.Annotation] = annotations.ToDictionary(a => a.Id, a => new { a.Label, a.Notes, a.Colour, a.GroupId }),
            [HistoryLog.Group] = groups.ToDictionary(g => g.Id, g => new { g.Name, g.Notes }),
            [HistoryLog.CellCountGroup] = countGroups.ToDictionary(g => g.Id, g => new { g.Name, g.Notes }),
            [HistoryLog.CellCount] = counts.ToDictionary(c => c.Id, c => new { c.Label, c.Notes, c.GroupId, c.WithAnnotation, c.WithRoi, c.Count, c.DotSize }),
        });
    }

    // Null if nothing's happened in it yet. Entry ids are handed out before a
    // save commits, so a newer id can be visible while an older one isn't -
    // the lock waits for saves that have written history and holds back those
    // that haven't, so every entry up to UpToEntry is in Rows, and everything
    // not in Rows gets a higher id. Reads carry on. Other writes wait for as
    // long as it takes to read the rows, so it gives up rather than queue for
    // long, and the next check tries again.
    public static async Task<CollectionSnapshot?> TakeAsync(AnnotationDbContext db, Guid collectionId, CancellationToken cancellationToken = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        if (HistoryLog.IsPostgres(db))
        {
            await db.Database.ExecuteSqlRawAsync("SET LOCAL lock_timeout = '2s'", cancellationToken);
            await db.Database.ExecuteSqlRawAsync("""LOCK TABLE history."Entries" IN SHARE MODE""", cancellationToken);
        }
        var upTo = await db.HistoryEntries.Where(e => e.CollectionId == collectionId).MaxAsync(e => (long?)e.Id, cancellationToken);
        if (upTo is null) return null;
        var snapshot = new CollectionSnapshot
        {
            CollectionId = collectionId,
            UpToEntry = upTo.Value,
            Created = DateTimeOffset.UtcNow,
            Rows = await StateJsonAsync(db, collectionId),
        };
        db.Snapshots.Add(snapshot);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        Sizes.Record(System.Text.Encoding.UTF8.GetByteCount(snapshot.Rows));
        return snapshot;
    }

    // Collections with at least this many entries since their last snapshot.
    public static Task<List<Guid>> DueAsync(AnnotationDbContext db, int every = Every, CancellationToken cancellationToken = default) =>
        db.HistoryEntries
            .Where(e => e.Id > (db.Snapshots.Where(s => s.CollectionId == e.CollectionId).Max(s => (long?)s.UpToEntry) ?? 0))
            .GroupBy(e => e.CollectionId)
            .Where(g => g.Count() >= every)
            .Select(g => g.Key)
            .ToListAsync(cancellationToken);
}

// Looks for collections that are due. In the background so a save never waits
// for it, and a snapshot failing can't fail a save - going back still works
// without one, it just has more to undo.
public class SnapshotService(IServiceScopeFactory scopes, ILogger<SnapshotService> logger) : BackgroundService
{
    private static readonly TimeSpan CheckEvery = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(CheckEvery);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>();
                foreach (var collectionId in await Snapshots.DueAsync(db, cancellationToken: stoppingToken))
                {
                    var snapshot = await Snapshots.TakeAsync(db, collectionId, stoppingToken);
                    if (snapshot is not null)
                        logger.LogInformation("Snapshot of {CollectionId} up to entry {UpToEntry}, {Bytes} bytes", collectionId, snapshot.UpToEntry, snapshot.Rows.Length);
                }
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                logger.LogWarning(error, "Couldn't take a snapshot - trying again at the next check");
            }
        }
    }
}
