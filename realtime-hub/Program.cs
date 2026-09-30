using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using RealtimeHub.Slides;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<SlideRooms>();
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

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.MapHub<SlideHub>("/hubs/slides");

// Read-only look at who's connected - handy from Scalar/curl while testing.
app.MapGet("/rooms", (SlideRooms rooms) => Results.Ok(rooms.Summary()));
app.MapGet("/rooms/{slideId}", (string slideId, SlideRooms rooms) => Results.Ok(rooms.InSlide(slideId)));
app.MapGet("/rooms/{slideId}/docs", (string slideId, SlideRooms rooms) => Results.Ok(rooms.DocsInSlide(slideId)));
// Blind like it is over the hub - no dots until it's revealed.
app.MapGet("/rooms/{slideId}/comparison", (string slideId, SlideRooms rooms) =>
    rooms.ComparisonInSlide(slideId) is { } comparison ? Results.Ok(comparison) : Results.NoContent());

app.Run();

// Lets the test project point WebApplicationFactory<Program> at this app.
public partial class Program;
