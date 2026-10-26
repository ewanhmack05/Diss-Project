using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace AnnotationStore.Annotations;

// Coordinates are slide pixels, and the viewer sends them to a tenth (see
// image-viewer's GeoJSON.ts) - full doubles nearly double what the map has
// to load. Whatever else saves a shape, an import or a script, gets the
// same here. GeoJSON that's short enough already, or isn't JSON, is kept
// exactly as it came.
public static class GeoJsonRounding
{
    public const int Decimals = 1;
    private static readonly double Power = Math.Pow(10, Decimals);
    private static readonly JsonWriterOptions WriterOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    public static string Round(string geoJson)
    {
        var bytes = Encoding.UTF8.GetBytes(geoJson);
        try
        {
            if (!NeedsRounding(bytes)) return geoJson;
            return Rewrite(bytes);
        }
        catch (JsonException)
        {
            return geoJson;
        }
    }

    // Same as the viewer's Math.round - halves go up.
    public static double RoundCoordinate(double value) => Math.Floor(value * Power + 0.5) / Power;

    private static bool NeedsRounding(byte[] bytes)
    {
        var reader = new Utf8JsonReader(bytes);
        var inside = new CoordinatesTracker();
        while (reader.Read())
        {
            inside.Step(ref reader);
            if (inside.Now && reader.TokenType == JsonTokenType.Number && TooLong(reader.ValueSpan)) return true;
        }
        return false;
    }

    private static bool TooLong(ReadOnlySpan<byte> number)
    {
        if (number.IndexOfAny((byte)'e', (byte)'E') >= 0) return true;
        var dot = number.IndexOf((byte)'.');
        return dot >= 0 && number.Length - dot - 1 > Decimals;
    }

    private static string Rewrite(byte[] bytes)
    {
        var reader = new Utf8JsonReader(bytes);
        var inside = new CoordinatesTracker();
        using var output = new MemoryStream(bytes.Length);
        using (var writer = new Utf8JsonWriter(output, WriterOptions))
        {
            while (reader.Read())
            {
                inside.Step(ref reader);
                switch (reader.TokenType)
                {
                    case JsonTokenType.StartObject: writer.WriteStartObject(); break;
                    case JsonTokenType.EndObject: writer.WriteEndObject(); break;
                    case JsonTokenType.StartArray: writer.WriteStartArray(); break;
                    case JsonTokenType.EndArray: writer.WriteEndArray(); break;
                    case JsonTokenType.PropertyName: writer.WritePropertyName(reader.GetString()!); break;
                    case JsonTokenType.String: writer.WriteStringValue(reader.GetString()); break;
                    case JsonTokenType.Number when inside.Now: writer.WriteNumberValue(RoundCoordinate(reader.GetDouble())); break;
                    case JsonTokenType.Number: writer.WriteRawValue(reader.ValueSpan, skipInputValidation: true); break;
                    case JsonTokenType.True: writer.WriteBooleanValue(true); break;
                    case JsonTokenType.False: writer.WriteBooleanValue(false); break;
                    case JsonTokenType.Null: writer.WriteNullValue(); break;
                }
            }
        }
        return Encoding.UTF8.GetString(output.ToArray());
    }

    // Whether the reader is inside a "coordinates" array - only those
    // numbers are slide pixels.
    private struct CoordinatesTracker
    {
        private bool _named;
        private int _depth;
        public bool Now { get; private set; }

        public void Step(ref Utf8JsonReader reader)
        {
            if (Now)
            {
                if (reader.TokenType == JsonTokenType.EndArray && reader.CurrentDepth == _depth) Now = false;
                return;
            }
            if (_named && reader.TokenType == JsonTokenType.StartArray)
            {
                Now = true;
                _depth = reader.CurrentDepth;
            }
            _named = reader.TokenType == JsonTokenType.PropertyName && reader.ValueTextEquals("coordinates");
        }
    }
}
