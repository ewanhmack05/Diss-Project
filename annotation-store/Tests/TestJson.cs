using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using AnnotationStore.Collections;

namespace AnnotationStore.Tests;

public static class TestJson
{
    // Same as the API - roles come back as "owner" etc.
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    // The caller's own collection for a slide.
    public static async Task<Guid> EnsureCollectionAsync(HttpClient client, string slideId)
    {
        var response = await client.PostAsJsonAsync("/collections/ensure", new EnsureRequest(slideId));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CollectionView>(Options))!.CollectionId;
    }
}
