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
  mints a short-lived signed token (a guest id, the session id and an
  expiry) when someone opens the invite link without an account. Keycloak
  only handles real accounts. Built - see [guests.md](guests.md).
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

### Collaberation

2 options for Cell Count:

- **Shared Count** - multiple users working on the same count, can work in different areas of the slide, all tallying to the same count
- **Comparison Count** - multiple users work on the same area, and then their final counts are compared to eachother (e.g. overlapping dots or areas without dots)

Both are built - see [comparison count](breakdown/realtime-hub.md#8-comparison-count) and [shared count](breakdown/realtime-hub.md#9-shared-count).

### Shared vs personal

Collections hold annotations, cell counts and image adjustments - decide
which are shared in a session. Likely: annotations shared, image
adjustments personal, cell counts either way.

### Collections

The viewer has to work on its own and together, so there are two kinds:

- **Personal** - made automatically, one per person per slide. Working
  alone you're always in this, with no room and nothing to pick.
- **Joint** - made when a session starts from an invite link. Everyone who
  opens the link and signs in is added as a member, and the realtime room
  *is* that collection, so everyone in the room works in the same one.

Image adjustments always stay in the personal collection.

#### Where it's at

Built - the Collaboration tab holds it:

- **Working alone** - your personal collection, no room, no connection to
  the hub. The tab offers "Start a session" and Join with a code. Your
  sessions on the slide, to rejoin or look back at, are in the Collections
  tab, next to other people's shared personal collections.
- **Hosting** - one invite link at a time: copy it, choose whether people
  who join can edit or only view, and how long it lasts (1 hour, a day, a
  week). Making a new link stops the old one, and it can be stopped any
  time. The host can change people's roles or take them out, and end the
  session - it's then read-only for everyone but kept to look back at.
- **Joining** - opening a link signs you in (keeping the link through the
  trip to Keycloak), shows who invited you and to what, then joins.
- **The room is the session** - the hub asks annotation-store before
  letting anyone in, so there's no per-slide room any more, and the "Add"
  button, "Working in" picker and per-change collection check are gone.
- Invite codes are kept by annotation-store rather than minted by the hub,
  since that's where memberships already live.
- "Session controls" (who can draw, who can start counts, and the
  Free / Follow me / Present navigation from above) are in the tab, greyed
  out, for later.

Sessions are one slide each for now - whether one should span several (a
case) is still open.


### User inputs
Since one of the usecases for this is students working and learning during lectures,
im looking into adding profanity filtering alongside basic filtering like SQL or HTML.

Current package ideas:
https://www.npmjs.com/package/obscenity
https://www.npmjs.com/package/allprofanity

Leaning towards obscenity due to the higher downloads
User inputs will be run through this profanity filter and flagged up before it is sent anywhere - frontend only
Some names will need sorted in a whitelisting, e.g. `Dick`as its both a curse word and a name. 
Im avoiding letting these input names be saved anywhere, as that will cause ethical issues. Im thinking that guest users will be locked down to a view only, and then will be prompted to make an account if they want to write/edit or are invited to edit by the owner of the session

#### Where it's at

Built for guest names - details in [guests.md](guests.md):

- **obscenity** it is - 1.5M downloads a month against allprofanity's 5k.
  Checked in the viewer before the name goes anywhere
  ([textFilter.ts](../image-viewer/src/textFilter.ts)).
- **Basic filtering** - only letters, numbers, spaces and `- _ . '` in a
  name, checked in the viewer and again on the hub. That keeps out the
  characters SQL and HTML need. Nothing a guest types reaches the database
  anyway.
- **Whitelisting** - "Dick" is allowed as a whole word, as are real names
  with a rude word inside (Dickinson, Cumming, Penistone...), found by
  testing 50 surnames. 12 of them were blocked before.
- **Not saved** - the name isn't in the guest's token, only the hub's room
  holds it, and annotation-store never sees it. Guests are view only with
  no member row.
- **Making an account to edit** - from the guest's own tab, or when the host
  presses "Ask to edit" next to them. They come back to the same link
  signed in.
- Other text (labels, notes) isn't filtered yet - `isClean` and
  `censorText` are there for it.
