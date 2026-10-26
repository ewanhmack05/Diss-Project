using AnnotationStore.Annotations;
using AnnotationStore.CellCounts;
using AnnotationStore.History;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;

namespace AnnotationStore.Tests;

// The HistoryArea migration moves every soft-deleted row into the history
// schema and takes it out of the live tables. Run on a database of its own,
// with rows soft deleted the way the last version did it, then up and back
// down again.
public class HistoryMigrationTests : IAsyncLifetime
{
    private const string Before = "20261021084951_SoftDeleteAndChangeSets";
    private const string After = "20261021133213_HistoryArea";

    private readonly string _database = $"annotationstore_migration_{Guid.NewGuid():N}";
    private AnnotationDbContext? _db;

    private static readonly Guid Collection = Guid.NewGuid();
    private static readonly Guid DeletedCollection = Guid.NewGuid();
    private static readonly Guid Delete = Guid.NewGuid();
    private static readonly Guid DeleteCollection = Guid.NewGuid();
    private static readonly Guid Kept = Guid.NewGuid();
    private static readonly Guid Gone = Guid.NewGuid();
    private static readonly Guid Group = Guid.NewGuid();
    private static readonly Guid Count = Guid.NewGuid();
    private static readonly Guid Region = Guid.NewGuid();
    private static readonly Guid Adjustment = Guid.NewGuid();

    public Task InitializeAsync()
    {
        if (CellCountApiFactory.Postgres is null) return Task.CompletedTask;
        var connection = new NpgsqlConnectionStringBuilder(CellCountApiFactory.Postgres) { Database = _database, MaxPoolSize = 2 }.ConnectionString;
        _db = new AnnotationDbContext(new DbContextOptionsBuilder<AnnotationDbContext>().UseNpgsql(connection).Options);
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        if (_db is null) return;
        await _db.Database.EnsureDeletedAsync();
        await _db.DisposeAsync();
    }

    private Task MigrateToAsync(string migration) => _db!.GetService<IMigrator>().MigrateAsync(migration);

