using System.Net;
using System.Net.Http.Json;
using AnnotationStore.Annotations;
using AnnotationStore.Collections;

namespace AnnotationStore.Tests;

// Small vs large sessions - an edit link lets in the first Max as editors,
// anyone after that joins view only. The host can still make more.
public class SessionSizeTests : IClassFixture<CellCountApiFactory>
{
    private static readonly System.Text.Json.JsonSerializerOptions Json = TestJson.Options;
    private const CollectionRole Viewer = CollectionRole.Viewer;
    private const CollectionRole Editor = CollectionRole.Editor;
    private const CollectionRole Owner = CollectionRole.Owner;

    private const int Max = SessionSize.DefaultMaxEditors;

    private readonly CellCountApiFactory _factory;

    public SessionSizeTests(CellCountApiFactory factory)
    {
        _factory = factory;
    }

    private HttpClient As(string userId) => TestAuthHandler.As(_factory.CreateClient(), userId, $"User {userId}");

    // A session hosted by `host`, with an edit link. Ids are unique per test
    // so the shared database doesn't mix them up.
    private async Task<(Guid Id, string Code)> StartAsync(HttpClient host)
    {
        var started = await host.PostAsJsonAsync("/sessions", new EnsureRequest(Guid.NewGuid().ToString()));
        var session = (await started.Content.ReadFromJsonAsync<CollectionView>(Json))!;
        var made = await host.PostAsJsonAsync($"/collections/{session.CollectionId}/invites", new InviteRequest(Editor, 24), Json);
        var invite = (await made.Content.ReadFromJsonAsync<InviteView>(Json))!;
        return (session.CollectionId, invite.Code);
    }

