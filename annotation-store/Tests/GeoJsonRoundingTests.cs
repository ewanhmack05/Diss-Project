using AnnotationStore.Annotations;

namespace AnnotationStore.Tests;

// Saving and the backfill are in AnnotationsTests - a test class of its own
// would be another Postgres pool (see PostgresPoolTests).
public class GeoJsonRoundingTests
{
    internal const string Long =
        """{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[88734.88763302466,-1234.04999],[88800.25,-1300],[88734.88763302466,-1234.04999]]]},"properties":null}""";
    internal const string Rounded =
        """{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[88734.9,-1234],[88800.3,-1300],[88734.9,-1234]]]},"properties":null}""";

    [Fact]
    public void Coordinates_GoToATenthOfAPixel()
    {
        Assert.Equal(Rounded, GeoJsonRounding.Round(Long));
    }

    [Fact]
    public void Halves_GoUp_LikeTheViewer()
    {
        // Math.round in the browser: 0.05 -> 0.1, -0.05 -> -0.
        Assert.Equal(0.1, GeoJsonRounding.RoundCoordinate(0.05));
        Assert.Equal(0, GeoJsonRounding.RoundCoordinate(-0.05));
        Assert.Equal(-0.1, GeoJsonRounding.RoundCoordinate(-0.06));
    }

    [Theory]
    [InlineData("""{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[0,0],[10.5,2]]]},"properties":{}}""")]
    [InlineData("""{ "type": "Polygon", "coordinates": [[[1, 2], [3, 4]]] }""")]
    [InlineData("{}")]
    [InlineData("""{"type":"Polygon"}""")]
    [InlineData("not json")]
    [InlineData("")]
    public void AlreadyShortEnough_OrNotJson_IsKeptExactly(string geoJson)
    {
        Assert.Same(geoJson, GeoJsonRounding.Round(geoJson));
    }

    [Fact]
    public void OnlyCoordinatesAreTouched()
    {
        var geoJson = """{"type":"Feature","geometry":{"type":"Point","coordinates":[1.234,5.678]},"properties":{"radius":12.3456,"label":"café, 1.234"}}""";
        Assert.Equal(
            """{"type":"Feature","geometry":{"type":"Point","coordinates":[1.2,5.7]},"properties":{"radius":12.3456,"label":"café, 1.234"}}""",
            GeoJsonRounding.Round(geoJson));
    }

    [Fact]
    public void EveryGeometryInACollection_IsRounded()
    {
        var geoJson = """{"type":"GeometryCollection","geometries":[{"type":"Point","coordinates":[1.26,2]},{"type":"LineString","coordinates":[[1e-7,3.33333],[4,5]]}]}""";
        Assert.Equal(
            """{"type":"GeometryCollection","geometries":[{"type":"Point","coordinates":[1.3,2]},{"type":"LineString","coordinates":[[0,3.3],[4,5]]}]}""",
            GeoJsonRounding.Round(geoJson));
    }
}
