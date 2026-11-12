using SkiaSharp;
using Tiler.Slides;

namespace Tiler.Tests;

// Sizes, and the laying on a background colour - no slide file needed.
public class ThumbnailTests
{
    [Theory]
    [InlineData(null, 256)]
    [InlineData(200, 200)]
    [InlineData(32, 32)]
    [InlineData(1024, 1024)]
    [InlineData(31, 32)]
    [InlineData(5, 32)]
    [InlineData(0, 32)]
    [InlineData(-10, 32)]
    [InlineData(1025, 1024)]
    [InlineData(5000, 1024)]
    [InlineData(int.MaxValue, 1024)]
    public void ClampWidth_defaults_to_256_and_stays_between_32_and_1024(int? requested, int expected)
    {
        Assert.Equal(expected, Thumbnail.ClampWidth(requested));
    }

    [Theory]
    // Slide 000: 200 x 15494 / 7436 = 416.7
    [InlineData(7436, 15494, 200, 417)]
    [InlineData(7436, 15494, 256, 533)]
    [InlineData(101832, 219976, 256, 553)]
    [InlineData(1000, 1000, 256, 256)]
    [InlineData(2000, 1000, 256, 128)]
    // 2.5 rounds up, not to the even number below
    [InlineData(1000, 25, 100, 3)]
    // 0.4 would round to nothing
    [InlineData(100000, 1000, 40, 1)]
    [InlineData(100000, 1, 32, 1)]
    public void HeightFor_keeps_the_shape_of_the_slide(long slideWidth, long slideHeight, int width, int expected)
    {
        Assert.Equal(expected, Thumbnail.HeightFor(slideWidth, slideHeight, width));
    }

    [Theory]
    [InlineData("#808080", 128, 128, 128)]
    [InlineData("#ff8000", 255, 128, 0)]
    [InlineData(null, 255, 255, 255)]
    [InlineData("not a colour", 255, 255, 255)]
    public void Encode_lays_transparent_pixels_on_the_background_colour(string? colour, byte red, byte green, byte blue)
    {
        var transparent = new Thumbnail.LevelPixels(new byte[64 * 64 * 4], 64, 64);

        using var decoded = SKBitmap.Decode(Thumbnail.Encode(transparent, 32, 32, colour));

        Assert.Equal(32, decoded.Width);
        Assert.Equal(32, decoded.Height);
        AssertNear(decoded.GetPixel(0, 0), red, green, blue);
        AssertNear(decoded.GetPixel(16, 16), red, green, blue);
    }

    [Fact]
    public void Encode_keeps_the_scanned_pixels_and_fills_round_them()
    {
        // Left half solid red, right half never scanned. OpenSlide's bytes are B, G, R, A.
        const int size = 64;
        var bgra = new byte[size * size * 4];
        for (var y = 0; y < size; y++)
        {
            for (var x = 0; x < size / 2; x++)
            {
                var offset = (y * size + x) * 4;
                bgra[offset + 2] = 255;
                bgra[offset + 3] = 255;
            }
        }

        using var decoded = SKBitmap.Decode(Thumbnail.Encode(new Thumbnail.LevelPixels(bgra, size, size), 32, 32, "#ffffff"));

        AssertNear(decoded.GetPixel(4, 16), 255, 0, 0);
        AssertNear(decoded.GetPixel(28, 16), 255, 255, 255);
    }

    [Fact]
    public void Encode_returns_a_jpeg_of_the_size_asked_for()
    {
        var level = new Thumbnail.LevelPixels(new byte[300 * 500 * 4], 300, 500);

        var jpeg = Thumbnail.Encode(level, 200, 333, null);

        Assert.Equal([0xFF, 0xD8, 0xFF], jpeg[..3]);
        using var decoded = SKBitmap.Decode(jpeg);
        Assert.Equal(200, decoded.Width);
        Assert.Equal(333, decoded.Height);
    }

    [Theory]
    // Portrait, 1:2 - the middle half of the height.
    [InlineData(1000, 2000, 0, 500, 1000)]
    // Landscape - the middle of the width.
    [InlineData(3000, 1000, 1000, 0, 1000)]
    [InlineData(500, 500, 0, 0, 500)]
    // Odd leftovers: 7 spare rows go 3 before, 4 after.
    [InlineData(10, 17, 0, 3, 10)]
    [InlineData(17, 10, 3, 0, 10)]
    [InlineData(7436, 15494, 0, 4029, 7436)]
    [InlineData(101832, 219976, 0, 59072, 101832)]
    [InlineData(1, 1, 0, 0, 1)]
    public void CentreSquare_is_the_middle_of_the_slide(long width, long height, long x, long y, long side)
    {
        var square = Thumbnail.CentreSquare(width, height);

        Assert.Equal(new Thumbnail.Square(x, y, side), square);
        // Whatever's left over is split as evenly as whole pixels allow.
        var before = square.X + square.Y;
        var after = width - square.X - side + height - square.Y - side;
        Assert.InRange(after - before, 0, 1);
    }

    [Theory]
    [InlineData(1024, 1, 1024)]
    [InlineData(1024, 4, 256)]
    [InlineData(101832, 256, 398)]
    [InlineData(7436, 16, 465)]
    [InlineData(7436, 32, 233)]
    [InlineData(1000, 3, 334)]
    [InlineData(1, 512, 1)]
    public void SizeAtLevel_rounds_up_so_the_edge_is_read(long side, double downsample, long expected)
    {
        Assert.Equal(expected, Thumbnail.SizeAtLevel(side, downsample));
    }

    // Reading rounds up, so the last row and column can be mostly past the
    // square. Only the part that's in it should be drawn.
    [Fact]
    public void Encode_draws_only_the_part_of_the_read_the_square_covers()
    {
        const int read = 65;
        var bgra = new byte[read * read * 4];
        for (var y = 0; y < read - 1; y++)
        {
            for (var x = 0; x < read - 1; x++)
            {
                var offset = (y * read + x) * 4;
                bgra[offset + 2] = 255;
                bgra[offset + 3] = 255;
            }
        }

        var level = new Thumbnail.LevelPixels(bgra, read, read, 64, 64);
        using var decoded = SKBitmap.Decode(Thumbnail.Encode(level, 32, 32, "#ffffff"));
        using var whole = SKBitmap.Decode(Thumbnail.Encode(level with { SourceWidth = null, SourceHeight = null }, 32, 32, "#ffffff"));

        // Mipmapping still blends in a little of the extra pixel.
        AssertNear(decoded.GetPixel(31, 16), 255, 0, 0, tolerance: 24);
        AssertNear(decoded.GetPixel(16, 31), 255, 0, 0, tolerance: 24);
        // Drawing all 65 would leave a pale line down the edge.
        Assert.True(whole.GetPixel(31, 16).Green > 50);
        Assert.True(whole.GetPixel(16, 31).Green > 50);
    }

    // JPEG is lossy, so colours come back a few steps out.
    internal static void AssertNear(SKColor actual, byte red, byte green, byte blue, int tolerance = 12)
    {
        Assert.InRange(actual.Red, red - tolerance, red + tolerance);
        Assert.InRange(actual.Green, green - tolerance, green + tolerance);
        Assert.InRange(actual.Blue, blue - tolerance, blue + tolerance);
    }
}
