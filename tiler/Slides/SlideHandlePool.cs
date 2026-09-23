using System.Collections.Concurrent;
using OpenSlideSharp;

namespace Tiler.Slides;

/// <summary>
/// A few OpenSlide handles for one slide, each used by one thread at a time.
/// A single handle crashes (native access violation) when read from several
/// threads at once, and locking it makes every tile in a pan wait in line -
/// separate handles give parallel reads without sharing one.
/// </summary>
public sealed class SlideHandlePool : IDisposable
{
    private static readonly object OpenLock = new();

    private readonly string _path;
    private readonly SemaphoreSlim _slots;
    private readonly ConcurrentBag<OpenSlideImage> _idle = new();
    private readonly ConcurrentBag<OpenSlideImage> _all = new();

    public SlideHandlePool(string path, int size)
    {
        _path = path;
        _slots = new SemaphoreSlim(size, size);
    }

    /// <summary>Runs read on a handle nobody else is using, opening a new one if all are busy (up to the pool size).</summary>
    public T Use<T>(Func<OpenSlideImage, T> read)
    {
        _slots.Wait();
        if (!_idle.TryTake(out var handle))
        {
            // Opening isn't safe to do on several threads at once, only reading.
            lock (OpenLock)
            {
                handle = OpenSlideImage.Open(_path);
            }
            _all.Add(handle);
        }

        try
        {
            return read(handle);
        }
        finally
        {
            _idle.Add(handle);
            _slots.Release();
        }
    }

    public void Dispose()
    {
        foreach (var handle in _all)
        {
            handle.Dispose();
        }
        _slots.Dispose();
    }
}
