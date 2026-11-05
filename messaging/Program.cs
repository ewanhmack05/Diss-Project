using System.Text.Json;
using System.Text.Json.Serialization;
using DotNetEnv;
using Messaging.Auth;
using Messaging.Conversations;
using Messaging.Sessions;
using Microsoft.EntityFrameworkCore;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Scalar.AspNetCore;

// Loads .env if there is one, into environment variables, before CreateBuilder
// reads them. It's gitignored, so hosted environments set real ones instead.
Env.Load();

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<MessagingDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Messaging")));

// Any origin, so the viewer works from other devices on the network too.
// Needs a real origin list once deployed.
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

builder.Services.AddOpenApi();
builder.AddKeycloakAuth();

// Who's in which session lives in annotation-store - see Sessions/SessionAccess.cs.
builder.Services.AddHttpClient<ISessionAccess, AnnotationStoreSessionAccess>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["AnnotationStore:BaseUrl"] ?? "http://localhost:5252/");
    client.Timeout = TimeSpan.FromSeconds(5);
});

// Kinds go over the wire as "cellCount" rather than 2.
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase)));

// Traces, metrics and logs go to Grafana (see dashboard/README.md) over OTLP on
// localhost:4317, sent in the background, so nothing breaks if it isn't running.
var consoleTelemetry = builder.Configuration.GetValue<bool>("Telemetry:Console");
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource.AddService("messaging"))
    .WithTracing(tracing =>
    {
        tracing.AddAspNetCoreInstrumentation().AddOtlpExporter();
        if (consoleTelemetry) tracing.AddConsoleExporter();
    })
    .WithMetrics(metrics =>
    {
        metrics.AddAspNetCoreInstrumentation().AddMeter("System.Runtime").AddMeter(Endpoints.MeterName).AddOtlpExporter((_, reader) =>
            reader.PeriodicExportingMetricReaderOptions.ExportIntervalMilliseconds = 5000);
        if (consoleTelemetry) metrics.AddConsoleExporter();
    })
    .WithLogging(logging => logging.AddOtlpExporter());

var app = builder.Build();

// Session chat can't work without annotation-store saying who's in the session,
// and that's not the same as them not being in it. Direct messages never get here.
app.Use(async (context, next) =>
{
    try
    {
        await next();
    }
    catch (SessionAccessUnavailable problem)
    {
        app.Logger.LogWarning(problem, "Couldn't check a session's members");
        context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        await context.Response.WriteAsJsonAsync("Couldn't check you're in that session - try again");
    }
});

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
    app.MapScalarApiReference().AllowAnonymous();
}

// Makes the database, and brings it up to date, when it starts. In the container,
// Database:MigrateOnStartup does the same - see the Dockerfile.
if (app.Environment.IsDevelopment() || app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    using var scope = app.Services.CreateScope();
    scope.ServiceProvider.GetRequiredService<MessagingDbContext>().Database.Migrate();
}

app.MapMessagingEndpoints();
app.Run();

public partial class Program;
