using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Messaging.Conversations;
using Messaging.Sessions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Messaging.Tests;

public class MessagingTests(MessagingApiFactory factory) : IClassFixture<MessagingApiFactory>
{
    private static readonly JsonSerializerOptions Json = TestClient.Json;

    private static string NewUser(string name) => $"{name}-{Guid.NewGuid():N}";

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, object body) => client.PostAsJsonAsync("/messages", body, Json);

    private static async Task<MessageView> SendToAsync(HttpClient client, string to, string body = "hello", object? attachment = null)
    {
        var response = await SendAsync(client, new { id = Guid.NewGuid(), toUserId = to, body, attachment });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<MessageView>(Json))!;
    }

    private static async Task<MessageView> SendInSessionAsync(HttpClient client, Guid session, string body = "hello")
    {
        var response = await SendAsync(client, new { id = Guid.NewGuid(), sessionId = session, body });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<MessageView>(Json))!;
    }

    private static async Task<List<ConversationView>> ListAsync(HttpClient client) =>
        (await client.GetFromJsonAsync<List<ConversationView>>("/conversations", Json))!;

    private static async Task<MessagePage> PageAsync(HttpClient client, Guid conversation, string query = "") =>
        (await client.GetFromJsonAsync<MessagePage>($"/conversations/{conversation}/messages{query}", Json))!;

    private static object Rows(int count = 1) => new { annotations = Enumerable.Range(0, count).Select(i => new { label = $"Region {i}" }) };

    private static object Sent(string kind = "annotations", object? payload = null) => new { kind, name = "2 annotations", slideId = "003", sourceCollectionId = Guid.NewGuid(), payload = payload ?? Rows(2) };

    // --- Between two people ---------------------------------------------

    [Fact]
    public async Task AFirstMessage_MakesTheConversation_ForBothOfThem()
    {
        var (aliceId, bobId) = (NewUser("alice"), NewUser("bob"));
        var alice = factory.As(aliceId);
        var bob = factory.As(bobId);

        var sent = await SendToAsync(alice, bobId);

        Assert.Equal(aliceId, sent.FromUserId);
        var seenByBob = Assert.Single(await ListAsync(bob));
        var seenByAlice = Assert.Single(await ListAsync(alice));
        Assert.Equal(seenByAlice.Id, seenByBob.Id);
        Assert.Equal(ConversationKind.Direct, seenByBob.Kind);
        Assert.Equal(aliceId, seenByBob.WithUserId);
        Assert.Equal(bobId, seenByAlice.WithUserId);
        Assert.Equal("hello", seenByBob.LastMessage!.Body);
    }

    [Fact]
    public async Task TwoPeople_OnlyEverHaveOneConversation_WhoeverWrites()
    {
        var (aliceId, bobId) = (NewUser("alice"), NewUser("bob"));
        var alice = factory.As(aliceId);
        var bob = factory.As(bobId);

        var first = await SendToAsync(alice, bobId, "one");
        var second = await SendToAsync(bob, aliceId, "two");

        Assert.Equal(first.ConversationId, second.ConversationId);
        Assert.Single(await ListAsync(alice));
        Assert.Equal(["two", "one"], (await PageAsync(alice, first.ConversationId)).Messages.Select(m => m.Body));
    }

    [Fact]
    public async Task TheName_ComesFromTheToken_NotTheRequest()
    {
        var aliceId = NewUser("alice");
        var alice = factory.As(aliceId);
        alice.DefaultRequestHeaders.Add("X-Test-Name", "Alice Moore");

        var response = await SendAsync(alice, new { id = Guid.NewGuid(), toUserId = NewUser("bob"), body = "hi", fromUserId = "someone-else", fromName = "Someone Else" });

        var message = (await response.Content.ReadFromJsonAsync<MessageView>(Json))!;
        Assert.Equal((aliceId, "Alice Moore"), (message.FromUserId, message.FromName));
    }

    [Fact]
    public async Task SomeoneElse_CantSeeAnyOfIt_AndCantTellItExists()
    {
        var aliceId = NewUser("alice");
        var alice = factory.As(aliceId);
        var carol = factory.As(NewUser("carol"));
        var sent = await SendToAsync(alice, NewUser("bob"), attachment: Sent());

        Assert.Empty(await ListAsync(carol));
        Assert.Equal(HttpStatusCode.NotFound, (await carol.GetAsync($"/conversations/{sent.ConversationId}/messages")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await carol.PostAsync($"/conversations/{sent.ConversationId}/read", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await carol.DeleteAsync($"/conversations/{sent.ConversationId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await carol.GetAsync($"/messages/{sent.Id}/attachment")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await carol.PostAsync($"/messages/{sent.Id}/added", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await carol.GetAsync($"/conversations/{Guid.NewGuid()}/messages")).StatusCode);
    }

    [Fact]
    public async Task NobodySignedIn_GetsNothing()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.CreateClient().GetAsync("/conversations")).StatusCode);
    }

    [Theory]
    [InlineData("", "nothing")]
    [InlineData("   ", "nothing")]
    public async Task NothingToSend_IsTurnedDown(string body, string _)
    {
        var response = await SendAsync(factory.As(NewUser("alice")), new { id = Guid.NewGuid(), toUserId = NewUser("bob"), body });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task TheLimits_AreTheLimits()
    {
        var alice = factory.As(NewUser("alice"));
        var bob = NewUser("bob");

        Assert.Equal(HttpStatusCode.Created, (await SendAsync(alice, new { id = Guid.NewGuid(), toUserId = bob, body = new string('a', Endpoints.MaxBodyLength) })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(alice, new { id = Guid.NewGuid(), toUserId = bob, body = new string('a', Endpoints.MaxBodyLength + 1) })).StatusCode);
    }

    [Fact]
    public async Task WhoItsTo_HasToBeOneThing()
    {
        var aliceId = NewUser("alice");
        var alice = factory.As(aliceId);

        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(alice, new { id = Guid.NewGuid(), body = "hi" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(alice, new { id = Guid.NewGuid(), toUserId = NewUser("bob"), sessionId = Guid.NewGuid(), body = "hi" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(alice, new { id = Guid.NewGuid(), toUserId = aliceId, body = "hi" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(alice, new { id = Guid.NewGuid(), toUserId = "  ", body = "hi" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(alice, new { id = Guid.Empty, toUserId = NewUser("bob"), body = "hi" })).StatusCode);
    }

    [Fact]
    public async Task SendingAgainAfterADroppedConnection_IsTheSameMessage()
    {
        var alice = factory.As(NewUser("alice"));
        var body = new { id = Guid.NewGuid(), toUserId = NewUser("bob"), body = "hi" };

        var first = await SendAsync(alice, body);
        var again = await SendAsync(alice, body);

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        var sent = (await again.Content.ReadFromJsonAsync<MessageView>(Json))!;
        Assert.Equal(body.id, sent.Id);
        Assert.Equal(1, (await PageAsync(alice, sent.ConversationId)).Total);
    }

    [Fact]
    public async Task SomeoneElsesMessageId_IsTurnedDown()
    {
        var id = Guid.NewGuid();
        await SendAsync(factory.As(NewUser("alice")), new { id, toUserId = NewUser("bob"), body = "hi" });

        var response = await SendAsync(factory.As(NewUser("carol")), new { id, toUserId = NewUser("dave"), body = "mine now" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Messages_ComePaged_NewestFirst()
    {
        var alice = factory.As(NewUser("alice"));
        var bob = NewUser("bob");
        var sent = new List<MessageView>();
        for (var i = 0; i < 5; i++) sent.Add(await SendToAsync(alice, bob, $"m{i}"));
        var id = sent[0].ConversationId;

        var first = await PageAsync(alice, id, "?take=2");
        var second = await PageAsync(alice, id, "?skip=2&take=2");

        Assert.Equal(5, first.Total);
        Assert.Equal(["m4", "m3"], first.Messages.Select(m => m.Body));
        Assert.Equal(["m2", "m1"], second.Messages.Select(m => m.Body));
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.GetAsync($"/conversations/{id}/messages?take=0")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.GetAsync($"/conversations/{id}/messages?take=101")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await alice.GetAsync($"/conversations/{id}/messages?skip=-1")).StatusCode);
    }

    [Fact]
    public async Task Conversations_AreMostRecentFirst()
    {
        var alice = factory.As(NewUser("alice"));
        var (bob, carol) = (NewUser("bob"), NewUser("carol"));
        await SendToAsync(alice, bob);
        await SendToAsync(alice, carol);
        await SendToAsync(alice, bob, "later");

        Assert.Equal([bob, carol], (await ListAsync(alice)).Select(c => c.WithUserId));
    }

    [Fact]
    public async Task Unread_CountsOtherPeoplesMessagesSinceYouLastRead()
    {
        var (aliceId, bobId) = (NewUser("alice"), NewUser("bob"));
        var alice = factory.As(aliceId);
        var bob = factory.As(bobId);
        var sent = await SendToAsync(alice, bobId);
        await SendToAsync(alice, bobId);

        Assert.Equal(2, Assert.Single(await ListAsync(bob)).Unread);
        Assert.Equal(0, Assert.Single(await ListAsync(alice)).Unread);

        Assert.Equal(HttpStatusCode.NoContent, (await bob.PostAsync($"/conversations/{sent.ConversationId}/read", null)).StatusCode);
        Assert.Equal(0, Assert.Single(await ListAsync(bob)).Unread);

        await SendToAsync(alice, bobId);
        Assert.Equal(1, Assert.Single(await ListAsync(bob)).Unread);
    }

    [Fact]
    public async Task Deleting_HidesItForYou_AndANewMessageBringsItBack()
    {
        var (aliceId, bobId) = (NewUser("alice"), NewUser("bob"));
        var alice = factory.As(aliceId);
        var bob = factory.As(bobId);
        var sent = await SendToAsync(alice, bobId);

        Assert.Equal(HttpStatusCode.NoContent, (await bob.DeleteAsync($"/conversations/{sent.ConversationId}")).StatusCode);
        Assert.Empty(await ListAsync(bob));
        Assert.Single(await ListAsync(alice));

        await SendToAsync(alice, bobId, "still there?");
        Assert.Equal("still there?", Assert.Single(await ListAsync(bob)).LastMessage!.Body);
    }

    [Fact]
    public async Task OnceBothHaveDeletedIt_ItsGone()
    {
        var (aliceId, bobId) = (NewUser("alice"), NewUser("bob"));
        var alice = factory.As(aliceId);
        var bob = factory.As(bobId);
        var sent = await SendToAsync(alice, bobId, attachment: Sent());

        await alice.DeleteAsync($"/conversations/{sent.ConversationId}");
        await bob.DeleteAsync($"/conversations/{sent.ConversationId}");

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MessagingDbContext>();
        Assert.False(await db.Conversations.AnyAsync(c => c.Id == sent.ConversationId));
        Assert.False(await db.Messages.AnyAsync(m => m.Id == sent.Id));
        Assert.False(await db.Attachments.AnyAsync(a => a.MessageId == sent.Id));
    }

    // --- Sending things -------------------------------------------------

    [Fact]
    public async Task AnAttachment_IsListedWithoutItsRows_AndFetchedWithThem()
    {
        var (aliceId, bobId) = (NewUser("alice"), NewUser("bob"));
        var bob = factory.As(bobId);
        var source = Guid.NewGuid();

        var sent = await SendToAsync(factory.As(aliceId), bobId, "", new { kind = "group", name = "Tumour", slideId = "003", sourceCollectionId = source, payload = new { group = "Tumour", annotations = new[] { "a", "b" } } });

        Assert.Equal((AttachmentKind.Group, "Tumour", "003", source), (sent.Attachment!.Kind, sent.Attachment.Name, sent.Attachment.SlideId, sent.Attachment.SourceCollectionId));
        var raw = await bob.GetStringAsync($"/conversations/{sent.ConversationId}/messages");
        Assert.DoesNotContain("annotations", raw);
        Assert.Contains("\"bytes\":", raw);

        var full = (await bob.GetFromJsonAsync<AttachmentWithPayload>($"/messages/{sent.Id}/attachment", Json))!;
        Assert.Equal("Tumour", full.Payload!.Value.GetProperty("group").GetString());
        Assert.Equal(2, full.Payload.Value.GetProperty("annotations").GetArrayLength());
        Assert.True(full.Bytes > 0);
    }

    [Fact]
    public async Task AMessageWithoutAnAttachment_HasNoneToFetch()
    {
        var alice = factory.As(NewUser("alice"));
        var sent = await SendToAsync(alice, NewUser("bob"));

        Assert.Equal(HttpStatusCode.NotFound, (await alice.GetAsync($"/messages/{sent.Id}/attachment")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await alice.PostAsync($"/messages/{sent.Id}/added", null)).StatusCode);
    }

    [Fact]
    public async Task OverTheLimit_IsTurnedDown_SayingHowBig()
    {
        var alice = factory.As(NewUser("alice"));
        var payload = new { blob = new string('a', Endpoints.MaxPayloadBytes + 10) };

        var response = await SendAsync(alice, new { id = Guid.NewGuid(), toUserId = NewUser("bob"), body = "", attachment = Sent(payload: payload) });

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Contains("5.0MB", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task JustUnderTheLimit_GoesThrough()
    {
        var alice = factory.As(NewUser("alice"));
        var payload = new { blob = new string('a', Endpoints.MaxPayloadBytes - 100) };

        var response = await SendAsync(alice, new { id = Guid.NewGuid(), toUserId = NewUser("bob"), body = "", attachment = Sent(payload: payload) });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task AnInvite_CarriesItsCode_AndNoRows()
    {
        var bobId = NewUser("bob");
        var sent = await SendToAsync(factory.As(NewUser("alice")), bobId, "", new { kind = "invite", name = "Friday's session", slideId = "003", inviteCode = "juyhsUFHC4gB" });

        var seen = (await PageAsync(factory.As(bobId), sent.ConversationId)).Messages.Single();
        Assert.Equal((AttachmentKind.Invite, "juyhsUFHC4gB"), (seen.Attachment!.Kind, seen.Attachment.InviteCode));
        Assert.Equal(0, seen.Attachment.Bytes);
    }

    public static TheoryData<object> BadAttachments => new()
    {
        new { kind = "invite", name = "No code" },
        new { kind = "invite", name = "Bad code", inviteCode = "not/a code!" },
        new { kind = "invite", name = "Long code", inviteCode = new string('a', 65) },
        new { kind = "invite", name = "Rows too", inviteCode = "abc", payload = new { a = 1 } },
        new { kind = "annotations", name = "No rows" },
        new { kind = "annotations", name = "Code too", inviteCode = "abc", payload = new { a = 1 } },
        new { kind = "annotations", name = "Not an object", payload = new[] { 1, 2 } },
        new { kind = "annotations", name = "  ", payload = new { a = 1 } },
        new { kind = "annotations", name = new string('a', 201), payload = new { a = 1 } },
    };

    [Theory]
    [MemberData(nameof(BadAttachments))]
    public async Task ABadAttachment_IsTurnedDown(object attachment)
    {
        var response = await SendAsync(factory.As(NewUser("alice")), new { id = Guid.NewGuid(), toUserId = NewUser("bob"), body = "", attachment });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task AnUnknownKind_IsTurnedDown()
    {
        var response = await SendAsync(factory.As(NewUser("alice")), new { id = Guid.NewGuid(), toUserId = NewUser("bob"), body = "", attachment = new { kind = "hologram", name = "x", payload = new { a = 1 } } });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task AnArea_IsSentAndReadBack_ButCantBeAdded()
    {
        var bobId = NewUser("bob");
        var area = new { center = new[] { 100.5, -200.25 }, resolution = 2.5, rotation = 0.5, extent = new[] { 0.0, -400, 200, 0 } };
        var sent = await SendToAsync(factory.As(NewUser("alice")), bobId, "Look here", new { kind = "area", name = "Area of slide 003", slideId = "003", payload = area });

        Assert.Equal((AttachmentKind.Area, "Area of slide 003", "003"), (sent.Attachment!.Kind, sent.Attachment.Name, sent.Attachment.SlideId));
        var seen = await factory.As(bobId).GetFromJsonAsync<AttachmentWithPayload>($"/messages/{sent.Id}/attachment", Json);
        Assert.Equal(100.5, seen!.Payload!.Value.GetProperty("center")[0].GetDouble());
        Assert.Equal(2.5, seen.Payload!.Value.GetProperty("resolution").GetDouble());
        Assert.Equal(HttpStatusCode.BadRequest, (await factory.As(bobId).PostAsync($"/messages/{sent.Id}/added", null)).StatusCode);
    }

    [Fact]
    public async Task AnInvite_CantBeAdded()
    {
        var bobId = NewUser("bob");
        var sent = await SendToAsync(factory.As(NewUser("alice")), bobId, "", new { kind = "invite", name = "Friday's session", inviteCode = "juyhsUFHC4gB" });

        Assert.Equal(HttpStatusCode.BadRequest, (await factory.As(bobId).PostAsync($"/messages/{sent.Id}/added", null)).StatusCode);
    }

    [Fact]
    public async Task AnArea_NeedsWhereItIs()
    {
        var response = await factory.As(NewUser("alice")).PostAsJsonAsync("/messages", new
        {
            id = Guid.NewGuid(),
            toUserId = NewUser("bob"),
            body = "",
            attachment = new { kind = "area", name = "Nowhere" },
        }, Json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Added_IsPerPerson()
    {
        var session = Guid.NewGuid();
        var (aliceId, bobId, carolId) = (NewUser("alice"), NewUser("bob"), NewUser("carol"));
        foreach (var user in new[] { aliceId, bobId, carolId }) factory.Sessions.Add(session, user);
        var response = await SendAsync(factory.As(aliceId), new { id = Guid.NewGuid(), sessionId = session, body = "", attachment = Sent() });
        var sent = (await response.Content.ReadFromJsonAsync<MessageView>(Json))!;
        Assert.Null(sent.Attachment!.LastAddedByMe);

        var added = await (await factory.As(bobId).PostAsync($"/messages/{sent.Id}/added", null)).Content.ReadFromJsonAsync<AttachmentView>(Json);

        Assert.NotNull(added!.LastAddedByMe);
        Assert.NotNull((await PageAsync(factory.As(bobId), sent.ConversationId)).Messages.Single().Attachment!.LastAddedByMe);
        Assert.Null((await PageAsync(factory.As(carolId), sent.ConversationId)).Messages.Single().Attachment!.LastAddedByMe);
        Assert.NotNull((await factory.As(bobId).GetFromJsonAsync<AttachmentWithPayload>($"/messages/{sent.Id}/attachment", Json))!.LastAddedByMe);
        Assert.Null((await factory.As(carolId).GetFromJsonAsync<AttachmentWithPayload>($"/messages/{sent.Id}/attachment", Json))!.LastAddedByMe);
    }

    [Fact]
    public async Task AddingAgain_MovesTheTimeOn()
    {
        var bobId = NewUser("bob");
        var bob = factory.As(bobId);
        var sent = await SendToAsync(factory.As(NewUser("alice")), bobId, "", Sent());

        var first = await (await bob.PostAsync($"/messages/{sent.Id}/added", null)).Content.ReadFromJsonAsync<AttachmentView>(Json);
        await Task.Delay(5);
        var second = await (await bob.PostAsync($"/messages/{sent.Id}/added", null)).Content.ReadFromJsonAsync<AttachmentView>(Json);

        Assert.True(second!.LastAddedByMe > first!.LastAddedByMe);
    }

    // --- A session's chat -----------------------------------------------

    [Fact]
    public async Task ASessionsChat_IsForWhoeverIsInTheSession()
    {
        var session = Guid.NewGuid();
        var (hostId, viewerId, strangerId) = (NewUser("host"), NewUser("viewer"), NewUser("stranger"));
        factory.Sessions.Add(session, hostId, SessionRole.Owner);
        factory.Sessions.Add(session, viewerId, SessionRole.Viewer);
        var host = factory.As(hostId);

        var sent = await SendInSessionAsync(host, session);
        var seen = (await factory.As(viewerId).GetFromJsonAsync<ConversationView>($"/sessions/{session}/conversation", Json))!;

        Assert.Equal((ConversationKind.Session, session, sent.ConversationId), (seen.Kind, seen.SessionId, seen.Id));
        Assert.Null(seen.WithUserId);
        Assert.Equal(1, seen.Unread);
        Assert.Equal(sent.Id, seen.LastMessage!.Id);

        var stranger = factory.As(strangerId);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/sessions/{session}/conversation")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/conversations/{seen.Id}/messages")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(stranger, new { id = Guid.NewGuid(), sessionId = session, body = "let me in" })).StatusCode);
    }

    [Fact]
    public async Task OpeningASessionsChat_MakesIt_OnlyOnce()
    {
        var session = Guid.NewGuid();
        var alice = NewUser("alice");
        factory.Sessions.Add(session, alice);
        var client = factory.As(alice);

        var first = (await client.GetFromJsonAsync<ConversationView>($"/sessions/{session}/conversation", Json))!;
        var second = (await client.GetFromJsonAsync<ConversationView>($"/sessions/{session}/conversation", Json))!;

        Assert.Equal(first.Id, second.Id);
        Assert.Null(first.LastMessage);
    }

    [Fact]
    public async Task ViewOnlyPeople_CanTalkInIt()
    {
        var session = Guid.NewGuid();
        var viewer = NewUser("viewer");
        factory.Sessions.Add(session, viewer, SessionRole.Viewer);

        await SendInSessionAsync(factory.As(viewer), session, "a question");
    }

    [Fact]
    public async Task ASessionsChat_IsntInYourDirectList()
    {
        var session = Guid.NewGuid();
        var alice = NewUser("alice");
        factory.Sessions.Add(session, alice);
        await SendInSessionAsync(factory.As(alice), session);

        Assert.Empty(await ListAsync(factory.As(alice)));
    }

    [Fact]
    public async Task TakenOutOfASession_LosesItsChat_StraightAway()
    {
        var session = Guid.NewGuid();
        var (hostId, bobId) = (NewUser("host"), NewUser("bob"));
        factory.Sessions.Add(session, hostId, SessionRole.Owner);
        factory.Sessions.Add(session, bobId);
        var bob = factory.As(bobId);
        var sent = await SendInSessionAsync(factory.As(hostId), session, "hi");
        Assert.Equal(HttpStatusCode.OK, (await bob.GetAsync($"/conversations/{sent.ConversationId}/messages")).StatusCode);

        factory.Sessions.Remove(session, bobId);

        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/conversations/{sent.ConversationId}/messages")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/sessions/{session}/conversation")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync(bob, new { id = Guid.NewGuid(), sessionId = session, body = "still here" })).StatusCode);
    }

    [Fact]
    public async Task AnEndedSessionsChat_IsReadOnly_AndStaysToLookBackAt()
    {
        var session = Guid.NewGuid();
        var alice = NewUser("alice");
        factory.Sessions.Add(session, alice);
        var client = factory.As(alice);
        var sent = await SendInSessionAsync(client, session);

        factory.Sessions.Add(session, alice, ended: true);

        Assert.Equal(HttpStatusCode.Conflict, (await SendAsync(client, new { id = Guid.NewGuid(), sessionId = session, body = "too late" })).StatusCode);
        Assert.Equal(1, (await PageAsync(client, sent.ConversationId)).Total);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/sessions/{session}/conversation")).StatusCode);
    }

    [Fact]
    public async Task OnlyTheHost_CanDeleteASessionsChat()
    {
        var session = Guid.NewGuid();
        var (hostId, bobId) = (NewUser("host"), NewUser("bob"));
        factory.Sessions.Add(session, hostId, SessionRole.Owner);
        factory.Sessions.Add(session, bobId);
        var sent = await SendInSessionAsync(factory.As(bobId), session);

        Assert.Equal(HttpStatusCode.Forbidden, (await factory.As(bobId).DeleteAsync($"/conversations/{sent.ConversationId}")).StatusCode);
        Assert.Equal(1, (await PageAsync(factory.As(hostId), sent.ConversationId)).Total);

        Assert.Equal(HttpStatusCode.NoContent, (await factory.As(hostId).DeleteAsync($"/conversations/{sent.ConversationId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await factory.As(hostId).GetAsync($"/conversations/{sent.ConversationId}/messages")).StatusCode);
    }

    // Shares the one fake, so it can't run alongside other session tests.
    [Fact]
    public async Task WhenAnnotationStoreIsDown_SessionChatSaysSo_AndDirectMessagesCarryOn()
    {
        var local = new FakeSessions { Down = true };
        await using var downFactory = factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.AddSingleton<ISessionAccess>(local);
        }));
        var aliceId = NewUser("alice");
        HttpClient Client()
        {
            var client = downFactory.CreateClient();
            client.DefaultRequestHeaders.Add("X-Test-User", aliceId);
            client.DefaultRequestHeaders.TryAddWithoutValidation("Authorization", $"Bearer {aliceId}");
            return client;
        }

        var session = await Client().GetAsync($"/sessions/{Guid.NewGuid()}/conversation");
        var direct = await SendAsync(Client(), new { id = Guid.NewGuid(), toUserId = NewUser("bob"), body = "hi" });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, session.StatusCode);
        Assert.Equal(HttpStatusCode.Created, direct.StatusCode);
    }

    // --- At the same moment ---------------------------------------------

    [PostgresFact]
    public async Task FirstMessagesAtTheSameMoment_StillMakeOneConversation()
    {
        var (aliceId, bobId) = (NewUser("alice"), NewUser("bob"));

        var responses = await Task.WhenAll(Enumerable.Range(0, 10).Select(i =>
            i % 2 == 0
                ? SendAsync(factory.As(aliceId), new { id = Guid.NewGuid(), toUserId = bobId, body = $"a{i}" })
                : SendAsync(factory.As(bobId), new { id = Guid.NewGuid(), toUserId = aliceId, body = $"b{i}" })));

        Assert.All(responses, r => Assert.Equal(HttpStatusCode.Created, r.StatusCode));
        var conversation = Assert.Single(await ListAsync(factory.As(aliceId)));
        Assert.Equal(10, (await PageAsync(factory.As(aliceId), conversation.Id)).Total);
    }

    [PostgresFact]
    public async Task OpeningASessionsChat_AtTheSameMoment_MakesOne()
    {
        var session = Guid.NewGuid();
        var alice = NewUser("alice");
        factory.Sessions.Add(session, alice);

        var views = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => factory.As(alice).GetFromJsonAsync<ConversationView>($"/sessions/{session}/conversation", Json)));

        Assert.Single(views.Select(v => v!.Id).Distinct());
    }

    [PostgresFact]
    public async Task TheSameMessage_SentTwiceAtOnce_IsOneMessage()
    {
        var alice = NewUser("alice");
        var body = new { id = Guid.NewGuid(), toUserId = NewUser("bob"), body = "hi" };

        var responses = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => SendAsync(factory.As(alice), body)));

        Assert.All(responses, r => Assert.Contains(r.StatusCode, new[] { HttpStatusCode.Created, HttpStatusCode.OK }));
        var sent = (await responses[0].Content.ReadFromJsonAsync<MessageView>(Json))!;
        Assert.Equal(1, (await PageAsync(factory.As(alice), sent.ConversationId)).Total);
    }
}
