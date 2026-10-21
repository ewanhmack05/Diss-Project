using AnnotationStore.Annotations;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Npgsql;

namespace AnnotationStore.Tests;

// Swaps Postgres for in-memory SQLite so tests don't need a real database,
// while still exercising real DDL (foreign keys, cascade delete). The
// connection has to stay open for the factory's life or the DB gets dropped.
// With ANNOTATION_STORE_TEST_POSTGRES set to a connection string, each test
// class gets a Postgres database of its own instead, built from the real
// migrations and dropped afterwards - see the README.
public class CellCountApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public static readonly string? Postgres = Environment.GetEnvironmentVariable("ANNOTATION_STORE_TEST_POSTGRES");

    // Connections each test class's database can have open at once. Classes
    // run in parallel, each with its own pool, and a stock Postgres (like
    // CI's) only takes 100 - a burst test opening one per request used to
    // hit "too many clients". Past this a request waits for a free one, so
    // bursts still overlap. PostgresPoolTests checks the classes still fit.
    public const int PoolSizePerDatabase = 8;

    private readonly SqliteConnection _connection = new("DataSource=:memory:");
    private readonly string _postgresDatabase = $"annotationstore_test_{Guid.NewGuid():N}";

    // Explicit interface impl - WebApplicationFactory already has its own
    // DisposeAsync() (returns ValueTask); IAsyncLifetime's version returns
    // Task, so implementing it implicitly would collide.
    Task IAsyncLifetime.InitializeAsync()
    {
        _connection.Open();
        return Task.CompletedTask;
    }

    async Task IAsyncLifetime.DisposeAsync()
    {
        if (Postgres is not null)
        {
            using var scope = Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<AnnotationDbContext>().Database.EnsureDeletedAsync();
        }
        await base.DisposeAsync();
        await _connection.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureServices(services =>
        {
            // Removing DbContextOptions<T> alone isn't enough - Npgsql's
            // config is also layered on as IDbContextOptionsConfiguration<T>
            // and stacks with ours. Remove both or EF sees two providers.
            services.RemoveAll<DbContextOptions<AnnotationDbContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<AnnotationDbContext>>();
            if (Postgres is null)
                services.AddDbContext<AnnotationDbContext>(options => options.UseSqlite(_connection));
            else
                services.AddDbContext<AnnotationDbContext>(options =>
                    options.UseNpgsql(new NpgsqlConnectionStringBuilder(Postgres)
                    {
                        Database = _postgresDatabase,
                        MaxPoolSize = PoolSizePerDatabase,
                    }.ConnectionString));

            // No Keycloak in tests - see TestAuthHandler.
            services.AddAuthentication(TestAuthHandler.Scheme)
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.Scheme, _ => { });

            using var scope = services.BuildServiceProvider().CreateScope();
            var database = scope.ServiceProvider.GetRequiredService<AnnotationDbContext>().Database;
            if (Postgres is null) database.EnsureCreated();
            else database.Migrate();
        });
    }
}

// For what SQLite can't show - it runs one write at a time on the one
// connection, so nothing there ever happens at the same moment.
public sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute()
    {
        if (CellCountApiFactory.Postgres is null) Skip = "Needs ANNOTATION_STORE_TEST_POSTGRES";
    }
}
