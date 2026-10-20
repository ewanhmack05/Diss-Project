using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using RealtimeHub.Auth;
using RealtimeHub.Slides;

namespace RealtimeHub.Tests;

// Everything turned up to Trace, the way someone chasing a bug might. At
// Debug SignalR logs every call's arguments, which would put a guest's name
// in the logs - and logs go to Grafana, which keeps them.
public class VerboseHubFactory : HubFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Logging:LogLevel:Default", "Trace");
        builder.UseSetting("Logging:LogLevel:Microsoft", "Trace");
        builder.UseSetting("Logging:LogLevel:Microsoft.AspNetCore", "Trace");
        builder.UseSetting("Logging:LogLevel:Microsoft.AspNetCore.SignalR", "Trace");
        builder.UseSetting("Logging:LogLevel:Microsoft.AspNetCore.Http.Connections", "Trace");
        // The most specific rule there can be - this provider, this logger.
        builder.UseSetting($"Logging:{typeof(CapturingLoggerProvider).FullName}:LogLevel:{HubCallLogging.Dispatcher}", "Trace");
    }
}

public class GuestLoggingTests(VerboseHubFactory factory) : IClassFixture<VerboseHubFactory>
{
    [Fact]
    public async Task GuestsName_IsNotLogged_EvenWithLoggingTurnedRightUp()
    {
        const string name = "Wilhelmina Xylo";
        var sessionId = Guid.NewGuid();

        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/guests")
        {
            Content = JsonContent.Create(new { inviteCode = TestGuestInvites.Code("open", sessionId) }),
        };
        request.Headers.Add(TestRemoteAddress.Header, TestRemoteAddress.NewAddress());
        using var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        var guest = (await response.Content.ReadFromJsonAsync<GuestResponse>())!;

        var server = factory.Server;
        await using (var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, $"/hubs/slides?access_token={guest.Token}"), options =>
            {
                options.Transports = HttpTransportType.WebSockets;
                options.SkipNegotiation = true;
                options.WebSocketFactory = async (context, ct) =>
                    await server.CreateWebSocketClient().ConnectAsync(context.Uri, ct);
            })
            .AddJsonProtocol(options => HubJson.Configure(options.PayloadSerializerOptions))
            .Build())
        {
            await connection.StartAsync();
            await connection.InvokeAsync<JoinResult>("JoinAsGuest", sessionId.ToString("D"), name);
        }

        var lines = factory.Logs.Lines.ToList();
        // Shows the logging really is turned up, so the check below means something.
        Assert.Contains(lines, l => l.StartsWith("Trace ") || l.StartsWith("Debug "));
        Assert.DoesNotContain(lines, l => l.Contains("Wilhelmina") || l.Contains("Xylo"));
    }
}
