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

### What's built

Keycloak is in, locally, and everything needs signing in.

- **Keycloak** runs in Docker from [auth/](../auth) - `docker compose up -d`.
  It has its own Postgres container rather than a second database on the
  machine's Postgres, so it needs no setup there. Realm `diss`, client
  `image-viewer`, test users alice / bob / carol.
- **One address for everything.** The viewer's dev server proxies `/auth`
  to Keycloak like it does the other services, and serves https (a
  self-signed certificate). Sign-in uses the browser's crypto, which only
  works on https or localhost, so without it nobody on the VPN could sign
  in. Keycloak follows the address the browser used, so the token's issuer
  is `https://<that address>:5173/auth/realms/diss` - the services accept
  any address as long as it's the `diss` realm and the signature checks out.
- **Viewer** - `oidc-client-ts`, sign-in with PKCE, tokens per tab so two
  tabs can be two people ("Switch user" in the RealTime panel).
- **annotation-store** checks the token on every request (`AddJwtBearer`),
  with the audience `diss-api`.
- **Real-time hub** checks the same token, sent in the query string.
  Participants' names are their Keycloak names now, not "Guest xxxx".
- **Collections** - `UserId` is the Keycloak `sub`. Shared collections came
  in at the same time, since everyone having been `'001'` was the only
  reason collaborators saw each other's work after a reload: a
  `CollectionMembers` table (collection, user, role - owner / editor /
  viewer). Everyone has their own collection per slide, and people work
  together in sessions joined through invite links - see
  [thought-process.md](thought-process.md#collections).

### Still to do

- Invite links for people without an account (guests) - links need a
  signed-in user for now.

### Invites
- Users list
    - The RealTime tab has a Users tab listing everyone with an account in Keycloak - who's online first, with what they're doing, then everyone offline
    - The host can invite anyone online on the same slide straight from it - they get a popup and see the invite before joining
    - The list comes from Keycloak's admin API, read by realtime-hub as the `realtime-hub` client, whose service account can only view users (see [auth/README.md](../auth/README.md#adding-the-realtime-hub-client))
- Generated link
    - The host makes a link in the RealTime tab, e.g. https://localhost:5173/?invite=juyhsUFHC4gB
- Invite codes
    - The code is the part after `?invite=` (`juyhsUFHC4gB` above), shown on its own under the link
    - Working alone, anyone can type or paste it (or the whole link) into Join with a code in the RealTime tab to join the session
