using System.Net;
using System.Text;
using Messaging.Auth;
using Messaging.Sessions;

namespace Messaging.Tests;

// The real thing that asks annotation-store, against made up answers in the
// shape of its MembershipView.
public class SessionAccessTests
{
    private sealed class Answering(Func<HttpRequestMessage, HttpResponseMessage> answer) : HttpMessageHandler
    {
        public HttpRequestMessage? Asked { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Asked = request;
            return Task.FromResult(answer(request));
        }
    }

    private static HttpResponseMessage Membership(string kind, string role, string? ended = null) =>
        new(HttpStatusCode.OK)
        {
            Content = new StringContent(
                $$"""{"collectionId":"{{Guid.NewGuid()}}","slideId":"003","kind":"{{kind}}","role":"{{role}}","ended":{{(ended is null ? "null" : $"\"{ended}\"")}}}""",
                Encoding.UTF8, "application/json"),
        };

    private static AnnotationStoreSessionAccess Access(Answering handler) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("http://store/") });

    [Fact]
    public async Task ASession_ComesBackWithTheirRole()
    {
        var membership = await Access(new Answering(_ => Membership("session", "owner"))).MembershipAsync(Guid.NewGuid(), "t", default);
        Assert.Equal(new SessionMembership(SessionRole.Owner, false), membership);
    }

    [Fact]
    public async Task AnEndedSession_SaysSo()
    {
        var membership = await Access(new Answering(_ => Membership("session", "viewer", "2026-11-05T10:00:00Z"))).MembershipAsync(Guid.NewGuid(), "t", default);
        Assert.Equal(new SessionMembership(SessionRole.Viewer, true), membership);
    }

    [Fact]
    public async Task APersonalCollection_IsntASession()
    {
        Assert.Null(await Access(new Answering(_ => Membership("personal", "owner"))).MembershipAsync(Guid.NewGuid(), "t", default));
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task NotBeingInIt_IsNull(HttpStatusCode status)
    {
        Assert.Null(await Access(new Answering(_ => new HttpResponseMessage(status))).MembershipAsync(Guid.NewGuid(), "t", default));
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError)]
    [InlineData(HttpStatusCode.Unauthorized)]
    public async Task AnythingElse_IsntAnAnswer(HttpStatusCode status)
    {
        await Assert.ThrowsAsync<SessionAccessUnavailable>(() => Access(new Answering(_ => new HttpResponseMessage(status))).MembershipAsync(Guid.NewGuid(), "t", default));
    }

    [Fact]
    public async Task NotBeingAbleToReachIt_IsntAnAnswerEither()
    {
        await Assert.ThrowsAsync<SessionAccessUnavailable>(() => Access(new Answering(_ => throw new HttpRequestException("refused"))).MembershipAsync(Guid.NewGuid(), "t", default));
    }

    [Fact]
    public async Task ItAsksWithTheirOwnToken_AboutThatSession()
    {
        var session = Guid.NewGuid();
        var handler = new Answering(_ => Membership("session", "editor"));

        await Access(handler).MembershipAsync(session, "their-token", default);

        Assert.Equal(("Bearer", "their-token"), (handler.Asked!.Headers.Authorization!.Scheme, handler.Asked.Headers.Authorization.Parameter));
        Assert.Equal($"http://store/collections/{session}/membership", handler.Asked.RequestUri!.ToString());
    }

    [Theory]
    [InlineData("http://localhost:5173/auth/realms/diss", true)]
    [InlineData("https://10.0.0.5/auth/realms/diss/", true)]
    [InlineData("http://localhost:5173/auth/realms/other", false)]
    [InlineData("ftp://localhost/auth/realms/diss", false)]
    [InlineData("not a url", false)]
    public void OnlyThatRealmsTokens_AreAccepted(string issuer, bool accepted)
    {
        Assert.Equal(accepted, KeycloakAuth.IsRealmIssuer(issuer, "diss"));
    }
}
