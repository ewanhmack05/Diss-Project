using AnnotationStore.Annotations;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace AnnotationStore.Tests;

// Swaps Postgres for in-memory SQLite so tests don't need a real database,
// while still exercising real DDL (foreign keys, cascade delete). The
// connection has to stay open for the factory's life or the DB gets dropped.
public class CellCountApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");

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
            services.AddDbContext<AnnotationDbContext>(options => options.UseSqlite(_connection));

            using var scope = services.BuildServiceProvider().CreateScope();
            scope.ServiceProvider.GetRequiredService<AnnotationDbContext>().Database.EnsureCreated();
        });
    }
}
