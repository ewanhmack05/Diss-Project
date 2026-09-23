# Auth

Set up auth, look into:

- ory
- authentik
- keycloak

Users will theoretically be handled by the auth and/or Azure. Auth needs to
come in early - user accounts link up with collections, users will have
collections, and then there'll be shared/collaborative collections with
multiple owners.

## Where it's at

Leaning **Keycloak** over Entra External ID.

| | Keycloak | Entra External ID |
|---|---|---|
| Local dev | same container on this machine | always the cloud tenant |
| Portability | runs anywhere | tied to Azure |
| Invite list (first/last name, emails hidden) | admin REST API with a service account | Microsoft Graph, more setup |
| Config as code | realm exported to JSON, imported on start | portal clicks or scripts |
| Cost | its own container, plus a database in Postgres | free |
| Upkeep | ours - upgrades, security patches | none |

### How it connects to what's here

1. **Viewer** - sign in with OIDC + PKCE (`oidc-client-ts`).
2. **annotation-store** - validates the token on each request (`AddJwtBearer`, pointed at the realm).
3. **Collections** - `PLACEHOLDER_USER_ID = '001'` becomes the Keycloak user's `sub`. `UserId` is already a string, so no schema change.
4. **Real-time hub** - WebSockets can't send the usual auth header, so the token goes in the query string.
5. **Guest links** - issued by our own hub, not Keycloak (see [thought-process.md](thought-process.md)).
6. **Shared collections** - need a membership table (`collection_id`, `user_id`, `role`) rather than a single owner column.

### Running it

- Needs its own database - a second one on the same Postgres, not Keycloak's built-in H2.
- Java: starts in ~10-30s and uses 512 MB-1 GB, so keep one copy always running rather than scaling to zero.
- Behind a proxy it needs `KC_PROXY_HEADERS=xforwarded`, `KC_HOSTNAME`, and plain HTTP enabled.
- Run `kc.sh build` in the image so it starts faster.

### Next steps (all local)

1. Keycloak in a local compose file (dev mode), with a realm file and 2-3 test users - ~2-3 hours
2. Viewer login + replace the placeholder user id - ~half a day
3. Token checks in annotation-store, scoped to the logged-in user - ~half a day
