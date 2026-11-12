using System.Text.RegularExpressions;

namespace Tiler.Slides;

/// <summary>
/// Tidies what the scanner wrote about a slide. OpenSlide hands back every
/// line of a MIRAX slide's Slidedat.ini as a property named
/// mirax.SECTION.KEY, and these turn the raw values into what the API returns.
/// The scan date, SLIDE_ID and PROJECT_NAME are left alone on purpose - see
/// docs/ethics.md.
/// </summary>
public static partial class SlideMetadata
{
    public const string NameProperty = "mirax.GENERAL.SLIDE_NAME";
    public const string KindProperty = "mirax.GENERAL.SLIDE_TYPE";
    public const string ObjectiveNameProperty = "mirax.GENERAL.OBJECTIVE_NAME";
    public const string CameraProperty = "mirax.GENERAL.CAMERA_TYPE";
    public const string BackgroundColourProperty = "openslide.background-color";

    /// <summary>The scanner's name for the slide, or its id when the scanner didn't give one.</summary>
    public static string Name(string? raw, string id)
    {
        var name = raw?.Trim();
        return string.IsNullOrEmpty(name) || IsPlaceholder(name, "None") ? id : name;
    }

    public static string? Kind(string? raw) => raw?.Trim() switch
    {
        "SLIDE_TYPE_BRIGHTFIELD" => "brightfield",
        "SLIDE_TYPE_FLUORESCENCE" => "fluorescence",
        _ => null,
    };

    public static string? ObjectiveName(string? raw)
    {
        var name = raw?.Trim();
        return string.IsNullOrEmpty(name) || IsPlaceholder(name, "Default objective") ? null : name;
    }

    public static string? Camera(string? raw)
    {
        var camera = raw?.Trim();
        return string.IsNullOrEmpty(camera) ? null : camera;
    }

    /// <summary>
    /// The FILTER_NAME property names, in the order their sections come in the
    /// file. OpenSlide lists names alphabetically, which would put LEVEL_10
    /// before LEVEL_2, so the numbers are compared as numbers.
    /// </summary>
    public static IReadOnlyList<string> FilterNameProperties(IEnumerable<string> propertyNames) =>
        propertyNames
            .Where(name => FilterNameProperty().IsMatch(name))
            .OrderBy(name => Digits().Replace(name, digits => digits.Value.PadLeft(10, '0')), StringComparer.Ordinal)
            .ToList();

    /// <summary>
    /// Channel names from the slide's filter names - each one once, in the
    /// order given. A brightfield slide has one filter called Default, which
    /// isn't a channel.
    /// </summary>
    public static IReadOnlyList<string> Channels(IEnumerable<string?> filterNames)
    {
        var channels = new List<string>();
        foreach (var raw in filterNames)
        {
            var name = raw?.Trim();
            if (string.IsNullOrEmpty(name) || IsPlaceholder(name, "Default") || channels.Contains(name)) continue;
            channels.Add(name);
        }
        return channels;
    }

    /// <summary>
    /// #rrggbb from OpenSlide's background colour, which is six hex digits
    /// (RRGGBB) - it has already swapped the file's IMAGE_FILL_COLOR_BGR round.
    /// </summary>
    public static string? BackgroundColour(string? raw)
    {
        var hex = raw?.Trim().TrimStart('#');
        if (hex is null || hex.Length != 6 || !hex.All(Uri.IsHexDigit)) return null;
        return "#" + hex.ToLowerInvariant();
    }

    // Scanners aren't consistent about case - the samples have both
    // "Default Camera" and "Default camera".
    private static bool IsPlaceholder(string value, string placeholder) =>
        value.Equals(placeholder, StringComparison.OrdinalIgnoreCase);

    [GeneratedRegex(@"^mirax\..+\.FILTER_NAME$")]
    private static partial Regex FilterNameProperty();

    [GeneratedRegex(@"\d+")]
    private static partial Regex Digits();
}
