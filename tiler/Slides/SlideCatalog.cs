using System.Collections.Concurrent;
using OpenSlideSharp;

namespace Tiler.Slides;

public sealed record SlideInfo(
    string Id,
    string FileName,
    long Width,
    long Height,
    int TileSize,
    double? ObjectivePower,
    double? MppX,
    double? MppY,
    string Name,
    string? Kind,
    IReadOnlyList<string> Channels,
    int Levels,
    string? ObjectiveName,
    string? Camera,
    string? BackgroundColour,
    long FileBytes,
    // A flat slide is one slice. A volume's slices all share one size and
    // pixel grid, so the same tile from each lines up.
    IReadOnlyList<Slice> Slices,
    int DefaultSlice,
    // How thick each slice was cut, in microns - only for a volume whose
    // registration.json says. The 3D view assumes when it's null.
    double? SectionMicrons);

/// <summary>
/// The slides there are and a pool of opened OpenSlide handles for each slice
/// of each one, reused across tile requests.
///
/// Two kinds of slide. Every .mrxs under the data folder is a flat slide - one
/// slice - with the file name as its id. A volume is a folder written by
/// volume-prep/register_sections.py, with one slice per section: any folder
/// in the data folder with a registration.json in it, named after the
/// folder, or one given in config as Slides:Volumes:{id} = {folder}.
/// </summary>
public sealed class SlideCatalog : IDisposable
{
    // Browsers send about 6 tile requests at once per host, so 8 covers a pan
    // from one viewer with a little room for a second.
    private const int HandlesPerSlide = 8;
    // Across every slide and slice - see HandleBudget. 24 is three slices'
    // worth of full pans (a volume's slice and the two either side) at about
    // 32 MB a warm handle: under 1 GB however many slices there are.
    private const int DefaultMaxOpenHandles = 24;
    private const double DefaultIdleHandleMinutes = 5;

    private sealed record Source(string FileName, IReadOnlyList<string> Files, IReadOnlyList<Slice> Slices, int DefaultSlice, double? SectionMicrons = null);

    private readonly Dictionary<string, Source> _sources;
    private readonly ConcurrentDictionary<(string Id, int Slice), Lazy<SlideHandlePool>> _pools = new();
    // Lazy so a slide is read once when GET /slides and the warm-up (see
    // SlideInfoWarmup) ask for it at the same time.
    private readonly ConcurrentDictionary<string, Lazy<SlideInfo>> _infos = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<string> _skipped = [];
    private readonly Timer _trim;
    private readonly TimeSpan _idleFor;
    private int _infoReads;
    private int _infoHits;

    // What a file checked out without Git LFS starts with - see IsLfsPointer.
    private const string LfsPointerStart = "version https://git-lfs";

    // Slides:DataPath picks the folder - data/ next to the app if it isn't
    // set. A relative path, there or in Slides:Volumes, is from the app's folder.
    public SlideCatalog(IWebHostEnvironment env, IConfiguration configuration, ILogger<SlideCatalog>? logger = null)
    {
        // Slides:MaxOpenHandles and Slides:IdleHandleMinutes change the budget.
        Budget = new HandleBudget(configuration.GetValue("Slides:MaxOpenHandles", DefaultMaxOpenHandles));
        _idleFor = TimeSpan.FromMinutes(configuration.GetValue("Slides:IdleHandleMinutes", DefaultIdleHandleMinutes));
        _trim = new Timer(_ => Budget.TrimIdle(_idleFor), null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1));

