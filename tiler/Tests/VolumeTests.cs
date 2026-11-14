using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using OpenSlideSharp;
using SkiaSharp;
using Tiler.Slides;

namespace Tiler.Tests;

// A made-up volume in a temp folder, the way register_sections.py writes one:
// three slices, each one colour, with a gap before the last.
public sealed class VolumeFolder : IDisposable
{
    public static readonly (byte R, byte G, byte B)[] Colours = [(200, 30, 30), (30, 180, 30), (30, 30, 200)];
    public const int Width = 600;
    public const int Height = 400;

    public string Path { get; } = Directory.CreateTempSubdirectory("tiler-volume-").FullName;

    public VolumeFolder()
    {
        for (var i = 0; i < Colours.Length; i++) TiledTiff.Write(File(i), Width, Height, Colours[i]);
        WriteRegistration(System.IO.Path.Combine(Path, VolumeManifest.FileName), Colours.Length, gapBefore: 2, reference: 1);
    }

    public string File(int i) => System.IO.Path.Combine(Path, $"Image_{i:00}.tif");

    public static void WriteRegistration(string path, int count, int gapBefore, int reference)
    {
        var json = new
        {
            reference,
            sections = Enumerable.Range(0, count).Select(i => new { order = i, file = $"Image_{i:00}.tif" }),
            links = Enumerable.Range(0, count - 1).Select(i => new { a = i, b = i + 1, kind = i + 1 == gapBefore ? "gap" : "features" }),
        };
        System.IO.File.WriteAllText(path, JsonSerializer.Serialize(json));
    }

    // The factory that owns this can be disposed more than once.
    public void Dispose()
    {
        if (Directory.Exists(Path)) Directory.Delete(Path, recursive: true);
    }
}

// OpenSlide is a native library. CI installs it; a machine without it skips these.
public sealed class OpenSlideFactAttribute : FactAttribute
{
    public static readonly string? Missing = Probe();

    public OpenSlideFactAttribute()
    {
        if (Missing is not null) Skip = Missing;
    }

    private static string? Probe()
    {
        var path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"tiler-probe-{Guid.NewGuid():N}.tif");
        try
        {
            OpenSlideNative.Register();
            TiledTiff.Write(path, 10, 10, (0, 0, 0));
            using var slide = SlideHandlePool.Open(path);
            return null;
        }
        catch (Exception e) when (e is DllNotFoundException or TypeInitializationException or BadImageFormatException)
        {
            return $"Needs OpenSlide installed - {e.GetType().Name}";
        }
        finally
        {
            System.IO.File.Delete(path);
        }
    }
}

public sealed class VolumeApiFactory : WebApplicationFactory<Program>
{
    public VolumeFolder Volume { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("OTEL_SDK_DISABLED", "true");
        builder.UseSetting("Slides:Volumes:stack", Volume.Path);
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing) Volume.Dispose();
    }
}

