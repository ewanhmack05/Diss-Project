using System.Text.Json;

namespace Tiler.Slides;

/// <summary>
/// One slice of a slide, as the API shows it. GapBefore is true when the slice
/// couldn't be lined up with the one before by its contents - the cuts in
/// between are missing - so the viewer can show a break there.
/// </summary>
public sealed record Slice(int Index, bool GapBefore);

/// <summary>
/// A stack of registered sections: volume-prep/register_sections.py's
/// registration.json plus the .tif it wrote for each section, all on one
/// canvas. Files are full paths, in slice order.
/// </summary>
public sealed record VolumeManifest(IReadOnlyList<string> Files, IReadOnlyList<Slice> Slices, int DefaultSlice)
{
    public const string FileName = "registration.json";

    public static VolumeManifest Read(string folder)
    {
        var path = Path.Combine(folder, FileName);
        if (!File.Exists(path)) throw new InvalidDataException($"{path} isn't there - is this register_sections.py's output folder?");
        using var json = JsonDocument.Parse(File.ReadAllText(path));
        return Parse(json.RootElement, folder);
    }

    public static VolumeManifest Parse(JsonElement root, string folder)
    {
        var sections = root.TryGetProperty("sections", out var s) && s.ValueKind == JsonValueKind.Array
            ? s.EnumerateArray().Select(e => (Order: e.GetProperty("order").GetInt32(), File: e.GetProperty("file").GetString() ?? "")).ToList()
            : throw new InvalidDataException($"{FileName} in {folder} has no sections");
        if (sections.Count == 0) throw new InvalidDataException($"{FileName} in {folder} has no sections");

        sections.Sort((a, b) => a.Order.CompareTo(b.Order));
        var files = new List<string>();
        foreach (var (section, expected) in sections.Select((section, i) => (section, i)))
        {
            if (section.Order != expected) throw new InvalidDataException($"{FileName} in {folder}: sections should be numbered 0 to {sections.Count - 1}, found {section.Order} where {expected} should be");
            // Only a file name - nothing that could point outside the folder.
            if (section.File != Path.GetFileName(section.File) || section.File.Length == 0) throw new InvalidDataException($"{FileName} in {folder}: '{section.File}' isn't a plain file name");
            var full = Path.Combine(folder, section.File);
            if (!File.Exists(full)) throw new InvalidDataException($"{FileName} in {folder} lists {section.File}, which isn't there");
            files.Add(full);
        }

        var gapsBefore = new HashSet<int>();
        if (root.TryGetProperty("links", out var links) && links.ValueKind == JsonValueKind.Array)
        {
            foreach (var link in links.EnumerateArray())
            {
                if (link.GetProperty("kind").GetString() == "gap") gapsBefore.Add(link.GetProperty("b").GetInt32());
            }
        }

        var reference = root.TryGetProperty("reference", out var r) ? r.GetInt32() : files.Count / 2;
        if (reference < 0 || reference >= files.Count) throw new InvalidDataException($"{FileName} in {folder}: reference {reference} isn't one of its {files.Count} sections");

        var slices = Enumerable.Range(0, files.Count).Select(i => new Slice(i, gapsBefore.Contains(i))).ToList();
        return new VolumeManifest(files, slices, reference);
    }
}
