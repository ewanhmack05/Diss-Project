using OpenSlideSharp;

namespace Tiler.Slides;

/// <summary>
/// Serves OpenSlide-readable pyramids through a Zoomify-shaped tile URL scheme
/// (TileGroup{n}/{z}-{x}-{y}.jpg), matching what OpenLayers' ol/source/Zoomify
/// requests client-side - see ol/source/Zoomify's default tierSizeCalculation,
/// which this mirrors. TileGroup numbers are Zoomify's static-file bucketing
/// optimization; since we serve dynamically we accept (and ignore) any value.
/// </summary>
public static class ZoomifyTiling
{
    public const int TileSize = 256;

    /// <summary>
    /// Tier sizes in tiles (cols, rows). Index 0 is the most zoomed-out tier
    /// (a single tile); the last index is native resolution.
    /// </summary>
    public static IReadOnlyList<(int Cols, int Rows)> ComputeTiers(long width, long height)
    {
        var tiers = new List<(int, int)>();
        long w = width, h = height;
        while (w > TileSize || h > TileSize)
        {
            tiers.Add(((int)((w + TileSize - 1) / TileSize), (int)((h + TileSize - 1) / TileSize)));
            w >>= 1;
            h >>= 1;
        }
        tiers.Add((1, 1));
        tiers.Reverse();
        return tiers;
    }

    public sealed record TileRequest(
        int SlideLevel,
        long X0,
        long Y0,
        long ReadWidth,
        long ReadHeight,
        int TargetWidth,
        int TargetHeight);

    /// <summary>
    /// Resolves a Zoomify (tier, x, y) tile request against an OpenSlide image,
    /// picking the best native pyramid level and the source region to read -
    /// the caller resizes ReadWidth x ReadHeight down/up to TargetWidth x TargetHeight
    /// since the source format's native levels rarely land exactly on a tier boundary.
    /// </summary>
    public static TileRequest? Resolve(OpenSlideImage slide, long width, long height, int tier, int x, int y)
    {
        var tiers = ComputeTiers(width, height);
        if (tier < 0 || tier >= tiers.Count) return null;

        var (cols, rows) = tiers[tier];
        if (x < 0 || x >= cols || y < 0 || y >= rows) return null;

        var distanceFromNative = tiers.Count - 1 - tier;
        var downsample = Math.Pow(2, distanceFromNative);

        var tileFootprint = (long)(TileSize * downsample);
        var x0 = x * tileFootprint;
        var y0 = y * tileFootprint;
        var regionWidth = Math.Min(tileFootprint, width - x0);
        var regionHeight = Math.Min(tileFootprint, height - y0);
        if (regionWidth <= 0 || regionHeight <= 0) return null;

        var slideLevel = slide.GetBestLevelForDownsample(downsample);
        var levelDownsample = slide.GetLevelDownsample(slideLevel);

        var readWidth = (long)Math.Ceiling(regionWidth / levelDownsample);
        var readHeight = (long)Math.Ceiling(regionHeight / levelDownsample);
        var targetWidth = (int)Math.Ceiling(regionWidth / downsample);
        var targetHeight = (int)Math.Ceiling(regionHeight / downsample);

        return new TileRequest(slideLevel, x0, y0, readWidth, readHeight, targetWidth, targetHeight);
    }
}