public class VolumeApiTests : IClassFixture<VolumeApiFactory>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly VolumeApiFactory _factory;

    public VolumeApiTests(VolumeApiFactory factory) => _factory = factory;

    private async Task<SlideInfo> InfoAsync() =>
        (await _factory.CreateClient().GetFromJsonAsync<SlideInfo>("/slides/stack", Json))!;

    // Tier 0 is one tile of the whole slice, so its middle is the slice's colour.
    private async Task<SKColor> MiddleOfTileAsync(string url)
    {
        var response = await _factory.CreateClient().GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var bitmap = SKBitmap.Decode(await response.Content.ReadAsByteArrayAsync());
        return bitmap.GetPixel(bitmap.Width / 2, bitmap.Height / 2);
    }

    private static void AssertColour((byte R, byte G, byte B) expected, SKColor actual)
    {
        // JPEG moves solid colours a few levels.
        Assert.InRange(actual.Red, expected.R - 12, expected.R + 12);
        Assert.InRange(actual.Green, expected.G - 12, expected.G + 12);
        Assert.InRange(actual.Blue, expected.B - 12, expected.B + 12);
    }

    [OpenSlideFact]
    public async Task Volume_lists_its_slices_and_where_the_gap_is()
    {
        var info = await InfoAsync();

        Assert.Equal([new Slice(0, false), new Slice(1, false), new Slice(2, true)], info.Slices);
        Assert.Equal(1, info.DefaultSlice);
        Assert.Equal((VolumeFolder.Width, VolumeFolder.Height), (info.Width, info.Height));
        Assert.Equal(0.25, info.MppX!.Value, 3);
    }

    [OpenSlideFact]
    public async Task Volume_without_a_thickness_says_null()
    {
        Assert.Null((await InfoAsync()).SectionMicrons);
    }

    [OpenSlideFact]
    public async Task Volume_is_in_the_slide_list()
    {
        var slides = await _factory.CreateClient().GetFromJsonAsync<List<SlideInfo>>("/slides", Json);

        Assert.Contains(slides!, slide => slide.Id == "stack" && slide.Slices.Count == 3);
    }

    [OpenSlideFact]
    public async Task Volume_counts_every_slices_bytes()
    {
        var info = await InfoAsync();

        Assert.Equal(Enumerable.Range(0, 3).Sum(i => new FileInfo(_factory.Volume.File(i)).Length), info.FileBytes);
    }

    [OpenSlideFact]
    public async Task Each_slice_serves_its_own_tiles()
    {
        for (var i = 0; i < VolumeFolder.Colours.Length; i++)
        {
            AssertColour(VolumeFolder.Colours[i], await MiddleOfTileAsync($"/slides/stack/slice/{i}/TileGroup0/0-0-0.jpg"));
        }
    }

    [OpenSlideFact]
    public async Task The_route_without_a_slice_serves_the_default_one()
    {
        AssertColour(VolumeFolder.Colours[1], await MiddleOfTileAsync("/slides/stack/TileGroup0/0-0-0.jpg"));
    }

    [OpenSlideFact]
    public async Task Same_tile_on_every_slice_is_the_same_size()
    {
        var sizes = new List<(int, int)>();
        for (var i = 0; i < 3; i++)
        {
            var response = await _factory.CreateClient().GetAsync($"/slides/stack/slice/{i}/TileGroup0/2-2-1.jpg");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var bitmap = SKBitmap.Decode(await response.Content.ReadAsByteArrayAsync());
            sizes.Add((bitmap.Width, bitmap.Height));
        }

        Assert.Single(sizes.Distinct());
    }

    [Theory]
    [InlineData(3)]
    [InlineData(-1)]
    [InlineData(99)]
    public async Task A_slice_that_isnt_there_is_not_found(int slice)
    {
        var response = await _factory.CreateClient().GetAsync($"/slides/stack/slice/{slice}/TileGroup0/0-0-0.jpg");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task A_slice_of_a_slide_that_isnt_there_is_not_found()
    {
        var response = await _factory.CreateClient().GetAsync("/slides/nope/slice/0/TileGroup0/0-0-0.jpg");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [OpenSlideFact]
    public async Task Thumbnail_is_of_the_default_slice()
    {
        var response = await _factory.CreateClient().GetAsync("/slides/stack/thumbnail.jpg?width=64");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var bitmap = SKBitmap.Decode(await response.Content.ReadAsByteArrayAsync());

        AssertColour(VolumeFolder.Colours[1], bitmap.GetPixel(bitmap.Width / 2, bitmap.Height / 2));
    }
}

public class VolumeThumbnailTests : IClassFixture<VolumeApiFactory>
{
    private readonly VolumeApiFactory _factory;

    public VolumeThumbnailTests(VolumeApiFactory factory) => _factory = factory;

    private async Task<SKColor> MiddleAsync(string url)
    {
        var response = await _factory.CreateClient().GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var bitmap = SKBitmap.Decode(await response.Content.ReadAsByteArrayAsync());
        Assert.Equal(64, bitmap.Width);
        return bitmap.GetPixel(bitmap.Width / 2, bitmap.Height / 2);
    }

    [OpenSlideFact]
    public async Task Each_slice_has_its_own_thumbnail()
    {
        for (var i = 0; i < VolumeFolder.Colours.Length; i++)
        {
            var colour = await MiddleAsync($"/slides/stack/thumbnail.jpg?width=64&slice={i}");
            var (r, g, b) = VolumeFolder.Colours[i];
            Assert.InRange(colour.Red, r - 12, r + 12);
            Assert.InRange(colour.Green, g - 12, g + 12);
            Assert.InRange(colour.Blue, b - 12, b + 12);
        }
    }

    [OpenSlideFact]
    public async Task Every_slices_thumbnail_is_the_same_size()
    {
        var sizes = new HashSet<(int, int)>();
        for (var i = 0; i < VolumeFolder.Colours.Length; i++)
        {
            var response = await _factory.CreateClient().GetAsync($"/slides/stack/thumbnail.jpg?width=100&slice={i}");
            using var bitmap = SKBitmap.Decode(await response.Content.ReadAsByteArrayAsync());
            sizes.Add((bitmap.Width, bitmap.Height));
        }

        Assert.Single(sizes);
    }

    [Theory]
    [InlineData(3)]
    [InlineData(-1)]
    public async Task A_slice_that_isnt_there_has_no_thumbnail(int slice)
    {
        var response = await _factory.CreateClient().GetAsync($"/slides/stack/thumbnail.jpg?slice={slice}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}

// Volumes that are set up wrong stop the tiler starting, with a message that says why.
public sealed class VolumeConfigTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("tiler-config-").FullName;

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private sealed class Env(string root) : IWebHostEnvironment
    {
        public string WebRootPath { get; set; } = root;
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "Tiler";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = root;
        public string EnvironmentName { get; set; } = "Testing";
    }

    private SlideCatalog Catalog(params (string Key, string Value)[] settings)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(settings.Select(s => new KeyValuePair<string, string?>(s.Key, s.Value)))
            .Build();
        return new SlideCatalog(new Env(_root), config);
    }

    private string Folder(string name)
    {
        var folder = Path.Combine(_root, name);
        Directory.CreateDirectory(folder);
        return folder;
    }

    [Fact]
    public void A_folder_that_isnt_there_says_so()
    {
        var error = Assert.Throws<InvalidOperationException>(() => Catalog(("Slides:Volumes:stack", "nowhere")));

        Assert.Contains("isn't there", error.Message);
    }

    [Fact]
    public void A_folder_without_registration_json_says_so()
    {
        Folder("empty");

        var error = Assert.Throws<InvalidDataException>(() => Catalog(("Slides:Volumes:stack", "empty")));

        Assert.Contains("registration.json", error.Message);
    }

    [Fact]
    public void A_missing_slice_file_says_which()
    {
        var folder = Folder("missing");
        VolumeFolder.WriteRegistration(Path.Combine(folder, VolumeManifest.FileName), 2, gapBefore: -1, reference: 0);
        TiledTiff.Write(Path.Combine(folder, "Image_00.tif"), 10, 10, (0, 0, 0));

        var error = Assert.Throws<InvalidDataException>(() => Catalog(("Slides:Volumes:stack", "missing")));

        Assert.Contains("Image_01.tif", error.Message);
    }

    [Fact]
    public void Same_id_as_a_flat_slide_is_refused()
    {
        var data = Folder("data");
        File.WriteAllText(Path.Combine(data, "stack.mrxs"), "");

        var error = Assert.Throws<InvalidOperationException>(() => Catalog(("Slides:Volumes:stack", "anything")));

        Assert.Contains("same id", error.Message);
    }

    [OpenSlideFact]
    public void Slices_of_different_sizes_are_refused()
    {
        var folder = Folder("mixed");
        VolumeFolder.WriteRegistration(Path.Combine(folder, VolumeManifest.FileName), 2, gapBefore: -1, reference: 0);
        TiledTiff.Write(Path.Combine(folder, "Image_00.tif"), 300, 200, (0, 0, 0));
        TiledTiff.Write(Path.Combine(folder, "Image_01.tif"), 300, 201, (0, 0, 0));

        var error = Assert.Throws<InvalidOperationException>(() => Catalog(("Slides:Volumes:stack", "mixed")));

        Assert.Contains("same size", error.Message);
    }

    // A volume folder in data/, like register_sections.py --write makes it.
    private string DataVolume(string name, int slices = 2)
    {
        var folder = Folder(Path.Combine("data", name));
        VolumeFolder.WriteRegistration(Path.Combine(folder, VolumeManifest.FileName), slices, gapBefore: -1, reference: 0);
        for (var i = 0; i < slices; i++) TiledTiff.Write(Path.Combine(folder, $"Image_{i:00}.tif"), 300, 200, (10, 20, 30));
        return folder;
    }

    [OpenSlideFact]
    public void A_volume_in_the_data_folder_is_found_by_its_folder_name()
    {
        DataVolume("liver", slices: 3);

        using var catalog = Catalog();

        Assert.Contains("liver", catalog.SlideIds);
        Assert.Equal(3, catalog.GetInfo("liver")!.Slices.Count);
        Assert.Equal("liver", catalog.GetInfo("liver")!.FileName);
        Assert.Empty(catalog.SkippedVolumes);
    }

    [Fact]
    public void A_volume_checked_out_without_lfs_is_left_out_not_fatal()
    {
        var folder = DataVolume("liver");
        // What git puts there in place of the file without LFS.
        File.WriteAllText(Path.Combine(folder, "Image_01.tif"), "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n");

        using var catalog = Catalog();

        Assert.DoesNotContain("liver", catalog.SlideIds);
        Assert.Equal(["liver"], catalog.SkippedVolumes);
    }

    [Fact]
    public void A_folder_without_registration_json_isnt_a_volume()
    {
        // Like a MIRAX slide's own folder - 000/ next to 000.mrxs.
        var folder = Folder(Path.Combine("data", "000"));
        File.WriteAllText(Path.Combine(folder, "Slidedat.ini"), "");

        using var catalog = Catalog();

        Assert.DoesNotContain("000", catalog.SlideIds);
        Assert.Empty(catalog.SkippedVolumes);
    }

    [Fact]
    public void A_volume_folder_named_like_a_flat_slide_is_refused()
    {
        var data = Folder("data");
        File.WriteAllText(Path.Combine(data, "liver.mrxs"), "");
        var volume = Folder(Path.Combine("data", "liver"));
        VolumeFolder.WriteRegistration(Path.Combine(volume, VolumeManifest.FileName), 1, gapBefore: -1, reference: 0);

        var error = Assert.Throws<InvalidOperationException>(() => Catalog());

        Assert.Contains("same id", error.Message);
    }

    [OpenSlideFact]
    public void Config_cant_reuse_a_found_volumes_id()
    {
        DataVolume("liver");
        Folder("elsewhere");

        var error = Assert.Throws<InvalidOperationException>(() => Catalog(("Slides:Volumes:liver", "elsewhere")));

        Assert.Contains("same id", error.Message);
    }

    [Fact]
    public void Lfs_pointers_are_told_apart_from_real_files()
    {
        var pointer = Path.Combine(Folder("p"), "a.tif");
        File.WriteAllText(pointer, "version https://git-lfs.github.com/spec/v1\n");
        var real = Path.Combine(Folder("r"), "b.tif");
        TiledTiff.Write(real, 10, 10, (0, 0, 0));
        var tiny = Path.Combine(Folder("t"), "c.tif");
        File.WriteAllText(tiny, "v");

        Assert.True(SlideCatalog.IsLfsPointer(pointer));
        Assert.False(SlideCatalog.IsLfsPointer(real));
        Assert.False(SlideCatalog.IsLfsPointer(tiny));
    }

    [Fact]
    public void No_volumes_configured_is_fine()
    {
        using var catalog = Catalog();

        Assert.Empty(catalog.SlideIds);
    }
}

public class VolumeManifestTests
{
    private static readonly string Folder = Directory.CreateTempSubdirectory("tiler-manifest-").FullName;

    static VolumeManifestTests()
    {
        foreach (var i in Enumerable.Range(0, 4)) File.WriteAllText(Path.Combine(Folder, $"Image_{i:00}.tif"), "");
    }

    private static VolumeManifest Parse(string json) => VolumeManifest.Parse(JsonDocument.Parse(json).RootElement, Folder);

    [Fact]
    public void Slices_follow_section_order_not_list_order()
    {
        var manifest = Parse("""{"reference": 1, "sections": [{"order": 1, "file": "Image_01.tif"}, {"order": 0, "file": "Image_00.tif"}]}""");

        Assert.Equal(["Image_00.tif", "Image_01.tif"], manifest.Files.Select(Path.GetFileName));
    }

    [Fact]
    public void Sections_numbered_from_one_or_with_one_missing_are_fine()
    {
        // Kartasalo's sets are 001.tif onwards, so order starts at 1. Positions still count from 0.
        var manifest = Parse("""
            {"reference": 1,
             "sections": [{"order": 1, "file": "Image_00.tif"}, {"order": 2, "file": "Image_01.tif"}, {"order": 5, "file": "Image_02.tif"}],
             "links": [{"a": 1, "b": 2, "kind": "gap"}]}
            """);

        Assert.Equal(["Image_00.tif", "Image_01.tif", "Image_02.tif"], manifest.Files.Select(Path.GetFileName));
        Assert.Equal([0, 1, 2], manifest.Slices.Select(s => s.Index));
        Assert.Equal([false, false, true], manifest.Slices.Select(s => s.GapBefore));
        Assert.Equal(1, manifest.DefaultSlice);
    }

    [Fact]
    public void Two_sections_with_one_number_are_refused()
    {
        var error = Assert.Throws<InvalidDataException>(() => Parse("""{"sections": [{"order": 3, "file": "Image_00.tif"}, {"order": 3, "file": "Image_01.tif"}]}"""));

        Assert.Contains("both numbered 3", error.Message);
    }

    [Fact]
    public void A_gap_link_marks_the_slice_after_it()
    {
        var manifest = Parse("""
            {"reference": 0,
             "sections": [{"order": 0, "file": "Image_00.tif"}, {"order": 1, "file": "Image_01.tif"}, {"order": 2, "file": "Image_02.tif"}],
             "links": [{"a": 0, "b": 1, "kind": "features"}, {"a": 1, "b": 2, "kind": "gap"}]}
            """);

        Assert.Equal([false, false, true], manifest.Slices.Select(s => s.GapBefore));
    }

    [Fact]
    public void A_guided_link_is_not_a_gap()
    {
        var manifest = Parse("""
            {"reference": 0,
             "sections": [{"order": 0, "file": "Image_00.tif"}, {"order": 1, "file": "Image_01.tif"}],
             "links": [{"a": 0, "b": 1, "kind": "guided"}]}
            """);

        Assert.Equal([false, false], manifest.Slices.Select(s => s.GapBefore));
    }

    [Fact]
    public void No_reference_means_the_middle()
    {
        var manifest = Parse("""{"sections": [{"order": 0, "file": "Image_00.tif"}, {"order": 1, "file": "Image_01.tif"}, {"order": 2, "file": "Image_02.tif"}]}""");

        Assert.Equal(1, manifest.DefaultSlice);
    }

    [Fact]
    public void Section_thickness_comes_through_when_given()
    {
        var manifest = Parse("""{"sectionMicrons": 5, "sections": [{"order": 0, "file": "Image_00.tif"}]}""");

        Assert.Equal(5, manifest.SectionMicrons);
    }

    [Theory]
    [InlineData("""{"sections": [{"order": 0, "file": "Image_00.tif"}]}""")]
    [InlineData("""{"sectionMicrons": null, "sections": [{"order": 0, "file": "Image_00.tif"}]}""")]
    [InlineData("""{"sectionMicrons": 0, "sections": [{"order": 0, "file": "Image_00.tif"}]}""")]
    [InlineData("""{"sectionMicrons": -4, "sections": [{"order": 0, "file": "Image_00.tif"}]}""")]
    public void No_or_impossible_thickness_is_null(string json)
    {
        Assert.Null(Parse(json).SectionMicrons);
    }

    [Theory]
    [InlineData("""{"sections": []}""", "no sections")]
    [InlineData("""{}""", "no sections")]
    [InlineData("""{"sections": [{"order": 0, "file": "Image_00.tif"}, {"order": 0, "file": "Image_02.tif"}]}""", "both numbered 0")]
    [InlineData("""{"sections": [{"order": 0, "file": "../Image_00.tif"}]}""", "plain file name")]
    [InlineData("""{"sections": [{"order": 0, "file": ""}]}""", "plain file name")]
    [InlineData("""{"reference": 5, "sections": [{"order": 0, "file": "Image_00.tif"}]}""", "reference 5")]
    public void Bad_manifests_say_what_is_wrong(string json, string message)
    {
        var error = Assert.Throws<InvalidDataException>(() => Parse(json));

        Assert.Contains(message, error.Message);
    }
}
