using Tiler.Slides;

namespace Tiler.Tests;

// The handle budget with stand-in handles, so no slide or OpenSlide is needed.
public class HandleBudgetTests
{
    // Counts what's open, and catches two threads in one handle at once.
    private sealed class Tracker
    {
        private int _alive;
        private int _peak;
        public int Opened;
        public int Closed;

        public int Alive => Volatile.Read(ref _alive);
        public int Peak => Volatile.Read(ref _peak);

        public FakeHandle Open()
        {
            Interlocked.Increment(ref Opened);
            var alive = Interlocked.Increment(ref _alive);
            int peak;
            while (alive > (peak = Volatile.Read(ref _peak)) && Interlocked.CompareExchange(ref _peak, alive, peak) != peak)
            {
            }
            return new FakeHandle(this);
        }

        public void Close()
        {
            Interlocked.Increment(ref Closed);
            Interlocked.Decrement(ref _alive);
        }
    }

    private sealed class FakeHandle(Tracker tracker) : IDisposable
    {
        private int _users;
        public bool Disposed { get; private set; }

        public int Read()
        {
            if (Disposed) throw new ObjectDisposedException("handle");
            if (Interlocked.Increment(ref _users) != 1) throw new InvalidOperationException("two threads in one handle");
            Thread.SpinWait(200);
            Interlocked.Decrement(ref _users);
            return 1;
        }

        public void Dispose()
        {
            if (Disposed) throw new InvalidOperationException("closed twice");
            Disposed = true;
            tracker.Close();
        }
    }

    private static HandlePool<FakeHandle> Pool(Tracker tracker, HandleBudget budget, int size = 8) => new(tracker.Open, size, budget);

    [Fact]
    public void A_pool_reuses_its_own_idle_handle()
    {
        var tracker = new Tracker();
        var budget = new HandleBudget(4);
        var pool = Pool(tracker, budget);

        for (var i = 0; i < 10; i++) pool.Use(handle => handle.Read());

        Assert.Equal(1, tracker.Opened);
        Assert.Equal(1, budget.Open);
        Assert.Equal(1, budget.Idle);
    }

    [Fact]
    public void Past_the_limit_the_longest_idle_handle_anywhere_is_closed()
    {
        var tracker = new Tracker();
        var budget = new HandleBudget(2);
        var first = Pool(tracker, budget);
        var second = Pool(tracker, budget);
        var third = Pool(tracker, budget);

        first.Use(handle => handle.Read());
        second.Use(handle => handle.Read());
        third.Use(handle => handle.Read());

        Assert.Equal(3, tracker.Opened);
        Assert.Equal(1, tracker.Closed);
        Assert.Equal(2, budget.Open);
        // first's was idle longest, so it went.
        Assert.Equal(0, first.IdleCount);
        Assert.Equal(1, second.IdleCount);
        Assert.Equal(1, third.IdleCount);
    }

    [Fact]
    public async Task With_every_handle_busy_a_new_one_waits_rather_than_going_over()
    {
        var tracker = new Tracker();
        var budget = new HandleBudget(1);
        var first = Pool(tracker, budget);
        var second = Pool(tracker, budget);
        using var holding = new ManualResetEventSlim();
        using var release = new ManualResetEventSlim();

        var holder = Task.Run(() => first.Use(handle =>
        {
            holding.Set();
            release.Wait();
            return handle.Read();
        }));
        holding.Wait();
        var waiter = Task.Run(() => second.Use(handle => handle.Read()));

        Assert.NotSame(waiter, await Task.WhenAny(waiter, Task.Delay(200)));
        Assert.Equal(1, tracker.Alive);
        release.Set();
        var both = Task.WhenAll(holder, waiter);
        Assert.Same(both, await Task.WhenAny(both, Task.Delay(5000)));
        Assert.Equal(1, tracker.Peak);
    }

    [Fact]
    public void Handles_idle_long_enough_are_closed_and_their_room_freed()
    {
        var tracker = new Tracker();
        long now = 0;
        var budget = new HandleBudget(4, () => now);
        var old = Pool(tracker, budget);
        var recent = Pool(tracker, budget);

        old.Use(handle => handle.Read());
        now = 4 * 60_000;
        recent.Use(handle => handle.Read());
        now = 5 * 60_000;

        Assert.Equal(1, budget.TrimIdle(TimeSpan.FromMinutes(5)));
        Assert.Equal(1, budget.Open);
        Assert.Equal(0, old.IdleCount);
        Assert.Equal(1, recent.IdleCount);
        Assert.Equal(0, budget.TrimIdle(TimeSpan.FromMinutes(5)));
    }

    [Fact]
    public void A_pool_going_away_closes_its_idle_handles()
    {
        var tracker = new Tracker();
        var budget = new HandleBudget(4);
        var pool = Pool(tracker, budget);
        pool.Use(handle => handle.Read());

        pool.Dispose();

        Assert.Equal(0, budget.Open);
        Assert.Equal(0, tracker.Alive);
    }

    [Fact]
    public void A_handle_that_fails_to_open_gives_its_room_back()
    {
        var budget = new HandleBudget(1);
        var broken = new HandlePool<FakeHandle>(() => throw new InvalidDataException("not a slide"), 8, budget);

        Assert.Throws<InvalidDataException>(() => broken.Use(handle => handle.Read()));
        Assert.Equal(0, budget.Open);
    }

    [Fact]
    public void Many_pools_and_threads_never_go_over_or_share_a_handle()
    {
        var tracker = new Tracker();
        var budget = new HandleBudget(4);
        var pools = Enumerable.Range(0, 8).Select(_ => Pool(tracker, budget, size: 3)).ToArray();

        Parallel.For(0, 4000, new ParallelOptions { MaxDegreeOfParallelism = 16 }, i =>
        {
            Assert.Equal(1, pools[(i * 7) % pools.Length].Use(handle => handle.Read()));
        });

        Assert.True(tracker.Peak <= 4, $"peak {tracker.Peak} open, budget 4");
        Assert.Equal(budget.Open, tracker.Alive);
        foreach (var pool in pools) pool.Dispose();
        Assert.Equal(0, tracker.Alive);
        Assert.Equal(tracker.Opened, tracker.Closed);
    }

    [Fact]
    public void A_budget_needs_room_for_one()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new HandleBudget(0));
    }
}
