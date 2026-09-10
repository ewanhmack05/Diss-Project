using Microsoft.EntityFrameworkCore;

namespace AnnotationStore.Annotations;

public class AnnotationDbContext(DbContextOptions<AnnotationDbContext> options) : DbContext(options)
{
    public DbSet<Annotation> Annotations => Set<Annotation>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Annotation>().HasIndex(a => a.SlideId);
    }
}
