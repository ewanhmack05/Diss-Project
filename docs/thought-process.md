# Thought process - sessions and connections

Figure out connections - how will 2 users start the connection with each
other?

## Options

- URL given out for session?
- Session string given out, e.g. 4 digit connection code fed into a panel?
- List of users currently online and a `request to connect` system?

## My thoughts

- 2 types of user, authenticated and unauthenticated
- To invite authenticated, we can use a basic user list (this can be supplied by either a self built user management or Keycloak - probably just first name and last name, keep emails hidden)
- To invite unauthenticated, we can share a short lifetime URL
- Host will have control over view only and ability to draw
- Host can kick/remove users
- Navigation? Will the owner's navigation be the law, or will each user navigate on their own? Is this something the owner can control? As a streaming rather than collaboration

## Where it's at

- **A session is tied to a slide** - invites just add people to that room.
- **Guest links don't need the identity provider** - the real-time hub
  mints a short-lived signed token (JWT with `role=guest`, session id,
  expiry) and puts it in the URL. Keycloak only handles real accounts.
- **Host/editor/viewer roles live in our own app**, per session - not in
  Keycloak, since they're session-specific rather than global.
- The 4-digit code is a nice extra, but the link is what people will use.
  The online-users list needs app-wide presence, so it's a later extra.

### Navigation as a mode, not a rule

- **Free** - everyone navigates on their own; other users' viewports show
  as coloured rectangles on the overview map.
- **Follow** - a user chooses to follow someone and their view mirrors that
  person's centre/zoom/rotation.
- **Present** - the host forces everyone to follow them.

All three run on the same data: each user's viewport broadcast over the
real-time channel, throttled to ~10 updates/sec.

### Shared vs personal

Collections hold annotations, cell counts and image adjustments - decide
which are shared in a session. Likely: annotations shared, image
adjustments personal, cell counts either way.
