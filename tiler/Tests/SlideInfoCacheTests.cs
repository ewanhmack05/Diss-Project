using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Tiler.Slides;

namespace Tiler.Tests;

// Slide info kept on disk between starts. Without it the first GET /slides
// after a start opened every slide - 40-50s for the 200 TCIA slides - and the
// gallery sat on "Loading slides..." until it answered.
public sealed class SlideInfoCacheTests : IDisposable
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly string _root = Directory.CreateTempSubdirectory("tiler-info-cache-").FullName;

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private string CachePath => Path.Combine(_root, "info.json");

    private static SlideInfo Info(string id, long width = 1000) => new(
        id, id + ".mrxs", width, 2000, 256, 40, 0.25, 0.25, id, "brightfield", [], 5, null, null, "#ffffff", 1234,
        [new Slice(0, false)], 0, null);

    private string File(string name, string text)
    {
        var path = Path.Combine(_root, name);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        System.IO.File.WriteAllText(path, text);
        return path;
    }

    [Fact]
    public void What_was_put_is_there_after_a_restart()
    {
        new SlideInfoCache(CachePath).Put("a", "stamp", Info("a", width: 777));

        var again = new SlideInfoCache(CachePath);

        Assert.Equal(777, again.Get("a", "stamp")!.Width);
        Assert.Equal(1, again.Count);
    }

    [Fact]
    public void A_different_stamp_is_a_miss()
    {
        var cache = new SlideInfoCache(CachePath);
        cache.Put("a", "before", Info("a"));

        Assert.Null(cache.Get("a", "after"));
        Assert.Null(cache.Get("b", "before"));
    }

    [Fact]
    public void A_broken_file_means_starting_empty()
    {
        System.IO.File.WriteAllText(CachePath, "{ not json");

        var cache = new SlideInfoCache(CachePath);

        Assert.Equal(0, cache.Count);
    }

    [Fact]
    public void A_file_from_another_version_isnt_used()
    {
        new SlideInfoCache(CachePath).Put("a", "stamp", Info("a"));
        System.IO.File.WriteAllText(CachePath, System.IO.File.ReadAllText(CachePath).Replace($"\"version\":{SlideInfoCache.Version}", "\"version\":0"));

        Assert.Null(new SlideInfoCache(CachePath).Get("a", "stamp"));
    }

    [Fact]
    public void No_path_keeps_it_in_memory_only()
    {
        var cache = new SlideInfoCache(null);
        cache.Put("a", "stamp", Info("a"));

        Assert.NotNull(cache.Get("a", "stamp"));
        Assert.Empty(Directory.GetFiles(_root));
    }

    [Fact]
    public void Not_being_able_to_write_it_isnt_an_error()
    {
        var cache = new SlideInfoCache(Path.Combine(_root, "not-there", "info.json"));

        cache.Put("a", "stamp", Info("a"));
        cache.Put("b", "stamp", Info("b"));

        Assert.NotNull(cache.Get("b", "stamp"));
    }

    [Fact]
    public void The_stamp_changes_with_a_files_size_or_write_time_not_their_order()
    {
        var a = File("a.dat", "aaaa");
        var b = File("b.dat", "bb");
        var stamp = SlideInfoCache.Stamp([a, b]);

        Assert.Equal(stamp, SlideInfoCache.Stamp([b, a]));

        System.IO.File.SetLastWriteTimeUtc(b, System.IO.File.GetLastWriteTimeUtc(b).AddMinutes(1));
        var touched = SlideInfoCache.Stamp([a, b]);
        Assert.NotEqual(stamp, touched);

        System.IO.File.AppendAllText(a, "a");
        Assert.NotEqual(touched, SlideInfoCache.Stamp([a, b]));
    }

    [Fact]
    public void A_missing_file_stamps_rather_than_throws()
    {
        var a = File("a.dat", "aaaa");
        var stamp = SlideInfoCache.Stamp([a, Path.Combine(_root, "gone.dat")]);

        Assert.NotEqual(SlideInfoCache.Stamp([a]), stamp);
    }

    // The catalog side, with a made-up MIRAX slide OpenSlide couldn't open.

    private sealed class Env(string root) : IWebHostEnvironment
    {
        public string WebRootPath { get; set; } = root;
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string ApplicationName { get; set; } = "Tiler";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string ContentRootPath { get; set; } = root;
        public string EnvironmentName { get; set; } = "Testing";
    }

    private SlideCatalog Catalog(string root, params (string Key, string Value)[] settings)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(settings.Select(s => new KeyValuePair<string, string?>(s.Key, s.Value)))
            .Build();
        return new SlideCatalog(new Env(root), config);
    }

    // Not a picture, and not an LFS pointer either, so the catalog lists it.
    private string FakeSlide(string id)
    {
        var mrxs = File(Path.Combine("data", id + ".mrxs"), "[GENERAL]\nSLIDE_VERSION = 1.9\n");
        File(Path.Combine("data", id, "Slidedat.ini"), "[GENERAL]\n");
        File(Path.Combine("data", id, "Index.dat"), "not really an index");
        return mrxs;
    }

    private void Keep(string mrxs, SlideInfo info) =>
        new SlideInfoCache(Path.Combine(_root, "data", SlideInfoCache.DefaultFileName))
            .Put(Path.GetFullPath(mrxs), SlideInfoCache.Stamp(SlideCatalog.MiraxFiles(mrxs)), info);

    [Fact]
    public void Kept_info_lists_a_slide_without_opening_it()
    {
        var mrxs = FakeSlide("x");
        Keep(mrxs, Info("x", width: 4321));

        using var catalog = Catalog(_root);

        // Opening it would throw - the files are text.
        Assert.Equal(4321, catalog.GetInfo("x")!.Width);
        Assert.Equal(1, catalog.InfoHits);
        Assert.Equal(0, catalog.InfoReads);
    }

    [OpenSlideFact]
    public void A_slide_whose_files_changed_is_opened_again()
    {
        var mrxs = FakeSlide("x");
        Keep(mrxs, Info("x"));
        System.IO.File.AppendAllText(Path.Combine(_root, "data", "x", "Index.dat"), "more");

        using var catalog = Catalog(_root);

        // It tried to open the text files rather than use what was kept.
        Assert.ThrowsAny<Exception>(() => catalog.GetInfo("x"));
        Assert.Equal(0, catalog.InfoHits);
    }

    [Fact]
    public void Info_kept_for_a_different_id_isnt_used()
    {
        var mrxs = FakeSlide("x");
        Keep(mrxs, Info("someone-else"));

        using var catalog = Catalog(_root);

        Assert.ThrowsAny<Exception>(() => catalog.GetInfo("x"));
        Assert.Equal(0, catalog.InfoHits);
    }

    [Fact]
    public void It_lives_in_the_data_folder_unless_config_says()
    {
        Directory.CreateDirectory(Path.Combine(_root, "data"));

        using var byDefault = Catalog(_root);
        using var elsewhere = Catalog(_root, ("Slides:InfoCachePath", "kept/info.json"));
        using var off = Catalog(_root, ("Slides:InfoCachePath", ""));

        Assert.Equal(Path.Combine(_root, "data", SlideInfoCache.DefaultFileName), byDefault.InfoCache.Path);
        Assert.Equal(Path.GetFullPath(Path.Combine(_root, "kept", "info.json")), elsewhere.InfoCache.Path);
        Assert.Null(off.InfoCache.Path);
    }

    // The real sample slides in tiler/data.

    private static string TilerData()
    {
        var tiler = new DirectoryInfo(AppContext.BaseDirectory);
        while (!System.IO.File.Exists(Path.Combine(tiler!.FullName, "Tiler.csproj"))) tiler = tiler.Parent;
        return Path.Combine(tiler.FullName, "data");
    }

    private SlideCatalog SampleCatalog() =>
        Catalog(_root, ("Slides:DataPath", TilerData()), ("Slides:InfoCachePath", CachePath));

    [SlideFact]
    public void The_next_start_lists_the_samples_without_opening_them()
    {
        Dictionary<string, string> first;
        using (var catalog = SampleCatalog())
        {
            first = SampleSlides.Ids.ToDictionary(id => id, id => JsonSerializer.Serialize(catalog.GetInfo(id), Json));
            Assert.Equal(SampleSlides.Ids.Length, catalog.InfoReads);
        }

        using var next = SampleCatalog();
        var again = SampleSlides.Ids.ToDictionary(id => id, id => JsonSerializer.Serialize(next.GetInfo(id), Json));

        Assert.Equal(first, again);
        Assert.Equal(SampleSlides.Ids.Length, next.InfoHits);
        Assert.Equal(0, next.InfoReads);
    }

    [SlideFact]
    public void A_slide_asked_for_at_once_from_many_threads_is_read_once()
    {
        using var catalog = Catalog(_root, ("Slides:DataPath", TilerData()), ("Slides:InfoCachePath", ""));

        Parallel.For(0, 16, _ => Assert.NotNull(catalog.GetInfo("000")));

        Assert.Equal(1, catalog.InfoReads);
    }
}

// The warm-up reads every slide's info once the app's started.
public sealed class SlideInfoWarmupTests
{
    private sealed class WarmFactory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("OTEL_SDK_DISABLED", "true");
            builder.UseSetting("Slides:InfoCachePath", "");
            builder.UseSetting("Slides:WarmOnStart", "true");
        }
    }

    [SlideFact]
    public async Task Every_slide_is_read_without_anyone_asking()
    {
        await using var factory = new WarmFactory();
        _ = factory.Server;
        var catalog = factory.Services.GetRequiredService<SlideCatalog>();

        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (catalog.InfoReads < catalog.SlideIds.Count && DateTime.UtcNow < deadline) await Task.Delay(100);

        Assert.Equal(catalog.SlideIds.Count, catalog.InfoReads);
    }
}
