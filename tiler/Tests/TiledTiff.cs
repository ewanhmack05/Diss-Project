namespace Tiler.Tests;

/// <summary>
/// Writes a small tiled RGB TIFF of one colour that OpenSlide opens as a
/// generic TIFF - so volume tests can make their slices instead of keeping
/// image files in the repo. Uncompressed, one level, 256 px tiles, with a
/// resolution in pixels per centimetre so OpenSlide reports a pixel size.
/// </summary>
public static class TiledTiff
{
    private const int Tile = 256;

    public static void Write(string path, int width, int height, (byte R, byte G, byte B) colour, double micronsPerPixel = 0.25)
    {
        var across = (width + Tile - 1) / Tile;
        var down = (height + Tile - 1) / Tile;
        var tileCount = across * down;
        var tileBytes = Tile * Tile * 3;

        var tile = new byte[tileBytes];
        for (var i = 0; i < tileBytes; i += 3) (tile[i], tile[i + 1], tile[i + 2]) = (colour.R, colour.G, colour.B);

        // Header, then the IFD, then what it points at, then the tiles.
        const int entries = 14;
        const int ifdStart = 8;
        var afterIfd = ifdStart + 2 + entries * 12 + 4;
        var bitsAt = afterIfd;
        var xResAt = bitsAt + 6;
        var yResAt = xResAt + 8;
        var offsetsAt = yResAt + 8;
        var countsAt = offsetsAt + 4 * tileCount;
        var tilesAt = countsAt + 4 * tileCount;

        using var stream = File.Create(path);
        using var w = new BinaryWriter(stream);
        w.Write((byte)'I');
        w.Write((byte)'I');
        w.Write((ushort)42);
        w.Write((uint)ifdStart);

        w.Write((ushort)entries);
        void Entry(ushort tag, ushort type, uint count, uint value)
        {
            w.Write(tag);
            w.Write(type);
            w.Write(count);
            w.Write(value);
        }
        const ushort Short = 3, Long = 4, Rational = 5;
        var pixelsPerCm = (uint)Math.Round(10000 / micronsPerPixel);
        Entry(256, Long, 1, (uint)width);
        Entry(257, Long, 1, (uint)height);
        Entry(258, Short, 3, (uint)bitsAt);           // 8 bits each for R, G, B
        Entry(259, Short, 1, 1);                       // no compression
        Entry(262, Short, 1, 2);                       // RGB
        Entry(277, Short, 1, 3);                       // samples per pixel
        Entry(282, Rational, 1, (uint)xResAt);
        Entry(283, Rational, 1, (uint)yResAt);
        Entry(284, Short, 1, 1);                       // chunky
        Entry(296, Short, 1, 3);                       // centimetres
        Entry(322, Long, 1, Tile);
        Entry(323, Long, 1, Tile);
        Entry(324, Long, (uint)tileCount, tileCount == 1 ? (uint)tilesAt : (uint)offsetsAt);
        Entry(325, Long, (uint)tileCount, tileCount == 1 ? (uint)tileBytes : (uint)countsAt);
        w.Write((uint)0); // no next IFD

        w.Write((ushort)8);
        w.Write((ushort)8);
        w.Write((ushort)8);
        w.Write(pixelsPerCm);
        w.Write((uint)1);
        w.Write(pixelsPerCm);
        w.Write((uint)1);
        for (var i = 0; i < tileCount; i++) w.Write((uint)(tilesAt + i * tileBytes));
        for (var i = 0; i < tileCount; i++) w.Write((uint)tileBytes);
        for (var i = 0; i < tileCount; i++) w.Write(tile);
    }
}
