"""Keycloak's admin API, for the dev scripts that make or remove test users.
Signs in as the master realm's admin through admin-cli, which does allow a
password grant. The defaults are the dev admin from auth/docker-compose.yml.
Standard library only.
"""
import json
import urllib.error
import urllib.parse
import urllib.request

PAGE = 100


def admin_token(keycloak, username, password):
    form = urllib.parse.urlencode({"grant_type": "password", "client_id": "admin-cli",
                                   "username": username, "password": password}).encode()
    try:
        with urllib.request.urlopen(f"{keycloak.rstrip('/')}/realms/master/protocol/openid-connect/token", form) as response:
            return json.load(response)["access_token"]
    except urllib.error.HTTPError as error:
        if error.code == 401:
            raise SystemExit("Keycloak turned down the admin sign-in - check --admin-user / --admin-password") from None
        raise


def _admin(keycloak, realm, token, path, method="GET", body=None):
    req = urllib.request.Request(f"{keycloak.rstrip('/')}/admin/realms/{realm}{path}",
                                 json.dumps(body).encode() if body is not None else None,
                                 {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                                 method=method)
    try:
        with urllib.request.urlopen(req) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        if error.code in (404, 409):
            return error.code, None
        raise


def list_users(keycloak, realm, token):
    """Every user in the realm, a page at a time."""
    users, first = [], 0
    while True:
        _, page = _admin(keycloak, realm, token, f"/users?first={first}&max={PAGE}&briefRepresentation=true")
        users.extend(page)
        if len(page) < PAGE:
            return users
        first += PAGE


def create_user(keycloak, realm, token, user):
    """True if it was made, False if there's one with that username already."""
    status, _ = _admin(keycloak, realm, token, "/users", "POST", user)
    return status == 201


def delete_user(keycloak, realm, token, user_id):
    """True if it was deleted, False if it had gone already."""
    status, _ = _admin(keycloak, realm, token, f"/users/{user_id}", "DELETE")
    return status == 204


def add_admin_args(parser):
    parser.add_argument("--admin-user", default="admin", help="Keycloak admin (default: auth/docker-compose.yml's)")
    parser.add_argument("--admin-password", default="admin", help="their password (default: auth/docker-compose.yml's)")
