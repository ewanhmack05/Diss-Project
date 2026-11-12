using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Tiler.Tests;

// The real app in memory, reading the real slides in tiler/data - its
// content root is the tiler folder, the same as dotnet run.
public class TilerApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        // No collector here, and the exporter waits about 10s for one on shutdown.
        builder.UseSetting("OTEL_SDK_DISABLED", "true");
    }
}

// The sample slides are in Git LFS and CI checks out without it, leaving
// small text pointers where the files should be. These skip then.
public static class SampleSlides
{
    public static readonly string[] Ids = ["000", "001", "002", "003"];

    private const string LfsPointerStart = "version https://git-lfs";

    public static readonly string? Missing = FindMissing();

    private static string? FindMissing()
    {
        var tiler = new DirectoryInfo(AppContext.BaseDirectory);
        while (tiler is not null && !File.Exists(Path.Combine(tiler.FullName, "Tiler.csproj"))) tiler = tiler.Parent;
        if (tiler is null) return "Can't find the tiler folder from the test output";

        foreach (var id in Ids)
        {
            string[] needed =
            [
                Path.Combine(tiler.FullName, "data", id + ".mrxs"),
                Path.Combine(tiler.FullName, "data", id, "Slidedat.ini"),
            ];
            foreach (var path in needed)
            {
                if (!IsRealFile(path)) return $"Needs the sample slides (git lfs pull) - {Path.GetRelativePath(tiler.FullName, path)} isn't there";
            }
        }
        return null;
    }

    private static bool IsRealFile(string path)
    {
        if (!File.Exists(path)) return false;
        using var stream = File.OpenRead(path);
        var start = new byte[LfsPointerStart.Length];
        var read = stream.Read(start, 0, start.Length);
        return System.Text.Encoding.ASCII.GetString(start, 0, read) != LfsPointerStart;
    }
}

public sealed class SlideFactAttribute : FactAttribute
{
    public SlideFactAttribute()
    {
        if (SampleSlides.Missing is not null) Skip = SampleSlides.Missing;
    }
}

public sealed class SlideTheoryAttribute : TheoryAttribute
{
    public SlideTheoryAttribute()
    {
        if (SampleSlides.Missing is not null) Skip = SampleSlides.Missing;
    }
}
