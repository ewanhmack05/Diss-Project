# auth

[![auth](https://github.com/ewanhmack05/Diss-Project/actions/workflows/auth.yml/badge.svg)](https://github.com/ewanhmack05/Diss-Project/actions/workflows/auth.yml)

Keycloak for sign-in, run locally in Docker. See
[docs/auth.md](../docs/auth.md) for why Keycloak and how it connects to the
rest.

## Running

```bash
cd auth/
docker compose up -d
```

First start takes a minute (it pulls the images and imports the realm).
Keycloak brings its own Postgres container, so nothing needs setting up on
the machine's Postgres.

- Admin console: http://localhost:8080/auth/admin - `admin` / `admin`
- The viewer reaches it through its own dev server at `/auth`, so other
  machines only need the viewer's port.

## Realm

`realm/diss-realm.json` is imported the first time Keycloak starts, and
skipped after that while the realm exists. To pick up changes to the file,
delete the realm in the admin console (or `docker compose down -v`) and
start it again.

- **Realm:** `diss`
- **Client:** `image-viewer` - public, sign-in with PKCE. Its redirect
  address is relative (`/*`), so it works from localhost, the LAN or the VPN
  without listing each address. Access tokens carry the audience `diss-api`,
  which annotation-store and the realtime hub check for.
- **Client:** `realtime-hub` - confidential, no sign-in of its own. Its
  service account only has `view-users`, which realtime-hub uses to list
  everyone for the viewer's Users tab. The secret is a dev one,
  `realtime-hub-dev-secret`, also in realtime-hub's `appsettings.json`.
  An older Keycloak won't have it - see
  [Adding the realtime-hub client](#adding-the-realtime-hub-client).
- **Test users** (password `password` for all three):

| Username | Name        |
| -------- | ----------- |
| alice    | Alice Moore |
| bob      | Bob Hughes  |
| carol    | Carol Singh |

## Adding the realtime-hub client

`add-realtime-hub-client.sh` adds the `realtime-hub` client to a Keycloak
that already has the `diss` realm. It's needed once on any Keycloak first
started before that client was in `realm/diss-realm.json` - the realm
import is skipped while the realm exists, so it never picks the client up.
Without it, realtime-hub can't read the user list and the viewer's Users
tab only shows who's online.

Run it from the repo root while Keycloak is running - Git Bash
on Windows is fine:

```bash
./auth/add-realtime-hub-client.sh
```

It signs in to Keycloak's admin CLI inside the `diss-keycloak` container
as `admin` / `admin`, then:

- adds the `realtime-hub` client (confidential, service account on, no
  sign-in flows, secret `realtime-hub-dev-secret`) if it isn't there
- gives its service account `view-users` from `realm-management`, and
  nothing else

Safe to run again - it skips the client if it's there, and adding a role
it already has does nothing. Both `docker compose` setups (this folder's
and the root one) name the container `diss-keycloak`, but they keep their
data in separate volumes, so each needs it once. For any other container
name, pass it: `./auth/add-realtime-hub-client.sh <container>`.

To check it worked, the hub's dev endpoint should list everyone:

```bash
curl http://localhost:5180/users
```

Not needed on a fresh Keycloak (or after `docker compose down -v`) - the
import brings the client in.

## Making an account

The realm lets people make their own account (`registrationAllowed`), for
guests who want to edit - see [docs/guests.md](../docs/guests.md). The
viewer sends them straight to Keycloak's sign-up page (`prompt=create`), and
back to the invite link after.

A Keycloak that imported the realm before that was switched on needs it
once, while it's running:

```bash
./auth/allow-sign-up.sh
```

Same as above - one container name or the other, safe to run again, not
needed on a fresh Keycloak.
