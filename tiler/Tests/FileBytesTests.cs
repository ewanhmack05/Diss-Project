using Tiler.Slides;

namespace Tiler.Tests;

// A made-up slide on disk: an .mrxs file and its same-named folder.
public sealed class FileBytesTests : IDisposable
{
    private readonly string _folder = Directory.CreateTempSubdirectory("tiler-tests-").FullName;

    public void Dispose() => Directory.Delete(_folder, recursive: true);

    private string Write(string relativePath, int bytes)
    {
        var path = Path.Combine(_folder, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, new byte[bytes]);
        return path;
    }

    [Fact]
    public void FileBytes_adds_the_mrxs_to_everything_in_its_folder()
    {
        var mrxs = Write("slide.mrxs", 100);
        Write(Path.Combine("slide", "Slidedat.ini"), 20);
        Write(Path.Combine("slide", "Data0000.dat"), 3000);
        Write(Path.Combine("slide", "nested", "Data0001.dat"), 40000);

        Assert.Equal(43120, SlideCatalog.FileBytes(mrxs));
    }

    [Fact]
    public void FileBytes_leaves_out_other_slides()
    {
        var mrxs = Write("slide.mrxs", 100);
        Write(Path.Combine("slide", "Data0000.dat"), 50);
        Write("slide2.mrxs", 7000);
        Write(Path.Combine("slide2", "Data0000.dat"), 9000);

        Assert.Equal(150, SlideCatalog.FileBytes(mrxs));
    }

    [Fact]
    public void FileBytes_is_just_the_mrxs_when_the_folder_is_missing()
    {
        var mrxs = Write("alone.mrxs", 77);

        Assert.Equal(77, SlideCatalog.FileBytes(mrxs));
    }
}
