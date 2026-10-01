using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using RealtimeHub.Auth;
using RealtimeHub.Slides;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<SlideRooms>();
// Who's in which session lives in annotation-store - see Slides/SessionAccess.cs.
builder.Services.AddHttpClient<ISessionAccess, AnnotationStoreSessionAccess>(client =>
    client.BaseAddress = new Uri(builder.Configuration["AnnotationStore:BaseUrl"] ?? "http://localhost:5252/"));
// The 32KB default silently dropped long freehand annotations.
builder.Services.AddSignalR(options => options.MaximumReceiveMessageSize = 1024 * 1024)
    .AddJsonProtocol(options => HubJson.Configure(options.PayloadSerializerOptions));

// Any origin, so the viewer works from other devices on the network too.
// SignalR sends credentials, and AllowAnyOrigin can't be combined with
// that, hence the always-true check. Needs a real origin list once deployed.
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.SetIsOriginAllowed(_ => true).AllowAnyMethod().AllowAnyHeader().AllowCredentials());
});

// Same enum strings on the /rooms endpoints as over the hub.
builder.Services.ConfigureHttpJsonOptions(options => HubJson.Configure(options.SerializerOptions));

builder.Services.AddOpenApi();

// Sign-in via Keycloak - see Auth/KeycloakAuth.cs. Nobody joins a session
// without a token, and who they are comes from it.
builder.AddKeycloakAuth();

// Same setup as annotation-store - goes to Grafana if it's running, nothing
// breaks if it isn't. The SignalR source/meter add hub method calls and
// open connection counts on top of the usual HTTP ones.
var consoleTelemetry = builder.Configuration.GetValue<bool>("Telemetry:Console");
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource.AddService("realtime-hub"))
    .WithTracing(tracing =>
    {
        tracing.AddAspNetCoreInstrumentation()
            .AddSource("Microsoft.AspNetCore.SignalR.Server")
            .AddOtlpExporter();
        if (consoleTelemetry) tracing.AddConsoleExporter();
    })
    .WithMetrics(metrics =>
    {
        metrics.AddAspNetCoreInstrumentation()
            .AddMeter("System.Runtime")
            .AddMeter("Microsoft.AspNetCore.Http.Connections")
            .AddOtlpExporter((_, reader) =>
                reader.PeriodicExportingMetricReaderOptions.ExportIntervalMilliseconds = 5000);
        if (consoleTelemetry) metrics.AddConsoleExporter();
    })
    .WithLogging(logging => logging.AddOtlpExporter());

var app = builder.Build();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();
    app.MapScalarApiReference().AllowAnonymous();
}

app.MapHub<SlideHub>("/hubs/slides");

// Read-only look at who's connected - handy from Scalar/curl while testing.
// Development only, and open, since they're just for poking at.
if (app.Environment.IsDevelopment())
{
    app.MapGet("/rooms", (SlideRooms rooms) => Results.Ok(rooms.Summary())).AllowAnonymous();
    app.MapGet("/rooms/{roomId}", (string roomId, SlideRooms rooms) => Results.Ok(rooms.InRoom(roomId))).AllowAnonymous();
    app.MapGet("/rooms/{roomId}/docs", (string roomId, SlideRooms rooms) => Results.Ok(rooms.DocsInRoom(roomId))).AllowAnonymous();
    // Blind like it is over the hub - no dots until it's revealed.
    app.MapGet("/rooms/{roomId}/comparison", (string roomId, SlideRooms rooms) =>
        rooms.ComparisonInRoom(roomId) is { } comparison ? Results.Ok(comparison) : Results.NoContent()).AllowAnonymous();
    app.MapGet("/rooms/{roomId}/sharedcount", (string roomId, SlideRooms rooms) =>
        rooms.SharedCountInRoom(roomId) is { } sharedCount ? Results.Ok(sharedCount) : Results.NoContent()).AllowAnonymous();
}

app.Run();

// Lets the test project point WebApplicationFactory<Program> at this app.
public partial class Program;
