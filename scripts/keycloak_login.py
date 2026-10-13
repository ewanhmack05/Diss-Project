"""Signs in to Keycloak as a test user and returns an access token for
annotation-store, so the dev scripts can call it the way the viewer does.

The image-viewer client has password grant turned off, so this goes through
the same sign-in page a browser would: start a PKCE code flow, post the
username and password to the login form, catch the redirect carrying the
code, and swap the code for tokens. Standard library only.
"""
import base64
import hashlib
import html
import http.cookiejar
import json
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request

CLIENT_ID = "image-viewer"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def login_form_action(page):
    """The URL Keycloak's login page posts the username and password to."""
    match = re.search(r'<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"', page) \
        or re.search(r'<form[^>]*action="([^"]+)"[^>]*id="kc-form-login"', page)
    if not match:
        raise RuntimeError("No login form on Keycloak's sign-in page - is the realm imported?")
    return html.unescape(match.group(1))


def code_from_redirect(location):
    query = urllib.parse.parse_qs(urllib.parse.urlparse(location).query)
    if "code" not in query:
        error = query.get("error_description", query.get("error", ["no code in redirect"]))[0]
        raise RuntimeError(f"Keycloak didn't sign in: {error}")
    return query["code"][0]


def access_token(keycloak, realm, username, password):
    base = f"{keycloak.rstrip('/')}/realms/{realm}/protocol/openid-connect"
    # Keycloak resolves the client's relative redirect URI ("/*") against
    # its own address, so any path on it is accepted.
    redirect_uri = f"{keycloak.rstrip('/')}/scripts-callback"
    verifier, challenge = _pkce()

    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), _NoRedirect)
    auth_query = urllib.parse.urlencode({
        "client_id": CLIENT_ID, "response_type": "code", "scope": "openid",
        "redirect_uri": redirect_uri, "code_challenge": challenge, "code_challenge_method": "S256",
        "state": secrets.token_urlsafe(8),
    })
    with opener.open(f"{base}/auth?{auth_query}") as response:
        action = login_form_action(response.read().decode())
    # Keycloak marks its session cookies Secure even on plain http
    # localhost, and the cookie jar won't send Secure cookies back over
    # http, so the login post would arrive with no session.
    for cookie in jar:
        cookie.secure = False

    form = urllib.parse.urlencode({"username": username, "password": password}).encode()
    try:
        opener.open(action, form)
        raise RuntimeError(f"Wrong username or password for {username}")
    except urllib.error.HTTPError as redirect:
        if redirect.code not in (302, 303):
            raise
        code = code_from_redirect(redirect.headers["Location"])

    token_form = urllib.parse.urlencode({
        "grant_type": "authorization_code", "client_id": CLIENT_ID, "code": code,
        "redirect_uri": redirect_uri, "code_verifier": verifier,
    }).encode()
    with urllib.request.urlopen(f"{base}/token", token_form) as response:
        return json.load(response)["access_token"]


def add_login_args(parser):
    parser.add_argument("--keycloak", default="http://localhost:8080/auth", help="Keycloak URL (default: %(default)s)")
    parser.add_argument("--realm", default="diss", help="Keycloak realm (default: %(default)s)")
    parser.add_argument("--username", default="alice", help="test user to sign in as (default: %(default)s)")
    parser.add_argument("--password", default="password", help="their password (default: the test users' one)")
