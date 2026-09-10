using System.Collections.Concurrent;
using OpenSlideSharp;

namespace Tiler.Slides;

public sealed record SlideInfo(string Id, string FileName, long Width, long Height, int TileSize);

/// <summary>
/// Discovers .mrxs (and other OpenSlide-readable) files under a data directory
/// and keeps opened OpenSlideImage handles around for reuse across tile requests.
/// </summary>
public sealed class SlideCatalog : IDisposable
{
    private readonly Dictionary<string, string> _pathsById;
    private readonly ConcurrentDictionary<string, OpenSlideImage> _openSlides = new(StringComparer.OrdinalIgnoreCase);
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

        var dimensions = slide.Dimensions;
        return new SlideInfo(id, Path.GetFileName(_pathsById[id]), dimensions.Width, dimensions.Height, ZoomifyTiling.TileSize);
    }

    public void Dispose()
    {
        foreach (var slide in _openSlides.Values)
        {
            slide.Dispose();
        }
    }
}
