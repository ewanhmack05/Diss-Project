namespace AnnotationStore.Tests;

// Every test class that uses the factory gets a Postgres database of its own,
// run in parallel, so between them they have to fit in a stock Postgres's
// connections - 100, less 3 kept for superusers, less a few for making and
// dropping the databases. Fails as soon as a new test class would push them
// over, rather than CI failing now and then with "too many clients".
public class PostgresPoolTests
{
    private const int StockPostgresConnections = 100 - 3;
    private const int Spare = 5;

    [Fact]
    public void EveryTestClassesPool_FitsInAStockPostgres()
    {
        var classes = typeof(PostgresPoolTests).Assembly.GetTypes()
            .Count(t => t.GetInterfaces().Contains(typeof(IClassFixture<CellCountApiFactory>)));

        Assert.True(classes > 0);
        Assert.True(classes * CellCountApiFactory.PoolSizePerDatabase <= StockPostgresConnections - Spare,
            $"{classes} test classes at {CellCountApiFactory.PoolSizePerDatabase} connections each is more than a stock Postgres takes - lower PoolSizePerDatabase");
    }
}
