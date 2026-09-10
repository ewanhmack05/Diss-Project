using SkiaSharp;
using Tiler.Slides;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<SlideCatalog>();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins("http://localhost:5173").AllowAnyMethod().AllowAnyHeader());
});

var app = builder.Build();
app.UseCors();

app.MapGet("/slides", (SlideCatalog catalog) =>
{
    var slides = catalog.SlideIds
        .Select(catalog.GetInfo)
        .Where(info => info is not null);
    return Results.Ok(slides);
});

app.MapGet("/slides/{id}", (string id, SlideCatalog catalog) =>
{
    var info = catalog.GetInfo(id);
    return info is null ? Results.NotFound() : Results.Ok(info);
});

app.MapGet("/slides/{id}/TileGroup{group:int}/{z:int}-{x:int}-{y:int}.jpg", async (string id, int z, int x, int y, SlideCatalog catalog) =>
{
    var slide = catalog.Get(id);
    var info = catalog.GetInfo(id);
    if (slide is null || info is null) return Results.NotFound();

    var request = ZoomifyTiling.Resolve(slide, info.Width, info.Height, z, x, y);
    if (request is null) return Results.NotFound();

    // OpenSlide returns pre-multiplied BGRA; Skia's Bgra8888/Premul matches that layout exactly.
    var raw = slide.ReadRegion(request.SlideLevel, request.X0, request.Y0, request.ReadWidth, request.ReadHeight);
    var sourceInfo = new SKImageInfo((int)request.ReadWidth, (int)request.ReadHeight, SKColorType.Bgra8888, SKAlphaType.Premul);
    using var sourceBitmap = new SKBitmap(sourceInfo);
    System.Runtime.InteropServices.Marshal.Copy(raw, 0, sourceBitmap.GetPixels(), raw.Length);

    var needsResize = sourceBitmap.Width != request.TargetWidth || sourceBitmap.Height != request.TargetHeight;
    using var resizedBitmap = needsResize
        ? sourceBitmap.Resize(
            new SKImageInfo(request.TargetWidth, request.TargetHeight, SKColorType.Bgra8888, SKAlphaType.Premul),
            new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.None))
        : null;
    var tileBitmap = resizedBitmap ?? sourceBitmap;

    using var image = SKImage.FromBitmap(tileBitmap);
    using var data = image.Encode(SKEncodedImageFormat.Jpeg, 85);
    return Results.Bytes(data.ToArray(), "image/jpeg");
});

app.Run();
