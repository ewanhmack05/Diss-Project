using System.Diagnostics;

namespace Tiler.Slides;

/// <summary>
/// Reads every slide's info in the background once the tiler's started, so
/// it's ready before anyone opens the gallery. From SlideInfoCache that's a
/// moment; the first start after slides are added, it's how long reading the
/// new ones takes. Slides:WarmOnStart = false turns it off - the tests do, so
/// nothing opens slides behind their backs.
/// </summary>
public sealed class SlideInfoWarmup(SlideCatalog catalog, IConfiguration configuration, ILogger<SlideInfoWarmup> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!configuration.GetValue("Slides:WarmOnStart", true)) return;
        // Off the startup path - the app's listening before the first slide's read.
        await Task.Yield();

        var clock = Stopwatch.StartNew();
        var failed = 0;
        foreach (var id in catalog.SlideIds)
        {
            if (stoppingToken.IsCancellationRequested) return;
            try
            {
                catalog.GetInfo(id);
            }
            catch (Exception e)
            {
                failed++;
                logger.LogWarning("Couldn't read slide {Id}'s info - {Error}", id, e.Message);
            }
        }
        logger.LogInformation(
            "Slide info for {Count} slides ready in {Seconds:0.0}s - {Hits} kept from last time, {Reads} read, {Failed} failed",
            catalog.SlideIds.Count, clock.Elapsed.TotalSeconds, catalog.InfoHits, catalog.InfoReads, failed);
    }
}
