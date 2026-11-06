using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Messaging.Conversations;

public class MessagingDbContext(DbContextOptions<MessagingDbContext> options) : DbContext(options)
{
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<ConversationRead> ConversationReads => Set<ConversationRead>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<AttachmentAdd> AttachmentAdds => Set<AttachmentAdd>();

    // The tests run on SQLite, which can't sort DateTimeOffset. Stored there as
    // UTC ticks instead. Postgres keeps its own timestamptz.
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
        modelBuilder.Entity<Conversation>().Property(c => c.Kind).HasConversion<string>();
        // Nulls don't clash in a unique index, so a session's conversation can
        // leave the users empty, and the other way round.
        modelBuilder.Entity<Conversation>().HasIndex(c => new { c.UserA, c.UserB }).IsUnique();
        modelBuilder.Entity<Conversation>().HasIndex(c => c.SessionId).IsUnique();
        // Finding someone's conversations from either side.
        modelBuilder.Entity<Conversation>().HasIndex(c => c.UserB);

        modelBuilder.Entity<ConversationRead>().HasKey(r => new { r.ConversationId, r.UserId });
        modelBuilder.Entity<ConversationRead>()
            .HasOne<Conversation>()
            .WithMany()
            .HasForeignKey(r => r.ConversationId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Message>().HasIndex(m => new { m.ConversationId, m.Sent });
        modelBuilder.Entity<Message>()
            .HasOne<Conversation>()
            .WithMany()
            .HasForeignKey(m => m.ConversationId)
            .OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<Message>()
            .HasOne(m => m.Attachment)
            .WithOne()
            .HasForeignKey<Attachment>(a => a.MessageId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Attachment>().HasKey(a => a.MessageId);
        modelBuilder.Entity<Attachment>().Property(a => a.Kind).HasConversion<string>();

        modelBuilder.Entity<AttachmentAdd>().HasKey(a => new { a.MessageId, a.UserId });
        modelBuilder.Entity<AttachmentAdd>()
            .HasOne<Attachment>()
            .WithMany()
            .HasForeignKey(a => a.MessageId)
            .OnDelete(DeleteBehavior.Cascade);

        if (Database.ProviderName == "Npgsql.EntityFrameworkCore.PostgreSQL")
            modelBuilder.Entity<Attachment>().Property(a => a.Payload).HasColumnType("jsonb");
    }
}
