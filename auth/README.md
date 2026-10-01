# auth

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
- **Test users** (password `password` for all three):

| Username | Name        |
| -------- | ----------- |
| alice    | Alice Moore |
| bob      | Bob Hughes  |
| carol    | Carol Singh |
