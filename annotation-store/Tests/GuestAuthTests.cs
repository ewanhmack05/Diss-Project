using System.Security.Claims;
using AnnotationStore.Auth;

namespace AnnotationStore.Tests;

public class GuestAuthTests
{
    [Fact]
    public void SigningKey_TakesThirtyTwoBytesOfBase64() =>
        Assert.Equal(32, GuestAuth.SigningKey(Convert.ToBase64String(new byte[32])).Key.Length);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not base64!")]
    [InlineData("AAAA")]
    public void SigningKey_TurnsDownAnythingElse(string? key) =>
        Assert.Throws<InvalidOperationException>(() => GuestAuth.SigningKey(key));

    private static ClaimsPrincipal With(params (string Type, string Value)[] claims) =>
        new(new ClaimsIdentity(claims.Select(c => new Claim(c.Type, c.Value)), GuestAuth.Scheme));

    [Fact]
    public void IsGuestShaped_WantsAGuestIdAndASession()
    {
        var session = Guid.NewGuid().ToString();
        Assert.True(GuestAuth.IsGuestShaped(With(("sub", "guest-abc"), (GuestAuth.SessionClaim, session))));
        Assert.False(GuestAuth.IsGuestShaped(With(("sub", "alice"), (GuestAuth.SessionClaim, session))));
        Assert.False(GuestAuth.IsGuestShaped(With(("sub", "guest-abc"))));
        Assert.False(GuestAuth.IsGuestShaped(With(("sub", "guest-abc"), (GuestAuth.SessionClaim, "nope"))));
        Assert.False(GuestAuth.IsGuestShaped(With(("sub", "guest-abc"), (GuestAuth.SessionClaim, session), ("name", "Someone"))));
    }

    [Fact]
    public void GuestSessionId_IsOnlyForGuests()
    {
        var session = Guid.NewGuid();
        var guest = With(("sub", "guest-abc"), (GuestAuth.SessionClaim, session.ToString()));
        var keycloak = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim("sub", "guest-abc"), new Claim(GuestAuth.SessionClaim, session.ToString())], "Bearer"));

        Assert.True(guest.IsGuest());
        Assert.Equal(session, guest.GuestSessionId());
        Assert.False(keycloak.IsGuest());
        Assert.Null(keycloak.GuestSessionId());
    }
}
