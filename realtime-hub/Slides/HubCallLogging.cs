using Microsoft.Extensions.Logging;

namespace RealtimeHub.Slides;

// At Debug, SignalR logs every hub call with its arguments - a guest's name
// in JoinAsGuest included - and logs go to Grafana, which keeps them. So that
// one logger never goes below Information, whatever the config says. Added
// after the config's own rules, once per provider, since a provider's own
// rule for a category beats a general one and the last of equals wins.
public static class HubCallLogging
{
    public const string Dispatcher = "Microsoft.AspNetCore.SignalR.Internal.DefaultHubDispatcher";

    public static void KeepHubCallsOutOfLogs(this IServiceCollection services) =>
        services.PostConfigure<LoggerFilterOptions>(options =>
        {
            var providers = options.Rules.Select(r => r.ProviderName).Append(null).Distinct().ToList();
            foreach (var provider in providers)
                options.Rules.Add(new LoggerFilterRule(provider, Dispatcher, LogLevel.Information, null));
        });
}
