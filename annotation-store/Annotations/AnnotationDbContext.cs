using AnnotationStore.CellCounts;
using AnnotationStore.Collections;
using AnnotationStore.ImageAdjustments;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.Annotations;

public class AnnotationDbContext(DbContextOptions<AnnotationDbContext> options) : DbContext(options)
{
    public DbSet<Annotation> Annotations => Set<Annotation>();
    public DbSet<CellCount> CellCounts => Set<CellCount>();
    public DbSet<RegionOfInterest> RegionsOfInterest => Set<RegionOfInterest>();
    public DbSet<ImageAdjustments.ImageAdjustments> ImageAdjustments => Set<ImageAdjustments.ImageAdjustments>();
    public DbSet<Collections.Collections> Collections => Set<Collections.Collections>();
    public DbSet<CollectionMember> CollectionMembers => Set<CollectionMember>();
    public DbSet<CollectionInvite> CollectionInvites => Set<CollectionInvite>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Class name is plural ("Collections"), same EF key-discovery gap as
        // ImageAdjustments below - needs the key spelled out explicitly.
        modelBuilder.Entity<Collections.Collections>().HasKey(c => c.CollectionId);
        // At most one personal collection per user per slide - POST
        // /collections/ensure relies on this to make "get or create" race-safe
        // at the DB level. Sessions aren't limited - you can host as many as
        // you like. The filter is plain SQL that Postgres and SQLite both take.
        modelBuilder.Entity<Collections.Collections>().Property(c => c.Kind).HasConversion<string>();
        modelBuilder.Entity<Collections.Collections>()
            .HasIndex(c => new { c.SlideId, c.UserId })
            .IsUnique()
            .HasFilter("\"Kind\" = 'Personal'");

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
    }
}