    // A plain command - EF's raw SQL would take the JSON's braces for
    // parameters.
    private async Task SqlAsync(string sql)
    {
        var connection = _db!.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open) await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync();
    }

    private async Task<long> ScalarAsync(string sql)
    {
        var connection = _db!.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open) await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt64(await command.ExecuteScalarAsync());
    }

    // Two collections, one deleted, and one of everything soft deleted in a
    // change set - the group with an annotation still in it, the count with
    // its region of interest.
    private Task SeedTheOldWayAsync() => SqlAsync($$"""
        INSERT INTO "Collections" ("CollectionId", "CollectionName", "Created", "Kind", "MaxEditors", "Shared", "SlideId", "UserId", "Deleted", "DeletedIn")
        VALUES ('{{Collection}}', 'c', now(), 'Personal', 6, false, 's', 'alice', NULL, NULL),
               ('{{DeletedCollection}}', 'old', now(), 'Session', 6, false, 's', 'alice', now(), '{{DeleteCollection}}');
        INSERT INTO "ChangeSets" ("Id", "CollectionId", "Created", "UserId", "UserName", "What")
        VALUES ('{{Delete}}', '{{Collection}}', now(), 'alice', 'Alice', 'delete annotations'),
               ('{{DeleteCollection}}', '{{DeletedCollection}}', now(), 'alice', 'Alice', 'delete collection');
        INSERT INTO "AnnotationGroups" ("Id", "CollectionId", "Created", "Name", "Notes", "Deleted", "DeletedIn")
        VALUES ('{{Group}}', '{{Collection}}', now(), 'g', 'group notes', now(), '{{Delete}}');
        INSERT INTO "Annotations" ("Id", "CollectionId", "Colour", "Created", "CreatedById", "CreatedByName", "GeoJson", "GroupId", "Label", "LineStyle", "LineThickness", "Notes", "Shape", "SlideId", "Deleted", "DeletedIn")
        VALUES ('{{Kept}}', '{{Collection}}', '#FF0000', now(), 'alice', 'Alice', '{}', NULL, 'kept', 'solid', 2, '', 'Box', 's', NULL, NULL),
               ('{{Gone}}', '{{Collection}}', '#00FF00', '2026-10-01T09:30:00+00', 'alice', 'Alice', '{"type":"Feature"}', '{{Group}}', 'gone', 'dashed', 3, 'its notes', 'Box', 's', now(), '{{Delete}}');
        INSERT INTO "CellCounts" ("Id", "CollectionId", "Count", "Created", "CreatedById", "CreatedByName", "DotSize", "Dots", "Label", "LocationX", "LocationY", "Notes", "SlideId", "WithAnnotation", "WithRoi", "Deleted", "DeletedIn")
        VALUES ('{{Count}}', '{{Collection}}', 1, now(), 'alice', 'Alice', 6, '[{"x":1,"y":2,"colour":"#ff0000"}]', 'count', 1.5, -2.5, '', 's', true, true, now(), '{{Delete}}');
        INSERT INTO "RegionsOfInterest" ("Id", "CellCountId", "Created", "GeoJson")
        VALUES ('{{Region}}', '{{Count}}', now(), '{"type":"Polygon"}');
        INSERT INTO "ImageAdjustments" ("ImageAdjustmentId", "AdjustmentName", "Adjustments", "CollectionId", "Created", "SlideId", "UserId", "Deleted", "DeletedIn")
        VALUES ('{{Adjustment}}', 'p', '{}', '{{Collection}}', now(), 's', 'alice', now(), '{{Delete}}');
        """);

    [PostgresFact]
    public async Task SoftDeletedRows_BecomeDeleteEntries_ThatRebuildExactly_AndGoBackOnTheWayDown()
    {
        await MigrateToAsync(Before);
        await SeedTheOldWayAsync();

        await MigrateToAsync(After);

        // Out of the live tables, apart from the one that wasn't deleted.
        Assert.Equal([Kept], await _db!.Annotations.Select(a => a.Id).ToListAsync());
        Assert.Empty(await _db.AnnotationGroups.ToListAsync());
        Assert.Empty(await _db.CellCounts.ToListAsync());
        Assert.Empty(await _db.RegionsOfInterest.ToListAsync());
        Assert.Empty(await _db.ImageAdjustments.ToListAsync());
        Assert.Equal(2, await ScalarAsync("""SELECT count(*) FROM history."ChangeSets" """));
        Assert.Equal(0, await ScalarAsync("""SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ChangeSets'"""));
        Assert.Equal(0, await ScalarAsync("""SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'DeletedIn'"""));

        // Into the history, under the change set that deleted them.
        var entries = await _db.HistoryEntries.ToListAsync();
        Assert.All(entries, e => Assert.Equal(HistoryOp.Delete, e.Op));
        Assert.Equal(
            [(HistoryLog.Annotation, Gone), (HistoryLog.CellCount, Count), (HistoryLog.Collection, DeletedCollection),
                (HistoryLog.Group, Group), (HistoryLog.ImageAdjustment, Adjustment), (HistoryLog.RegionOfInterest, Region)],
            entries.Select(e => (e.Entity, e.EntityId)).Order());
        Assert.All(entries.Where(e => e.Entity != HistoryLog.Collection), e => Assert.Equal(Delete, e.ChangeSetId));

        // Postgres' JSON of the row rebuilds the same row HistoryLog would.
        var annotation = HistoryLog.Rebuild<AnnotationStore.Annotations.Annotation>(_db, entries.Single(e => e.EntityId == Gone).Before!);
        Assert.Equal((Gone, "gone", "its notes", "#00FF00", "dashed", 3, Group, "{\"type\":\"Feature\"}"),
            (annotation.Id, annotation.Label, annotation.Notes, annotation.Colour, annotation.LineStyle, annotation.LineThickness, annotation.GroupId, annotation.GeoJson));
        Assert.Equal(new DateTimeOffset(2026, 10, 1, 9, 30, 0, TimeSpan.Zero), annotation.Created);
        var count = HistoryLog.Rebuild<CellCount>(_db, entries.Single(e => e.EntityId == Count).Before!);
        Assert.Equal(("[{\"x\":1,\"y\":2,\"colour\":\"#ff0000\"}]", 1.5, -2.5, true), (count.Dots, count.LocationX, count.LocationY, count.WithRoi));
        Assert.Equal(Count, HistoryLog.Rebuild<RegionOfInterest>(_db, entries.Single(e => e.EntityId == Region).Before!).CellCountId);

        // The deleted collection is still there, hidden.
        Assert.Equal(1, await ScalarAsync($"""SELECT count(*) FROM "Collections" WHERE "CollectionId" = '{DeletedCollection}' AND "Deleted" IS NOT NULL"""));

        await MigrateToAsync(Before);

        Assert.Equal(1, await ScalarAsync($"""SELECT count(*) FROM "Annotations" WHERE "Id" = '{Gone}' AND "DeletedIn" = '{Delete}' AND "Label" = 'gone' AND "GroupId" = '{Group}'"""));
        Assert.Equal(1, await ScalarAsync($"""SELECT count(*) FROM "AnnotationGroups" WHERE "Id" = '{Group}' AND "DeletedIn" = '{Delete}'"""));
        Assert.Equal(1, await ScalarAsync($"""SELECT count(*) FROM "CellCounts" WHERE "Id" = '{Count}' AND "DeletedIn" = '{Delete}' AND "Dots" LIKE '%colour%'"""));
        Assert.Equal(1, await ScalarAsync($"""SELECT count(*) FROM "RegionsOfInterest" WHERE "Id" = '{Region}'"""));
        Assert.Equal(1, await ScalarAsync($"""SELECT count(*) FROM "ImageAdjustments" WHERE "ImageAdjustmentId" = '{Adjustment}' AND "DeletedIn" = '{Delete}'"""));
        Assert.Equal(1, await ScalarAsync($"""SELECT count(*) FROM "Collections" WHERE "CollectionId" = '{DeletedCollection}' AND "DeletedIn" = '{DeleteCollection}'"""));
        Assert.Equal(2, await ScalarAsync("""SELECT count(*) FROM "ChangeSets" """));
    }
}
