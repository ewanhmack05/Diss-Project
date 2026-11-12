using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using SkiaSharp;
using Tiler.Slides;
using Xunit.Abstractions;

namespace Tiler.Tests;

// The API against the four sample slides in tiler/data. Everything marked
// Slide* skips when the slides haven't been pulled from LFS.
public class SlideApiTests : IClassFixture<TilerApiFactory>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly TilerApiFactory _factory;
    private readonly ITestOutputHelper _output;

    public SlideApiTests(TilerApiFactory factory, ITestOutputHelper output)
    {
        _factory = factory;
        _output = output;
    }

    private async Task<Dictionary<string, SlideInfo>> SlidesAsync()
    {
        var slides = await _factory.CreateClient().GetFromJsonAsync<List<SlideInfo>>("/slides", Json);
        return slides!.ToDictionary(slide => slide.Id);
    }

    private async Task<SKBitmap> ThumbnailAsync(string url)
    {
        var response = await _factory.CreateClient().GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/jpeg", response.Content.Headers.ContentType?.MediaType);
        var jpeg = await response.Content.ReadAsByteArrayAsync();
        Assert.Equal([0xFF, 0xD8, 0xFF], jpeg[..3]);
        return SKBitmap.Decode(jpeg);
    }

    [SlideFact]
    public async Task Slides_lists_the_four_samples()
    {
        var slides = await SlidesAsync();

        Assert.Equal(SampleSlides.Ids, slides.Keys.Order());
    }

    [SlideTheory]
    [InlineData("000", "CMU-1")]
    [InlineData("001", "25058_Epiderm_AcH3_3")]
    [InlineData("002", "3D_FL_test01")]
    // The file says None, so it falls back to the id.
    [InlineData("003", "003")]
    public async Task Slides_have_the_scanners_name(string id, string name)
    {
        Assert.Equal(name, (await SlidesAsync())[id].Name);
    }

    [SlideTheory]
    [InlineData("000", "brightfield")]
    [InlineData("001", "fluorescence", "Rhodamine", "FITC", "UV")]
    [InlineData("002", "fluorescence", "Blue", "Green", "Red")]
    [InlineData("003", "brightfield")]
    public async Task Slides_have_a_kind_and_channels(string id, string kind, params string[] channels)
    {
        var slide = (await SlidesAsync())[id];

        Assert.Equal(kind, slide.Kind);
        Assert.Equal(channels, slide.Channels);
    }

    [SlideTheory]
    [InlineData("000", 7)]
    [InlineData("001", 11)]
    [InlineData("002", 11)]
    [InlineData("003", 11)]
    public async Task Slides_count_their_zoom_levels(string id, int levels)
    {
        Assert.Equal(levels, (await SlidesAsync())[id].Levels);
    }

    [SlideTheory]
    [InlineData("000", null, "Hitachi_HV_F22CL", "#ffffff")]
    [InlineData("001", "Plan-Apochromat", "AxioCam Mrm Rev.3", "#808080")]
    // Default objective in the file.
    [InlineData("002", null, "AxioCam Mrm Rev.3", "#808080")]
    [InlineData("003", "Plan-Apochromat", "Hitachi_HV_F22CL", "#ffffff")]
    public async Task Slides_have_an_objective_camera_and_background(string id, string? objectiveName, string camera, string backgroundColour)
    {
        var slide = (await SlidesAsync())[id];

        Assert.Equal(objectiveName, slide.ObjectiveName);
        Assert.Equal(camera, slide.Camera);
        Assert.Equal(backgroundColour, slide.BackgroundColour);
    }

    [SlideFact]
    public async Task Slides_keep_the_fields_they_had()
    {
        var slide = (await SlidesAsync())["000"];

        Assert.Equal("000.mrxs", slide.FileName);
        Assert.Equal(7436, slide.Width);
        Assert.Equal(15494, slide.Height);
        Assert.Equal(256, slide.TileSize);
        Assert.Equal(20, slide.ObjectivePower);
        Assert.NotNull(slide.MppX);
        Assert.NotNull(slide.MppY);
    }

    [SlideFact]
    public async Task Slides_add_up_the_mrxs_and_its_folder()
    {
        var data = Path.Combine(_factory.Services.GetRequiredService<IWebHostEnvironment>().ContentRootPath, "data");
        var expected = new FileInfo(Path.Combine(data, "000.mrxs")).Length
            + Directory.GetFiles(Path.Combine(data, "000")).Sum(path => new FileInfo(path).Length);

        Assert.Equal(expected, (await SlidesAsync())["000"].FileBytes);
    }

    // Nothing that could identify a real slide goes out - no scan date,
    // SLIDE_ID or PROJECT_NAME. See docs/ethics.md.
    [SlideFact]
    public async Task Slides_return_exactly_these_fields()
    {
        var slides = await _factory.CreateClient().GetFromJsonAsync<JsonElement>("/slides");

        foreach (var slide in slides.EnumerateArray())
        {
            Assert.Equal(
                [
                    "id", "fileName", "width", "height", "tileSize", "objectivePower", "mppX", "mppY",
                    "name", "kind", "channels", "levels", "objectiveName", "camera", "backgroundColour", "fileBytes",
                ],
                slide.EnumerateObject().Select(field => field.Name));
        }
    }

    [SlideFact]
    public async Task One_slide_is_the_same_as_its_row_in_the_list()
    {
        var client = _factory.CreateClient();
        var slides = await client.GetFromJsonAsync<JsonElement>("/slides");
        var listed = slides.EnumerateArray().Single(slide => slide.GetProperty("id").GetString() == "001");

        var one = await client.GetFromJsonAsync<JsonElement>("/slides/001");

        Assert.Equal(listed.GetRawText(), one.GetRawText());
    }

    [SlideFact]
    public async Task Thumbnail_is_the_width_asked_for_and_keeps_the_shape()
    {
        using var thumbnail = await ThumbnailAsync("/slides/000/thumbnail.jpg?width=200");

        // 7436 x 15494, so 200 x 416.7
        Assert.Equal(200, thumbnail.Width);
        Assert.Equal(417, thumbnail.Height);
    }

    [SlideFact]
    public async Task Thumbnail_defaults_to_256_wide()
    {
        using var thumbnail = await ThumbnailAsync("/slides/000/thumbnail.jpg");

        Assert.Equal(256, thumbnail.Width);
        Assert.Equal(533, thumbnail.Height);
    }

    [SlideTheory]
    [InlineData(5, 32)]
    [InlineData(5000, 1024)]
    public async Task Thumbnail_width_is_clamped(int asked, int expected)
    {
        using var thumbnail = await ThumbnailAsync($"/slides/000/thumbnail.jpg?width={asked}");

        Assert.Equal(expected, thumbnail.Width);
    }

    // Outside the scanned area OpenSlide gives transparent pixels, which
    // would encode as black.
    [SlideFact]
    public async Task Thumbnail_corners_are_the_background_colour_not_black()
    {
        using var brightfield = await ThumbnailAsync("/slides/000/thumbnail.jpg?width=200");
        using var fluorescence = await ThumbnailAsync("/slides/001/thumbnail.jpg?width=200");

        ThumbnailTests.AssertNear(brightfield.GetPixel(0, 0), 255, 255, 255);
        ThumbnailTests.AssertNear(brightfield.GetPixel(199, 416), 255, 255, 255);
        ThumbnailTests.AssertNear(fluorescence.GetPixel(0, 0), 128, 128, 128);
    }

    [SlideFact]
    public async Task Thumbnail_shows_the_tissue()
    {
        using var thumbnail = await ThumbnailAsync("/slides/000/thumbnail.jpg?width=200");

        var dark = 0;
        for (var y = 0; y < thumbnail.Height; y++)
        {
            for (var x = 0; x < thumbnail.Width; x++)
            {
                var pixel = thumbnail.GetPixel(x, y);
                if (pixel.Red < 200 || pixel.Green < 200 || pixel.Blue < 200) dark++;
            }
        }

        // The scan covers about 9% of slide 000 and most of that is stained.
        Assert.InRange(dark, thumbnail.Width * thumbnail.Height / 100, thumbnail.Width * thumbnail.Height / 5);
    }

    [SlideFact]
    public async Task Thumbnail_can_be_cached_for_a_day()
    {
        var response = await _factory.CreateClient().GetAsync("/slides/000/thumbnail.jpg");

        Assert.Equal("public, max-age=86400", response.Headers.CacheControl?.ToString());
    }

    // Slide 003 is 101832 x 219976. Reading all of that for a card would
    // take minutes and gigabytes - it should come from a level a few
    // hundred pixels wide.
    [SlideFact]
    public void Thumbnail_of_a_huge_slide_reads_a_small_level()
    {
        var pool = _factory.Services.GetRequiredService<SlideCatalog>().GetPool("003")!;

        var level = pool.Use(slide => Thumbnail.ReadLevel(slide, 256));

        Assert.Equal(397, level.Width);
        Assert.Equal(859, level.Height);
        Assert.Equal(397 * 859 * 4, level.Bgra.Length);
    }

    [SlideFact]
    public async Task Thumbnail_of_a_huge_slide_comes_back()
    {
        var timer = Stopwatch.StartNew();
        using var first = await ThumbnailAsync("/slides/003/thumbnail.jpg");
        var firstMs = timer.ElapsedMilliseconds;
        timer.Restart();
        using var second = await ThumbnailAsync("/slides/003/thumbnail.jpg");
        _output.WriteLine($"003 thumbnail, 256 wide: {firstMs} ms the first time, {timer.ElapsedMilliseconds} ms after");

        Assert.Equal(256, first.Width);
        Assert.Equal(553, first.Height);
    }

    [SlideFact]
    public async Task Square_thumbnail_is_as_tall_as_it_is_wide()
    {
        using var thumbnail = await ThumbnailAsync("/slides/000/thumbnail.jpg?width=200&square=true");

        Assert.Equal(200, thumbnail.Width);
        Assert.Equal(200, thumbnail.Height);
    }

    [SlideFact]
    public async Task Square_false_is_the_whole_slide_as_before()
    {
        var client = _factory.CreateClient();

        var plain = await client.GetByteArrayAsync("/slides/000/thumbnail.jpg?width=200");
        var notSquare = await client.GetByteArrayAsync("/slides/000/thumbnail.jpg?width=200&square=false");

        Assert.Equal(plain, notSquare);
        using var decoded = SKBitmap.Decode(plain);
        Assert.Equal(200, decoded.Width);
        Assert.Equal(417, decoded.Height);
    }

    [SlideFact]
    public async Task Square_thumbnail_keeps_the_width_clamp_and_cache_header()
    {
        var response = await _factory.CreateClient().GetAsync("/slides/000/thumbnail.jpg?width=5000&square=true");
        using var decoded = SKBitmap.Decode(await response.Content.ReadAsByteArrayAsync());

        Assert.Equal(1024, decoded.Width);
        Assert.Equal(1024, decoded.Height);
        Assert.Equal("public, max-age=86400", response.Headers.CacheControl?.ToString());
    }

    // Only the square is read, not the whole level - 398 across for 101832
    // level 0 pixels at level 8 (downsample 256).
    [SlideFact]
    public void Square_thumbnail_of_a_huge_slide_reads_only_the_square()
    {
        var pool = _factory.Services.GetRequiredService<SlideCatalog>().GetPool("003")!;
        var square = Thumbnail.CentreSquare(101832, 219976);

        var level = pool.Use(slide => Thumbnail.ReadSquare(slide, square, 256));

        Assert.Equal(398, level.Width);
        Assert.Equal(398, level.Height);
        Assert.Equal(398 * 398 * 4, level.Bgra.Length);
        Assert.Equal(101832 / 256.0, level.SourceWidth);
    }

    [SlideFact]
    public async Task Square_thumbnail_of_a_huge_slide_comes_back()
    {
        var timer = Stopwatch.StartNew();
        using var first = await ThumbnailAsync("/slides/003/thumbnail.jpg?width=200&square=true");
        var firstMs = timer.ElapsedMilliseconds;
        timer.Restart();
        using var second = await ThumbnailAsync("/slides/003/thumbnail.jpg?width=200&square=true");
        _output.WriteLine($"003 square thumbnail, 200 wide: {firstMs} ms the first time, {timer.ElapsedMilliseconds} ms after");

        Assert.Equal(200, first.Width);
        Assert.Equal(200, first.Height);
    }

    [Fact]
    public async Task Unknown_slide_is_not_found()
    {
        var client = _factory.CreateClient();

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/slides/nope")).StatusCode);

        var thumbnail = await client.GetAsync("/slides/nope/thumbnail.jpg?width=200");
        Assert.Equal(HttpStatusCode.NotFound, thumbnail.StatusCode);
        Assert.Null(thumbnail.Headers.CacheControl);

        var square = await client.GetAsync("/slides/nope/thumbnail.jpg?width=200&square=true");
        Assert.Equal(HttpStatusCode.NotFound, square.StatusCode);
    }

    [Fact]
    public async Task Thumbnail_width_that_isnt_a_number_is_a_bad_request()
    {
        var response = await _factory.CreateClient().GetAsync("/slides/nope/thumbnail.jpg?width=wide");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
