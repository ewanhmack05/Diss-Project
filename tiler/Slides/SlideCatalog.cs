using System.Collections.Concurrent;
using OpenSlideSharp;

namespace Tiler.Slides;

public sealed record SlideInfo(string Id, string FileName, long Width, long Height, int TileSize, double? ObjectivePower, double? MppX, double? MppY);

/// <summary>
/// Discovers .mrxs (and other OpenSlide-readable) files under a data directory
/// and keeps opened OpenSlideImage handles around for reuse across tile requests.
/// </summary>
public sealed class SlideCatalog : IDisposable
{
    private readonly Dictionary<string, string> _pathsById;
    private readonly ConcurrentDictionary<string, OpenSlideImage> _openSlides = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, object> _readLocks = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _openLock = new();

    public SlideCatalog(IWebHostEnvironment env)
    {
        var dataDirectory = Path.Combine(env.ContentRootPath, "data");
        _pathsById = Directory.Exists(dataDirectory)
            ? Directory.GetFiles(dataDirectory, "*.mrxs")
                .ToDictionary(path => Path.GetFileNameWithoutExtension(path)!, path => path, StringComparer.OrdinalIgnoreCase)
            : new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    }

    public IReadOnlyCollection<string> SlideIds => _pathsById.Keys;

    /// <summary>Gets (opening and caching on first use) the OpenSlide handle for a slide id.</summary>
    public OpenSlideImage? Get(string id)
    {
        if (_openSlides.TryGetValue(id, out var cached)) return cached;
        if (!_pathsById.TryGetValue(id, out var path)) return null;

        lock (_openLock)
        {
            return _openSlides.GetOrAdd(id, _ => OpenSlideImage.Open(path));
        }
    }

    public SlideInfo? GetInfo(string id)
    {
        var slide = Get(id);
        if (slide is null) return null;

        // OpenSlide's native handle isn't safe to call from multiple threads at
        // once - guard every native call (here and in the tile endpoint) with
        // the same per-slide lock. Different slides still read fully in parallel.
        lock (GetReadLock(id))
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
    }

    /// <summary>Lock guarding native OpenSlide calls for a given slide - see GetInfo.</summary>
    public object GetReadLock(string id) => _readLocks.GetOrAdd(id, _ => new object());

    public void Dispose()
    {
        foreach (var slide in _openSlides.Values)
        {
            slide.Dispose();
        }
    }
}
