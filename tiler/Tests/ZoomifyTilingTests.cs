using Tiler.Slides;

namespace Tiler.Tests;

// The ladder's length is what /slides returns as levels.
public class ZoomifyTilingTests
{
    [Theory]
    [InlineData(7436, 15494, 7)]
    [InlineData(76324, 170960, 11)]
    [InlineData(72448, 152080, 11)]
    [InlineData(101832, 219976, 11)]
    [InlineData(256, 256, 1)]
    [InlineData(257, 100, 2)]
    [InlineData(1, 1, 1)]
    public void ComputeTiers_counts_the_halvings_down_to_one_tile(long width, long height, int expected)
    {
        Assert.Equal(expected, ZoomifyTiling.ComputeTiers(width, height).Count);
    }

    [Fact]
    public void ComputeTiers_runs_from_one_tile_up_to_full_size()
    {
        var tiers = ZoomifyTiling.ComputeTiers(7436, 15494);

        Assert.Equal((1, 1), tiers[0]);
        Assert.Equal((1, 2), tiers[1]);
        Assert.Equal((2, 4), tiers[2]);
        Assert.Equal((30, 61), tiers[^1]);
    }
}
