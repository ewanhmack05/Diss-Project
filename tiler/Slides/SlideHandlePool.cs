using OpenSlideSharp;

namespace Tiler.Slides;

/// <summary>
/// How many OpenSlide handles the whole tiler keeps open, across every slide
/// and slice. Each handle holds its own tile cache in native memory - about
/// 32 MB once it's warm under OpenSlide 3.4 - and pools never used to close
/// theirs, so memory only went up: 0.8 GB after a few hundred tiles across
/// the liver volume and slide 003, about 3 GB after a real session. With a
/// budget, opening one more past the limit first closes the handle that's
/// been idle longest, wherever it is, and handles idle for long enough are
/// closed on their own (see TrimIdle).
/// </summary>
public sealed class HandleBudget
{
    // Everything below is only touched under this lock. The native work -
    // opening, reading, closing - never happens inside it.
    internal readonly object Gate = new();
    private readonly LinkedList<IdleHandle> _leastRecent = new();
    private readonly Func<long> _now;
    private int _open;

    public HandleBudget(int maxOpen, Func<long>? nowMilliseconds = null)
    {
        if (maxOpen < 1) throw new ArgumentOutOfRangeException(nameof(maxOpen), "needs at least one handle");
        MaxOpen = maxOpen;
        _now = nowMilliseconds ?? (() => Environment.TickCount64);
    }

    public int MaxOpen { get; }

    /// <summary>Handles open right now, idle or busy.</summary>
    public int Open
    {
        get
        {
            lock (Gate) return _open;
        }
    }

    /// <summary>Handles open and not being used.</summary>
    public int Idle
    {
        get
        {
            lock (Gate) return _leastRecent.Count;
        }
    }

    /// <summary>
    /// Room for one more handle. Under the limit that's just a count; at it,
    /// the handle idle longest is taken from its pool and closed, and its room
    /// is this one's. With every handle busy, waits for one to come back.
    /// </summary>
    internal void Reserve()
    {
        IDisposable? toClose = null;
        lock (Gate)
        {
            while (true)
            {
                if (_open < MaxOpen)
                {
                    _open++;
                    break;
                }
                if (_leastRecent.First?.Value is { } oldest)
                {
                    _leastRecent.RemoveFirst();
                    oldest.Owner.Remove(oldest);
                    toClose = oldest.Handle;
                    break;
                }
                Monitor.Wait(Gate);
            }
        }
        toClose?.Dispose();
    }

    /// <summary>A reserved handle that couldn't be opened, or one that's been closed - its room is free.</summary>
    internal void Release()
    {
        lock (Gate)
        {
            _open--;
            Monitor.PulseAll(Gate);
        }
    }

    /// <summary>A handle its pool has finished with. Call under Gate.</summary>
    internal IdleHandle MarkIdle(IHandleOwner owner, IDisposable handle)
    {
        var idle = new IdleHandle(owner, handle, _now());
        idle.Node = _leastRecent.AddLast(idle);
        Monitor.PulseAll(Gate);
        return idle;
    }

    /// <summary>A pool taking back one of its idle handles. Call under Gate.</summary>
    internal void Unmark(IdleHandle idle) => _leastRecent.Remove(idle.Node!);

    /// <summary>Closes every handle that's been idle at least idleFor. Returns how many.</summary>
    public int TrimIdle(TimeSpan idleFor)
    {
        var closing = new List<IDisposable>();
        lock (Gate)
        {
            var cutoff = _now() - (long)idleFor.TotalMilliseconds;
            while (_leastRecent.First?.Value is { } oldest && oldest.Since <= cutoff)
            {
                _leastRecent.RemoveFirst();
                oldest.Owner.Remove(oldest);
                closing.Add(oldest.Handle);
                _open--;
            }
            if (closing.Count > 0) Monitor.PulseAll(Gate);
        }
        foreach (var handle in closing) handle.Dispose();
        return closing.Count;
    }

