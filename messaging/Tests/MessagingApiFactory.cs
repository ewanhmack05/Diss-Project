using System.Collections.Concurrent;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using Messaging.Conversations;
using Messaging.Sessions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Messaging.Tests;

// In-memory SQLite, or with MESSAGING_TEST_POSTGRES set, a Postgres database of
// its own built from the real migrations and dropped afterwards. No Keycloak or
// annotation-store - see TestAuthHandler and FakeSessions.
public class MessagingApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public static readonly string? Postgres = Environment.GetEnvironmentVariable("MESSAGING_TEST_POSTGRES");

    private readonly SqliteConnection _connection = new("DataSource=:memory:");
    private readonly string _postgresDatabase = $"messaging_test_{Guid.NewGuid():N}";

    public FakeSessions Sessions { get; } = new();

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
            await scope.ServiceProvider.GetRequiredService<MessagingDbContext>().Database.EnsureDeletedAsync();
        }
        await base.DisposeAsync();
        await _connection.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<MessagingDbContext>>();
            services.RemoveAll<IDbContextOptionsConfiguration<MessagingDbContext>>();
            if (Postgres is null)
                services.AddDbContext<MessagingDbContext>(options => options.UseSqlite(_connection));
            else
                services.AddDbContext<MessagingDbContext>(options =>
                    options.UseNpgsql(new NpgsqlConnectionStringBuilder(Postgres) { Database = _postgresDatabase }.ConnectionString));

            services.RemoveAll<ISessionAccess>();
            services.AddSingleton<ISessionAccess>(Sessions);

            services.AddAuthentication(TestAuthHandler.Scheme)
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.Scheme, _ => { });

            using var scope = services.BuildServiceProvider().CreateScope();
            var database = scope.ServiceProvider.GetRequiredService<MessagingDbContext>().Database;
            if (Postgres is null) database.EnsureCreated();
            else database.Migrate();
        });
    }
}

// Stands in for annotation-store. The token is the user's id - see TestClient.
public class FakeSessions : ISessionAccess
{
    private readonly ConcurrentDictionary<(Guid, string), SessionMembership> _members = new();

    public bool Down { get; set; }

    public void Add(Guid session, string user, SessionRole role = SessionRole.Editor, bool ended = false) =>
        _members[(session, user)] = new SessionMembership(role, ended);

    public void Remove(Guid session, string user) => _members.TryRemove((session, user), out _);

    public Task<SessionMembership?> MembershipAsync(Guid sessionId, string accessToken, CancellationToken cancellationToken)
    {
        if (Down) throw new SessionAccessUnavailable("Down for the test");
        return Task.FromResult(_members.GetValueOrDefault((sessionId, accessToken)));
    }
}

// Whoever the X-Test-User header says. X-Test-Name sets their display name.
public class TestAuthHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public new const string Scheme = "Test";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var userId = Request.Headers["X-Test-User"].FirstOrDefault();
        if (userId is null) return Task.FromResult(AuthenticateResult.NoResult());
        var name = Request.Headers["X-Test-Name"].FirstOrDefault() ?? $"User {userId}";
        var identity = new ClaimsIdentity([new Claim("sub", userId), new Claim("name", name)], Scheme);
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme)));
    }
}

public static class TestClient
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static HttpClient As(this MessagingApiFactory factory, string userId)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User", userId);
        client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", $"Bearer {userId}");
        return client;
    }
}

// For what SQLite can't show: requests at the same moment.
public sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute()
    {
        if (MessagingApiFactory.Postgres is null) Skip = "Needs MESSAGING_TEST_POSTGRES";
    }
}
