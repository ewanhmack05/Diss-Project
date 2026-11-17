using Tiler.Slides;

namespace Tiler.Tests;

// OpenSlideSharp's string marshaling is shared between threads, so reading
// a slide's properties while anything else called OpenSlide crashed the
// process - see OpenSlideApi. These did, every run, before the tiler stopped
// handing OpenSlideSharp strings. A failure here is the test run dying, not a
// red test.
public class ConcurrencyTests
{
    private static string Sample(string id) =>
        Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "data", id + ".mrxs"));

    private static void ReadEveryProperty(int rounds)
    {
        for (var round = 0; round < rounds; round++)
        {
            foreach (var id in SampleSlides.Ids)
            {
                using var slide = SlideHandlePool.Open(Sample(id));
                Assert.NotEmpty(OpenSlideApi.Properties(slide));
            }
        }
    }

    [SlideFact]
    public void Properties_while_tiles_are_read_dont_crash()
    {
        using var slide = SlideHandlePool.Open(Sample("003"));

        Parallel.Invoke(
            () => ReadEveryProperty(3),
            () =>
            {
                for (var i = 0; i < 1500; i++) slide.ReadRegion(0, 50000, 100000, 256, 256);
            });
    }

    [SlideFact]
    public void Properties_while_other_slides_open_dont_crash()
    {
        var tiff = Path.Combine(Path.GetTempPath(), $"tiler-concurrency-{Guid.NewGuid():N}.tif");
        TiledTiff.Write(tiff, 600, 400, (10, 20, 30));
        try
        {
            Parallel.Invoke(
                () => ReadEveryProperty(3),
                () =>
                {
                    for (var i = 0; i < 1000; i++)
                    {
                        using var other = SlideHandlePool.Open(tiff);
                    }
                });
        }
        finally
        {
            File.Delete(tiff);
        }
    }

    [OpenSlideFact]
    public void Properties_come_back_with_their_values()
    {
        var tiff = Path.Combine(Path.GetTempPath(), $"tiler-properties-{Guid.NewGuid():N}.tif");
        TiledTiff.Write(tiff, 300, 200, (10, 20, 30), micronsPerPixel: 0.5);
        try
        {
            using var slide = SlideHandlePool.Open(tiff);
            var properties = OpenSlideApi.Properties(slide);

            Assert.Equal("generic-tiff", properties["openslide.vendor"]);
            Assert.Equal("centimeter", properties["tiff.ResolutionUnit"]);
            Assert.Equal(20000, double.Parse(properties["tiff.XResolution"], System.Globalization.CultureInfo.InvariantCulture));
        }
        finally
        {
            File.Delete(tiff);
        }
    }

    [OpenSlideFact]
    public void Opening_something_that_isnt_a_slide_says_so()
    {
        var path = Path.Combine(Path.GetTempPath(), $"tiler-not-a-slide-{Guid.NewGuid():N}.txt");
        File.WriteAllText(path, "not a slide");
        try
        {
            var error = Assert.Throws<InvalidDataException>(() => SlideHandlePool.Open(path));
            Assert.Contains("doesn't recognise", error.Message);
        }
        finally
        {
            File.Delete(path);
        }
    }
}
