using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using AnnotationStore.History;
using AnnotationStore.ImageAdjustments;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace AnnotationStore.Annotations;

public class AnnotationDbContext(DbContextOptions<AnnotationDbContext> options) : DbContext(options)
{
    public DbSet<Annotation> Annotations => Set<Annotation>();
    public DbSet<AnnotationGroup> AnnotationGroups => Set<AnnotationGroup>();
    public DbSet<CellCount> CellCounts => Set<CellCount>();
    public DbSet<RegionOfInterest> RegionsOfInterest => Set<RegionOfInterest>();
    public DbSet<ImageAdjustments.ImageAdjustments> ImageAdjustments => Set<ImageAdjustments.ImageAdjustments>();
    public DbSet<Collections.Collections> Collections => Set<Collections.Collections>();
    public DbSet<CollectionMember> CollectionMembers => Set<CollectionMember>();
    public DbSet<CollectionInvite> CollectionInvites => Set<CollectionInvite>();
    public DbSet<ChangeSet> ChangeSets => Set<ChangeSet>();
    public DbSet<HistoryEntry> HistoryEntries => Set<HistoryEntry>();

    // The change set this request's writes go in - set by ChangeSetAsync.
    // Every save writes what it did to versioned rows under it (HistoryLog).
    public ChangeSet? CurrentChangeSet { get; set; }
    // Extra said about a delete - a merged group says where it went.
    internal Dictionary<object, object> DeleteNotes { get; } = new(ReferenceEqualityComparer.Instance);

    public override int SaveChanges(bool acceptAllChangesOnSuccess) =>
        SaveChangesAsync(acceptAllChangesOnSuccess).GetAwaiter().GetResult();

