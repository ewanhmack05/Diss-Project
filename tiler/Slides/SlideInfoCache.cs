using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Tiler.Slides;

/// <summary>
/// MIRAX slides' info kept on disk, so starting again doesn't mean opening
/// every slide to list them. Opening one reads all of its Index.dat - 15 MB for
/// each TCIA slide - so the first GET /slides after a start took 40-50s for
/// 200 slides, and the gallery said "Loading slides..." the whole time.
///
/// An entry is used while every one of the slide's files is the size it was
/// and was last written when it was; anything else and the slide is read
/// again. It's one JSON file, written in full to a temp file that's then moved
/// over it, so stopping mid-write leaves the last good one. A file that's
/// missing, unreadable or from another Version just means starting empty.
/// </summary>
public sealed class SlideInfoCache
{
    /// <summary>Bump when SlideCatalog.ReadInfo works anything out differently, so entries from before aren't used.</summary>
    public const int Version = 1;

    public const string DefaultFileName = ".slide-info.json";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly ConcurrentDictionary<string, Entry> _entries = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _writeLock = new();
    private readonly ILogger? _logger;
    private bool _canWrite = true;

    private sealed record Entry(string Stamp, SlideInfo Info);

    private sealed record Stored(int Version, Dictionary<string, Entry> Entries);

    /// <param name="path">The file. Null keeps nothing - every slide is read each start.</param>
    public SlideInfoCache(string? path, ILogger? logger = null)
    {
        Path = path;
        _logger = logger;
        if (path is null || !File.Exists(path)) return;
        try
        {
            var stored = JsonSerializer.Deserialize<Stored>(File.ReadAllText(path), Json);
            if (stored?.Version != Version || stored.Entries is null) return;
            foreach (var (key, entry) in stored.Entries) _entries[key] = entry;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            logger?.LogWarning("Not using the slide info in {Path} - {Error}. Every slide is read again.", path, e.Message);
        }
    }

    public string? Path { get; }

    public int Count => _entries.Count;

    /// <summary>The info kept for this slide, if its files are still what they were when it was read.</summary>
    public SlideInfo? Get(string key, string stamp) =>
        _entries.TryGetValue(key, out var entry) && entry.Stamp == stamp ? entry.Info : null;

    /// <summary>Keeps a slide's info and writes the file. Not being able to write it isn't an error - the slide's just read again next start.</summary>
    public void Put(string key, string stamp, SlideInfo info)
    {
        _entries[key] = new Entry(stamp, info);
        if (Path is null) return;
        lock (_writeLock)
        {
            if (!_canWrite) return;
            var temp = Path + ".tmp";
            try
            {
                var stored = new Stored(Version, new Dictionary<string, Entry>(_entries, StringComparer.OrdinalIgnoreCase));
                File.WriteAllText(temp, JsonSerializer.Serialize(stored, Json));
                File.Move(temp, Path, overwrite: true);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                // Once is enough - a read-only data folder would say it for every slide.
                _canWrite = false;
                _logger?.LogWarning("Can't keep slide info in {Path} - {Error}. Slides are read again each start.", Path, e.Message);
            }
        }
    }

    /// <summary>
    /// What a slide's files are now: each one's name, size and last write
    /// time, hashed. Sorted by name so the order they're listed in doesn't matter.
    /// </summary>
    public static string Stamp(IEnumerable<string> files)
    {
        var text = new StringBuilder();
        foreach (var file in files.Select(System.IO.Path.GetFullPath).Order(StringComparer.OrdinalIgnoreCase))
        {
            var info = new FileInfo(file);
            text.Append(file).Append('|');
            if (info.Exists) text.Append(info.Length).Append('|').Append(info.LastWriteTimeUtc.Ticks);
            else text.Append("missing");
            text.Append('\n');
        }
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text.ToString())));
    }
}