        var dataDirectory = Path.Combine(env.ContentRootPath, configuration["Slides:DataPath"] ?? "data");
        // Slides:InfoCachePath picks where slide info is kept between starts -
        // in the data folder if it isn't set, nowhere if it's empty.
        var infoCachePath = configuration["Slides:InfoCachePath"];
        InfoCache = new SlideInfoCache(
            infoCachePath switch
            {
                null => Path.Combine(dataDirectory, SlideInfoCache.DefaultFileName),
                "" => null,
                _ => Path.GetFullPath(Path.Combine(env.ContentRootPath, infoCachePath)),
            },
            logger);
        _sources = new Dictionary<string, Source>(StringComparer.OrdinalIgnoreCase);
        var mirax = Directory.Exists(dataDirectory) ? Directory.GetFiles(dataDirectory, "*.mrxs").Order() : Enumerable.Empty<string>();
        foreach (var path in mirax)
        {
            var id = Path.GetFileNameWithoutExtension(path)!;
            // Without Git LFS the .mrxs, Slidedat.ini and .dat files are all
            // pointers, and OpenSlide fails on the first request instead.
            var pointer = MiraxFiles(path).FirstOrDefault(IsLfsPointer);
            if (pointer is not null)
            {
                _skipped.Add(id);
                logger?.LogWarning("Leaving out slide {Id}: {File} is a Git LFS pointer, not the picture - git lfs pull to get it", id, Path.GetRelativePath(dataDirectory, pointer));
                continue;
            }
            _sources[id] = new Source(Path.GetFileName(path), [path], [new Slice(0, false)], 0);
        }

        // Volumes in the data folder. The MIRAX slides' own folders (000/ and
        // so on) have no registration.json, so they're left alone.
        var dataVolumes = Directory.Exists(dataDirectory)
            ? Directory.GetDirectories(dataDirectory).Where(folder => File.Exists(Path.Combine(folder, VolumeManifest.FileName))).Order()
            : Enumerable.Empty<string>();
        foreach (var folder in dataVolumes)
        {
            var id = Path.GetFileName(folder);
            if (_sources.ContainsKey(id)) throw new InvalidOperationException($"{folder} is a volume with the same id as {id}.mrxs");
            var manifest = VolumeManifest.Read(folder);
            // Checked out without Git LFS (CI does that) the slices are small
            // text pointers, not pictures. Leave the volume out rather than stop
            // the tiler starting - the same as the slide tests skip.
            var pointer = manifest.Files.FirstOrDefault(IsLfsPointer);
            if (pointer is not null)
            {
                _skipped.Add(id);
                logger?.LogWarning("Leaving out volume {Id}: {File} is a Git LFS pointer, not the picture - git lfs pull to get it", id, Path.GetFileName(pointer));
                continue;
            }
            _sources[id] = new Source(id, manifest.Files, manifest.Slices, manifest.DefaultSlice, manifest.SectionMicrons);
            CheckSameSize(id, manifest.Files);
        }