    // The change and its history go in together, or neither does.
    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        var history = HistoryLog.Capture(this);
        if (history.Count == 0) return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        await using var transaction = await HistoryLog.BeginAsync(this);
        var saved = await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        await HistoryLog.WriteAsync(this, history, cancellationToken);
        if (transaction is not null) await transaction.CommitAsync(cancellationToken);
        DeleteNotes.Clear();
        return saved;
    }

    // For HistoryLog's own rows, which aren't history of anything.
    internal Task<int> SaveWithoutHistoryAsync(CancellationToken cancellationToken) =>
        base.SaveChangesAsync(true, cancellationToken);

    // The tests run on SQLite, which can't sort DateTimeOffset - and the lists
    // are sorted and paged in SQL, newest first. Stored there as UTC ticks
    // instead, which sort and round-trip exactly (EF's own binary converter
    // drops the last few digits). Postgres keeps its own timestamptz.
    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        if (Database.ProviderName != "Microsoft.EntityFrameworkCore.Sqlite") return;
        configurationBuilder.Properties<DateTimeOffset>().HaveConversion<UtcTicksConverter>();
        configurationBuilder.Properties<DateTimeOffset?>().HaveConversion<UtcTicksConverter>();
    }

    private class UtcTicksConverter() : ValueConverter<DateTimeOffset, long>(
        value => value.UtcTicks,
        ticks => new DateTimeOffset(ticks, TimeSpan.Zero));

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Class name is plural ("Collections"), same EF key-discovery gap as
        // ImageAdjustments below - needs the key spelled out explicitly.
        modelBuilder.Entity<Collections.Collections>().HasKey(c => c.CollectionId);
        // At most one personal collection per user per slide - POST
        // /collections/ensure relies on this to make "get or create" race-safe
        // at the DB level. Sessions are one not ended per host per slide, but
        // that's checked in POST /sessions, not here - older data can have
        // more. Deleted ones don't count, so ensure can make a new one. The
        // filter is plain SQL that Postgres and SQLite both take.
        // A deleted collection is hidden rather than removed - it holds
        // everything in it, and its owner can bring it back. Nothing else
        // keeps deleted rows; they're in the history schema.
        modelBuilder.Entity<Collections.Collections>().Property(c => c.Kind).HasConversion<string>();
        modelBuilder.Entity<Collections.Collections>()
            .HasIndex(c => new { c.SlideId, c.UserId })
            .IsUnique()
            .HasFilter("\"Kind\" = 'Personal' AND \"Deleted\" IS NULL");

        modelBuilder.Entity<CollectionInvite>().HasKey(i => i.Code);
        modelBuilder.Entity<CollectionInvite>().Property(i => i.Role).HasConversion<string>();
        modelBuilder.Entity<Collections.Collections>()
            .HasMany(c => c.Invites)
            .WithOne()
            .HasForeignKey(i => i.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);

        // One row per person per collection. Role as text so the table
        // reads plainly in pgAdmin.
        modelBuilder.Entity<CollectionMember>().HasKey(m => new { m.CollectionId, m.UserId });
        modelBuilder.Entity<CollectionMember>().HasIndex(m => m.UserId);
        modelBuilder.Entity<CollectionMember>().Property(m => m.Role).HasConversion<string>();
        modelBuilder.Entity<Collections.Collections>()
            .HasMany(c => c.Members)
            .WithOne()
            .HasForeignKey(m => m.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Annotation>().HasIndex(a => a.SlideId);
        modelBuilder.Entity<Annotation>().HasIndex(a => a.CollectionId);
        // Configured from the Collections side (HasMany) rather than
        // Annotation's (HasOne) now that Collections.Annotations exists as a
        // real navigation property - GET /collections' .Include() needs that
        // to hydrate it. Annotation itself has no back-reference, hence
        // WithOne() with no argument.
        modelBuilder.Entity<Collections.Collections>()
            .HasMany(c => c.Annotations)
            .WithOne()
            .HasForeignKey(a => a.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<AnnotationGroup>().HasIndex(g => g.CollectionId);
        modelBuilder.Entity<Collections.Collections>()
            .HasMany(c => c.Groups)
            .WithOne()
            .HasForeignKey(g => g.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);
        // Deleting a group ungroups what was in it, rather than deleting it.
        modelBuilder.Entity<Annotation>().HasIndex(a => a.GroupId);
        modelBuilder.Entity<Annotation>()
            .HasOne<AnnotationGroup>()
            .WithMany()
            .HasForeignKey(a => a.GroupId)
            .OnDelete(DeleteBehavior.SetNull);

        modelBuilder.Entity<CellCount>().HasIndex(c => c.SlideId);
        modelBuilder.Entity<CellCount>().HasIndex(c => c.CollectionId);
        modelBuilder.Entity<Collections.Collections>()
            .HasMany(c => c.CellCounts)
            .WithOne()
            .HasForeignKey(c => c.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);

        // Class name is plural ("ImageAdjustments"), so EF's Id-by-convention
        // key discovery (Id or <TypeName>Id) doesn't match ImageAdjustmentId -
        // needs the key spelled out explicitly.
        modelBuilder.Entity<ImageAdjustments.ImageAdjustments>().HasKey(a => a.ImageAdjustmentId);
        modelBuilder.Entity<ImageAdjustments.ImageAdjustments>().HasIndex(a => a.SlideId);
        modelBuilder.Entity<ImageAdjustments.ImageAdjustments>().HasIndex(a => a.CollectionId);
        modelBuilder.Entity<Collections.Collections>()
            .HasMany(c => c.ImageAdjustments)
            .WithOne()
            .HasForeignKey(a => a.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);

        // One-to-one: every ROI belongs to one CellCount, not every
        // CellCount has one. Unique index makes it 1:1, not 1:many.
        modelBuilder.Entity<RegionOfInterest>().HasIndex(r => r.CellCountId).IsUnique();
        modelBuilder.Entity<CellCount>()
            .HasOne(c => c.RegionOfInterest)
            .WithOne()
            .HasForeignKey<RegionOfInterest>(r => r.CellCountId)
            .OnDelete(DeleteBehavior.Cascade);

        // History is its own schema - the live tables above only ever hold
        // what's there now. See History/.
        modelBuilder.Entity<ChangeSet>().ToTable("ChangeSets", "history");
        modelBuilder.Entity<ChangeSet>().HasIndex(c => new { c.CollectionId, c.Created });
        modelBuilder.Entity<ChangeSet>()
            .HasOne<Collections.Collections>()
            .WithMany()
            .HasForeignKey(c => c.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<HistoryEntry>().ToTable("Entries", "history");
        modelBuilder.Entity<HistoryEntry>().Property(e => e.Op).HasConversion<string>();
        modelBuilder.Entity<HistoryEntry>().HasIndex(e => e.ChangeSetId);
        modelBuilder.Entity<HistoryEntry>().HasIndex(e => new { e.CollectionId, e.Entity, e.EntityId });
        modelBuilder.Entity<HistoryEntry>()
            .HasOne<ChangeSet>()
            .WithMany()
            .HasForeignKey(e => e.ChangeSetId)
            .OnDelete(DeleteBehavior.Cascade);
        if (Database.ProviderName == "Npgsql.EntityFrameworkCore.PostgreSQL")
        {
            modelBuilder.Entity<HistoryEntry>().Property(e => e.Before).HasColumnType("jsonb");
            modelBuilder.Entity<HistoryEntry>().Property(e => e.After).HasColumnType("jsonb");
        }

        modelBuilder.Entity<Collections.Collections>().HasQueryFilter(c => c.Deleted == null);
    }
}
