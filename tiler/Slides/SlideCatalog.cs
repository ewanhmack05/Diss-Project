using System.Collections.Concurrent;
using OpenSlideSharp;

namespace Tiler.Slides;

public sealed record SlideInfo(string Id, string FileName, long Width, long Height, int TileSize, double? ObjectivePower, double? MppX, double? MppY);

/// <summary>
/// Discovers .mrxs (and other OpenSlide-readable) files under a data directory
/// and keeps a pool of opened OpenSlideImage handles per slide for reuse across
/// tile requests.
/// </summary>
public sealed class SlideCatalog : IDisposable
{
    // Browsers send about 6 tile requests at once per host, so 8 covers a pan
    // from one viewer with a little room for a second.
    private const int HandlesPerSlide = 8;

    private readonly Dictionary<string, string> _pathsById;
    private readonly ConcurrentDictionary<string, Lazy<SlideHandlePool>> _pools = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, SlideInfo> _infos = new(StringComparer.OrdinalIgnoreCase);

    public SlideCatalog(IWebHostEnvironment env)
    {
        var dataDirectory = Path.Combine(env.ContentRootPath, "data");
        _pathsById = Directory.Exists(dataDirectory)
            ? Directory.GetFiles(dataDirectory, "*.mrxs")
                .ToDictionary(path => Path.GetFileNameWithoutExtension(path)!, path => path, StringComparer.OrdinalIgnoreCase)
            : new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    }

    public IReadOnlyCollection<string> SlideIds => _pathsById.Keys;

    /// <summary>Gets (creating on first use) the handle pool for a slide id.</summary>
    public SlideHandlePool? GetPool(string id)
    {
        if (!_pathsById.TryGetValue(id, out var path)) return null;
        return _pools.GetOrAdd(id, _ => new Lazy<SlideHandlePool>(() => new SlideHandlePool(path, HandlesPerSlide))).Value;
    }

    /// <summary>Slide dimensions and metadata - read once, then cached, since every tile request needs them.</summary>
    public SlideInfo? GetInfo(string id)
    {
        if (_infos.TryGetValue(id, out var cached)) return cached;
        var pool = GetPool(id);
        if (pool is null) return null;

        return _infos.GetOrAdd(id, _ => pool.Use(slide => ReadInfo(id, slide)));
    }

    private SlideInfo ReadInfo(string id, OpenSlideImage slide)
    {
        var dimensions = slide.Dimensions;
        // openslide.objective-power is the scanner's real objective magnification
        // (OpenSlide's standard property, parsed from the format's own metadata -
        // e.g. MIRAX's Slidedat.ini). Not every format/slide reports it.
        double? objectivePower = slide.TryGetProperty("openslide.objective-power", out var raw)
            && double.TryParse(raw, System.Globalization.CultureInfo.InvariantCulture, out var power)
                ? power
                : null;
        // openslide.mpp-x/-y (microns per pixel at level 0) - also a standard
        // OpenSlide property, same nullable-if-unsupported convention as
        // objective-power above. Lets the viewer size a real-world ROI box.
        double? mppX = slide.TryGetProperty("openslide.mpp-x", out var rawMppX)
            && double.TryParse(rawMppX, System.Globalization.CultureInfo.InvariantCulture, out var parsedMppX)
                ? parsedMppX
                : null;
        double? mppY = slide.TryGetProperty("openslide.mpp-y", out var rawMppY)
            && double.TryParse(rawMppY, System.Globalization.CultureInfo.InvariantCulture, out var parsedMppY)
                ? parsedMppY
                : null;
        return new SlideInfo(id, Path.GetFileName(_pathsById[id]), dimensions.Width, dimensions.Height, ZoomifyTiling.TileSize, objectivePower, mppX, mppY);
    }

    public void Dispose()
    {
        foreach (var pool in _pools.Values.Where(pool => pool.IsValueCreated))
        {
            pool.Value.Dispose();
        }
    }
}