        foreach (var volume in configuration.GetSection("Slides:Volumes").GetChildren())
        {
            if (string.IsNullOrWhiteSpace(volume.Value)) throw new InvalidOperationException($"Slides:Volumes:{volume.Key} has no folder");
            if (_sources.ContainsKey(volume.Key)) throw new InvalidOperationException($"Slides:Volumes:{volume.Key} has the same id as a slide in {dataDirectory}");
            var folder = Path.GetFullPath(Path.Combine(env.ContentRootPath, volume.Value));
            if (!Directory.Exists(folder)) throw new InvalidOperationException($"Slides:Volumes:{volume.Key} points at {folder}, which isn't there");
            var manifest = VolumeManifest.Read(folder);
            _sources[volume.Key] = new Source(Path.GetFileName(folder), manifest.Files, manifest.Slices, manifest.DefaultSlice, manifest.SectionMicrons);
            CheckSameSize(volume.Key, manifest.Files);
        }
    }

    public IReadOnlyCollection<string> SlideIds => _sources.Keys;

    /// <summary>How many OpenSlide handles are open across every slide - see HandleBudget.</summary>
    public HandleBudget Budget { get; }

    /// <summary>Slides and volumes in the data folder that were left out because their files are Git LFS pointers.</summary>
    public IReadOnlyList<string> Skipped => _skipped;

    /// <summary>Where MIRAX slides' info is kept between starts - see SlideInfoCache.</summary>
    public SlideInfoCache InfoCache { get; }

    /// <summary>How many slides' info has been read by opening them since the start.</summary>
    public int InfoReads => Volatile.Read(ref _infoReads);

    /// <summary>How many slides' info came from InfoCache instead.</summary>
    public int InfoHits => Volatile.Read(ref _infoHits);

    /// <summary>A MIRAX slide's files: the .mrxs and everything in the folder of the same name.</summary>
    public static IEnumerable<string> MiraxFiles(string mrxs)
    {
        yield return mrxs;
        var folder = Path.Combine(Path.GetDirectoryName(mrxs)!, Path.GetFileNameWithoutExtension(mrxs));
        if (!Directory.Exists(folder)) yield break;
        foreach (var file in Directory.EnumerateFiles(folder)) yield return file;
    }

    /// <summary>Whether a file is a Git LFS pointer - what's there in place of the file when it's checked out without LFS.</summary>
    public static bool IsLfsPointer(string path)
    {
        using var stream = File.OpenRead(path);
        var start = new byte[LfsPointerStart.Length];
        var read = stream.Read(start, 0, start.Length);
        return System.Text.Encoding.ASCII.GetString(start, 0, read) == LfsPointerStart;
    }

    /// <summary>
    /// Gets (creating on first use) the handle pool for one slice of a slide -
    /// its default slice if none is given. Null if there's no such slide or slice.
    /// </summary>
    public SlideHandlePool? GetPool(string id, int? slice = null)
    {
        if (!_sources.TryGetValue(id, out var source)) return null;
        var index = slice ?? source.DefaultSlice;
        if (index < 0 || index >= source.Files.Count) return null;
        var path = source.Files[index];
        return _pools.GetOrAdd((id.ToLowerInvariant(), index), _ => new Lazy<SlideHandlePool>(() => new SlideHandlePool(path, HandlesPerSlide, Budget))).Value;
    }

    /// <summary>
    /// Slide dimensions and metadata - read once, then kept, since every tile
    /// request needs them. A MIRAX slide's comes from InfoCache when its files
    /// haven't changed, without opening it.
    /// </summary>
    public SlideInfo? GetInfo(string id)
    {
        if (!_sources.TryGetValue(id, out var source)) return null;
        var info = _infos.GetOrAdd(id, _ => new Lazy<SlideInfo>(() => LoadInfo(id, source)));
        try
        {
            return info.Value;
        }
        catch
        {
            // Lazy would keep the exception for good. Without it the next ask
            // tries again, as it did before.
            _infos.TryRemove(new KeyValuePair<string, Lazy<SlideInfo>>(id, info));
            throw;
        }
    }

    private SlideInfo LoadInfo(string id, Source source)
    {
        // Only a flat MIRAX slide: a volume is a handful of TIFFs, quick to open.
        var mrxs = source.Files.Count == 1 && source.Files[0].EndsWith(".mrxs", StringComparison.OrdinalIgnoreCase)
            ? Path.GetFullPath(source.Files[0])
            : null;
        string? stamp = null;
        if (mrxs is not null)
        {
            // Worked out before it's read, so a file changed while it's being
            // read is stamped as it was and read again next start.
            stamp = SlideInfoCache.Stamp(MiraxFiles(mrxs));
            if (InfoCache.Get(mrxs, stamp) is { } kept && kept.Id == id)
            {
                Interlocked.Increment(ref _infoHits);
                return kept;
            }
        }

        var info = GetPool(id)!.Use(slide => ReadInfo(id, source, slide));
        Interlocked.Increment(ref _infoReads);
        if (mrxs is not null) InfoCache.Put(mrxs, stamp!, info);
        return info;
    }

    // Every slice of a volume has to be the same size, or the same tile would
    // show different places on each. register_sections.py writes them that
    // way; this catches a folder that's been mixed up since.
    private static void CheckSameSize(string id, IReadOnlyList<string> files)
    {
        (long, long)? first = null;
        foreach (var file in files)
        {
            using var slide = SlideHandlePool.Open(file);
            var size = (slide.Dimensions.Width, slide.Dimensions.Height);
            first ??= size;
            if (size != first) throw new InvalidOperationException($"Slides:Volumes:{id}: {Path.GetFileName(file)} is {size.Item1}x{size.Item2}, {Path.GetFileName(files[0])} is {first.Value.Item1}x{first.Value.Item2} - every slice has to be the same size");
        }
    }

    // What this returns for a MIRAX slide is kept on disk between starts.
    // Change what it works out and bump SlideInfoCache.Version, or slides
    // keep what the old code said until their files change.
    private static SlideInfo ReadInfo(string id, Source source, OpenSlideImage slide)
    {
        var dimensions = slide.Dimensions;
        // All at once through OpenSlideApi - OpenSlideSharp's own property
        // calls aren't safe alongside other OpenSlide calls (see OpenSlideApi).
        var properties = OpenSlideApi.Properties(slide);
        string? Property(string name) => properties.TryGetValue(name, out var value) ? value : null;

        // openslide.objective-power is the scanner's real objective magnification
        // (OpenSlide's standard property, parsed from the format's own metadata -
        // e.g. MIRAX's Slidedat.ini). Not every format/slide reports it.
        double? objectivePower = double.TryParse(Property("openslide.objective-power"), System.Globalization.CultureInfo.InvariantCulture, out var power)
            ? power
            : null;
        // Microns per pixel at level 0, null when the file doesn't say. Lets
        // the viewer size a real-world ROI box. See MicronsPerPixel for why
        // it doesn't just take openslide.mpp-x/-y.
        var unit = Property(SlideMetadata.ResolutionUnitProperty);
        var mppX = SlideMetadata.MicronsPerPixel(Property("openslide.mpp-x"), Property(SlideMetadata.XResolutionProperty), unit);
        var mppY = SlideMetadata.MicronsPerPixel(Property("openslide.mpp-y"), Property(SlideMetadata.YResolutionProperty), unit);
        var filterNames = SlideMetadata.FilterNameProperties(properties.Keys).Select(Property);
        return new SlideInfo(
            id,
            source.FileName,
            dimensions.Width,
            dimensions.Height,
            ZoomifyTiling.TileSize,
            objectivePower,
            mppX,
            mppY,
            SlideMetadata.Name(Property(SlideMetadata.NameProperty), id),
            SlideMetadata.Kind(Property(SlideMetadata.KindProperty)),
            SlideMetadata.Channels(filterNames),
            ZoomifyTiling.ComputeTiers(dimensions.Width, dimensions.Height).Count,
            SlideMetadata.ObjectiveName(Property(SlideMetadata.ObjectiveNameProperty)),
            SlideMetadata.Camera(Property(SlideMetadata.CameraProperty)),
            SlideMetadata.BackgroundColour(Property(SlideMetadata.BackgroundColourProperty)),
            source.Files.Sum(FileBytes),
            source.Slices,
            source.DefaultSlice,
            source.SectionMicrons);
    }

    /// <summary>What a slide file takes on disk - for .mrxs, the file plus everything in its companion folder.</summary>
    public static long FileBytes(string path)
    {
        var bytes = new FileInfo(path).Length;
        if (!path.EndsWith(".mrxs", StringComparison.OrdinalIgnoreCase)) return bytes;
        var companion = new DirectoryInfo(Path.ChangeExtension(path, null));
        if (companion.Exists) bytes += companion.EnumerateFiles("*", SearchOption.AllDirectories).Sum(file => file.Length);
        return bytes;
    }

    public void Dispose()
    {
        _trim.Dispose();
        foreach (var pool in _pools.Values.Where(pool => pool.IsValueCreated))
        {
            pool.Value.Dispose();
        }
    }
}
