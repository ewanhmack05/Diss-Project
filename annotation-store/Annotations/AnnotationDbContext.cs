using AnnotationStore.CellCounts;
using AnnotationStore.ImageAdjustments;
using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.Annotations;

public class AnnotationDbContext(DbContextOptions<AnnotationDbContext> options) : DbContext(options)
{
    public DbSet<Annotation> Annotations => Set<Annotation>();
    public DbSet<CellCount> CellCounts => Set<CellCount>();
    public DbSet<RegionOfInterest> RegionsOfInterest => Set<RegionOfInterest>();
    public DbSet<ImageAdjustments.ImageAdjustments> ImageAdjustments => Set<ImageAdjustments.ImageAdjustments>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Annotation>().HasIndex(a => a.SlideId);
        modelBuilder.Entity<CellCount>().HasIndex(c => c.SlideId);
        // Class name is plural ("ImageAdjustments"), so EF's Id-by-convention
        // key discovery (Id or <TypeName>Id) doesn't match ImageAdjustmentId -
        // needs the key spelled out explicitly.
        modelBuilder.Entity<ImageAdjustments.ImageAdjustments>().HasKey(a => a.ImageAdjustmentId);
        modelBuilder.Entity<ImageAdjustments.ImageAdjustments>().HasIndex(a => a.SlideId);

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
