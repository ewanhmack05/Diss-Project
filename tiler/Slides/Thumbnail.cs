using OpenSlideSharp;
using SkiaSharp;

namespace Tiler.Slides;

/// <summary>
/// A small JPEG of a whole slide, or of the square in its middle, for the
/// viewer's gallery. Unlike a tile, it's laid on the slide's background
/// colour first, so the parts the scanner skipped don't come out black.
/// </summary>
public static class Thumbnail
{
    public const int DefaultWidth = 256;
    public const int MinWidth = 32;
    public const int MaxWidth = 1024;

    private const int JpegQuality = 85;

    public static int ClampWidth(int? requested) => Math.Clamp(requested ?? DefaultWidth, MinWidth, MaxWidth);

    /// <summary>The height that keeps the slide's shape at the given width.</summary>
    public static int HeightFor(long slideWidth, long slideHeight, int width) =>
        (int)Math.Max(1, Math.Round(width * (double)slideHeight / slideWidth, MidpointRounding.AwayFromZero));

    /// <summary>
    /// Pixels read from one pyramid level, as OpenSlide's pre-multiplied BGRA.
    /// SourceWidth and SourceHeight are how much of them the picture covers,
    /// when that's a fraction of a pixel less than what was read.
    /// </summary>
    public sealed record LevelPixels(byte[] Bgra, int Width, int Height, double? SourceWidth = null, double? SourceHeight = null);

    /// <summary>A square of the slide in level 0 pixels.</summary>
    public sealed record Square(long X, long Y, long Side);

    /// <summary>
    /// The square in the very middle of the slide, as big as its shorter side.
    /// An odd leftover puts the spare pixel after the square, not before.
    /// </summary>
    public static Square CentreSquare(long slideWidth, long slideHeight)
    {
        var side = Math.Min(slideWidth, slideHeight);
        return new Square((slideWidth - side) / 2, (slideHeight - side) / 2, side);
    }

    /// <summary>
    /// How many pixels of a level to read to cover side level 0 pixels -
    /// rounded up, so the last part pixel at the edge is read too.
    /// </summary>
    public static long SizeAtLevel(long side, double levelDownsample) => (long)Math.Ceiling(side / levelDownsample);

    /// <summary>
    /// Reads the smallest pyramid level that's still at least as wide as the
    /// thumbnail, so a 22 gigapixel slide costs a few hundred pixels a side
    /// rather than all of level 0.
    /// </summary>
    public static LevelPixels ReadLevel(OpenSlideImage slide, int width)
    {
        var level = slide.GetBestLevelForDownsample(slide.Dimensions.Width / (double)width);
        var size = slide.GetLevelDimension(level);
        var bgra = slide.ReadRegion(level, 0, 0, size.Width, size.Height);
        return new LevelPixels(bgra, (int)size.Width, (int)size.Height);
    }

    /// <summary>
    /// Reads just the square from the smallest level that still has at least
    /// width pixels across it, rather than the whole level.
    /// </summary>
    public static LevelPixels ReadSquare(OpenSlideImage slide, Square square, int width)
    {
        var level = slide.GetBestLevelForDownsample(square.Side / (double)width);
        var downsample = slide.GetLevelDownsample(level);
        var size = SizeAtLevel(square.Side, downsample);
        // ReadRegion's x and y are in level 0 pixels, the size in the level's.
        var bgra = slide.ReadRegion(level, square.X, square.Y, size, size);
        var covered = square.Side / downsample;
        return new LevelPixels(bgra, (int)size, (int)size, covered, covered);
    }

    /// <summary>
    /// Shrinks the pixels to width x height over the background colour (white
    /// if the slide has none) and encodes it as JPEG.
    /// </summary>
    public static byte[] Encode(LevelPixels level, int width, int height, string? backgroundColour)
    {
        var background = backgroundColour is not null && SKColor.TryParse(backgroundColour, out var parsed)
            ? parsed
            : SKColors.White;

        var levelInfo = new SKImageInfo(level.Width, level.Height, SKColorType.Bgra8888, SKAlphaType.Premul);
        using var levelImage = SKImage.FromPixelCopy(levelInfo, level.Bgra);
        using var surface = SKSurface.Create(new SKImageInfo(width, height, SKColorType.Bgra8888, SKAlphaType.Opaque));
        surface.Canvas.Clear(background);
        // Mipmaps as well as linear, since the level can be nearly twice the
        // thumbnail's size and plain linear skips pixels at that ratio.
        var source = SKRect.Create((float)(level.SourceWidth ?? level.Width), (float)(level.SourceHeight ?? level.Height));
        surface.Canvas.DrawImage(levelImage, source, SKRect.Create(width, height), new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));

        using var image = surface.Snapshot();
        using var data = image.Encode(SKEncodedImageFormat.Jpeg, JpegQuality);
        return data.ToArray();
    }
}