    /// <summary>A pool going away: its idle handles are closed and their room freed. Call under Gate.</summary>
    internal List<IDisposable> Forget(IEnumerable<IdleHandle> idle)
    {
        var closing = new List<IDisposable>();
        foreach (var handle in idle)
        {
            _leastRecent.Remove(handle.Node!);
            closing.Add(handle.Handle);
            _open--;
        }
        Monitor.PulseAll(Gate);
        return closing;
    }
}

internal interface IHandleOwner
{
    // Called by the budget, under its Gate, when it closes one of this pool's idle handles.
    void Remove(IdleHandle idle);
}

internal sealed class IdleHandle(IHandleOwner owner, IDisposable handle, long since)
{
    public IHandleOwner Owner { get; } = owner;
    public IDisposable Handle { get; } = handle;
    public long Since { get; } = since;
    public LinkedListNode<IdleHandle>? Node { get; set; }
}

/// <summary>
/// A few handles for one thing - one slice of one slide in the tiler - each
/// used by one thread at a time, under a budget shared with every other pool.
/// </summary>
public class HandlePool<T> : IHandleOwner, IDisposable where T : class, IDisposable
{
    private readonly Func<T> _open;
    private readonly SemaphoreSlim _slots;
    private readonly HandleBudget _budget;
    // This pool's idle handles, most recent last. Only touched under the budget's Gate.
    private readonly LinkedList<IdleHandle> _idle = new();

    public HandlePool(Func<T> open, int size, HandleBudget budget)
    {
        _open = open;
        _slots = new SemaphoreSlim(size, size);
        _budget = budget;
    }

    /// <summary>Handles this pool has idle right now.</summary>
    public int IdleCount
    {
        get
        {
            lock (_budget.Gate) return _idle.Count;
        }
    }

    /// <summary>
    /// Runs read on a handle nobody else is using: one of this pool's idle ones
    /// if it has one, otherwise a new one, room for which comes from the budget.
    /// </summary>
    public TResult Use<TResult>(Func<T, TResult> read)
    {
        _slots.Wait();
        try
        {
            T? handle = null;
            lock (_budget.Gate)
            {
                if (_idle.Last?.Value is { } recent)
                {
                    _idle.RemoveLast();
                    _budget.Unmark(recent);
                    handle = (T)recent.Handle;
                }
            }
            if (handle is null)
            {
                _budget.Reserve();
                try
                {
                    handle = _open();
                }
                catch
                {
                    _budget.Release();
                    throw;
                }
            }

            try
            {
                return read(handle);
            }
            finally
            {
                lock (_budget.Gate)
                {
                    _idle.AddLast(_budget.MarkIdle(this, handle));
                }
            }
        }
        finally
        {
            _slots.Release();
        }
    }

    void IHandleOwner.Remove(IdleHandle idle) => _idle.Remove(idle);

    public void Dispose()
    {
        List<IDisposable> closing;
        lock (_budget.Gate)
        {
            closing = _budget.Forget(_idle);
            _idle.Clear();
        }
        foreach (var handle in closing) handle.Dispose();
        _slots.Dispose();
        GC.SuppressFinalize(this);
    }
}

/// <summary>
/// OpenSlide handles for one slide. A single handle crashes (native access
/// violation) when read from several threads at once, and locking it makes
/// every tile in a pan wait in line - separate handles give parallel reads
/// without sharing one.
/// </summary>
public sealed class SlideHandlePool : HandlePool<OpenSlideImage>
{
    private static readonly object OpenLock = new();

    public SlideHandlePool(string path, int size, HandleBudget budget) : base(() => Open(path), size, budget)
    {
    }

    /// <summary>
    /// Opens a slide. Opening isn't safe to do on several threads at once, only
    /// reading, so every open in the tiler goes through here - a pool's, or a
    /// one-off like checking a volume's slice sizes.
    /// </summary>
    public static OpenSlideImage Open(string path)
    {
        lock (OpenLock)
        {
            return OpenSlideApi.Open(path);
        }
    }
}
