using AnnotationStore.Auth;

namespace AnnotationStore.Tests;

public class KeycloakAuthTests
{
    [Theory]
    [InlineData("https://localhost:5173/auth/realms/diss")]
    [InlineData("https://192.168.108.44:5173/auth/realms/diss")]
    [InlineData("http://localhost:8080/auth/realms/diss/")]
    public void IsRealmIssuer_AcceptsTheRealm_WhateverAddressItWasReachedOn(string issuer) =>
        Assert.True(KeycloakAuth.IsRealmIssuer(issuer, "diss"));

    [Theory]
    [InlineData("https://localhost:5173/auth/realms/other")]
    [InlineData("https://localhost:5173/auth/realms/diss-evil")]
    [InlineData("ftp://localhost/auth/realms/diss")]
    [InlineData("not a url")]
    public void IsRealmIssuer_RejectsAnythingElse(string issuer) =>
        Assert.False(KeycloakAuth.IsRealmIssuer(issuer, "diss"));
}