    private static async Task<CollectionRole> JoinAsync(HttpClient who, string code)
    {
        var response = await who.PostAsync($"/invites/{code}/accept", null);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<CollectionView>(Json))!.MyRole;
    }

    private static string Someone(string test, int i) => $"{test}-{i}";

    // The host plus enough editors to fill the session.
    private async Task<(Guid Id, string Code, HttpClient Host)> FullAsync(string test)
    {
        var host = As(Someone(test, 0));
        var (id, code) = await StartAsync(host);
        for (var i = 1; i < Max; i++)
            Assert.Equal(Editor, await JoinAsync(As(Someone(test, i)), code));
        return (id, code, host);
    }

    private static Task<HttpResponseMessage> SetRoleAsync(HttpClient host, Guid id, string userId, CollectionRole role) =>
        host.PutAsJsonAsync($"/collections/{id}/members/{userId}", new MemberRequest("", role), Json);

    [Fact]
    public void RoleOnJoin_GivesTheLinksRole_WhileThereIsRoom()
    {
        Assert.Equal(Editor, SessionSize.RoleOnJoin(Editor, null, Max - 1, Max));
        Assert.Equal(Viewer, SessionSize.RoleOnJoin(Viewer, null, 0, Max));
    }

    [Fact]
    public void RoleOnJoin_IsViewOnly_OnceTheEditorsAreFull()
    {
        Assert.Equal(Viewer, SessionSize.RoleOnJoin(Editor, null, Max, Max));
        Assert.Equal(Viewer, SessionSize.RoleOnJoin(Editor, Viewer, Max, Max));
    }

    [Fact]
    public void RoleOnJoin_NeverMovesAnyoneDown()
    {
        // Already editing - they're one of the editors counted, so a full
        // session doesn't take it off them.
        Assert.Equal(Editor, SessionSize.RoleOnJoin(Editor, Editor, Max, Max));
        Assert.Equal(Editor, SessionSize.RoleOnJoin(Viewer, Editor, Max, Max));
        Assert.Equal(Owner, SessionSize.RoleOnJoin(Editor, Owner, Max, Max));
    }

    [Fact]
    public void IsLarge_OncePeopleOutnumberTheEditorPlaces()
    {
        CollectionMember M(CollectionRole role) => new() { Role = role };
        var full = Enumerable.Repeat(Editor, Max).Select(M).ToList();
        Assert.False(SessionSize.IsLarge(full, Max));
        Assert.True(SessionSize.IsLarge([.. full, M(Viewer)], Max));
        Assert.Equal(Max, SessionSize.Editors([.. full, M(Viewer)]));
    }

    [Fact]
    public async Task PastTheCap_AnEditLinkLetsYouIn_ViewOnly()
    {
        var (id, code, _) = await FullAsync(nameof(PastTheCap_AnEditLinkLetsYouIn_ViewOnly));
        var late = As("late-viewer");

        var preview = (await late.GetFromJsonAsync<InvitePreview>($"/invites/{code}", Json))!;
        Assert.Equal(Editor, preview.Role);
        Assert.Equal(Viewer, preview.JoinsAs);

        Assert.Equal(Viewer, await JoinAsync(late, code));
        var annotation = await late.PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "a" });
        Assert.Equal(HttpStatusCode.Forbidden, annotation.StatusCode);
    }

    [Fact]
    public async Task ReachingTheCap_DoesntMoveAnyEditorDown()
    {
        var test = nameof(ReachingTheCap_DoesntMoveAnyEditorDown);
        var (id, code, host) = await FullAsync(test);
        await JoinAsync(As("watcher"), code);

        var view = (await host.GetFromJsonAsync<CollectionView>($"/collections/{id}", Json))!;
        Assert.Equal(Max, view.Members.Count(m => m.Role >= Editor));
        Assert.Equal(Max, view.MaxEditors);
        // Accepting again doesn't knock an editor down either.
        Assert.Equal(Editor, await JoinAsync(As(Someone(test, 1)), code));
    }

    [Fact]
    public async Task TheHost_CanStillMakeMoreEditors_ButTheLinkDoesnt()
    {
        // The cap only limits joining - the host deciding someone should
        // edit isn't stopped by it.
        var (id, code, host) = await FullAsync(nameof(TheHost_CanStillMakeMoreEditors_ButTheLinkDoesnt));
        await JoinAsync(As("hopeful"), code);

        Assert.Equal(HttpStatusCode.OK, (await SetRoleAsync(host, id, "hopeful", Editor)).StatusCode);
        var view = (await host.GetFromJsonAsync<CollectionView>($"/collections/{id}", Json))!;
        Assert.Equal(Max + 1, view.Members.Count(m => m.Role >= Editor));
        var annotation = await As("hopeful").PostAsJsonAsync("/annotations", new Annotation { CollectionId = id, Label = "a" });
        Assert.Equal(HttpStatusCode.Created, annotation.StatusCode);

        // Someone new through the edit link still comes in view only.
        Assert.Equal(Viewer, await JoinAsync(As("after-hopeful"), code));
    }

    [Fact]
    public async Task AnEditorSteppingDownOrLeaving_MakesRoomAgain()
    {
        var test = nameof(AnEditorSteppingDownOrLeaving_MakesRoomAgain);
        var (id, code, host) = await FullAsync(test);
        Assert.Equal(Viewer, await JoinAsync(As("waiting-1"), code));

        // Made view only - the next person through the link can edit.
        (await SetRoleAsync(host, id, Someone(test, 1), Viewer)).EnsureSuccessStatusCode();
        Assert.Equal(Editor, await JoinAsync(As("next-1"), code));

        // Leaving frees one too.
        Assert.Equal(HttpStatusCode.NoContent, (await As(Someone(test, 2)).DeleteAsync($"/collections/{id}/members/{Someone(test, 2)}")).StatusCode);
        Assert.Equal(Editor, await JoinAsync(As("next-2"), code));

        // And full again.
        Assert.Equal(Viewer, await JoinAsync(As("next-3"), code));
    }

    [Fact]
    public async Task AViewOnlyLink_StillWorks_WhenFull()
    {
        var (id, _, host) = await FullAsync(nameof(AViewOnlyLink_StillWorks_WhenFull));
        var made = await host.PostAsJsonAsync($"/collections/{id}/invites", new InviteRequest(Viewer, 1), Json);
        var viewOnly = (await made.Content.ReadFromJsonAsync<InviteView>(Json))!;

        Assert.Equal(Viewer, await JoinAsync(As("audience"), viewOnly.Code));
    }

    [Fact]
    public async Task TheCap_IsSetWhenTheSessionStarts_AndKeptOnIt()
    {
        var host = As("small-host");
        var started = await host.PostAsJsonAsync("/sessions", new EnsureRequest(Guid.NewGuid().ToString(), MaxEditors: 2));
        Assert.Equal(HttpStatusCode.Created, started.StatusCode);
        var session = (await started.Content.ReadFromJsonAsync<CollectionView>(Json))!;
        Assert.Equal(2, session.MaxEditors);

        var made = await host.PostAsJsonAsync($"/collections/{session.CollectionId}/invites", new InviteRequest(Editor, 24), Json);
        var code = (await made.Content.ReadFromJsonAsync<InviteView>(Json))!.Code;
        Assert.Equal(Editor, await JoinAsync(As("second"), code));
        Assert.Equal(Viewer, await JoinAsync(As("third"), code));
    }

    [Fact]
    public async Task NoCapGiven_IsTheDefault()
    {
        var started = await As("default-host").PostAsJsonAsync("/sessions", new EnsureRequest(Guid.NewGuid().ToString()));
        Assert.Equal(Max, (await started.Content.ReadFromJsonAsync<CollectionView>(Json))!.MaxEditors);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(SessionSize.MostMaxEditors + 1)]
    public async Task ACapOutsideTheLimits_IsTurnedDown(int maxEditors)
    {
        var started = await As("odd-host").PostAsJsonAsync("/sessions", new EnsureRequest(Guid.NewGuid().ToString(), MaxEditors: maxEditors));
        Assert.Equal(HttpStatusCode.BadRequest, started.StatusCode);
    }

    [Fact]
    public async Task ACapOfOne_IsTheHostPresenting()
    {
        var host = As("presenter");
        var started = await host.PostAsJsonAsync("/sessions", new EnsureRequest(Guid.NewGuid().ToString(), MaxEditors: 1));
        var session = (await started.Content.ReadFromJsonAsync<CollectionView>(Json))!;
        var made = await host.PostAsJsonAsync($"/collections/{session.CollectionId}/invites", new InviteRequest(Editor, 24), Json);
        var code = (await made.Content.ReadFromJsonAsync<InviteView>(Json))!.Code;

        Assert.Equal(Viewer, await JoinAsync(As("audience-1"), code));
    }
}
