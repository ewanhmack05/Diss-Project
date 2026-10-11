// Who's online, and everyone with an account, as realtime-hub's presence
// hub gives them - see its Presence/PresenceMessages.cs.

// Where this viewer is. sessionId is the room it's in, if any.
interface PresenceWhere {
  slideId: string | null
  sessionId: string | null
  hosting: boolean
}

interface OnlineUser {
  userId: string
  displayName: string
  slideId: string | null
  sessionId: string | null
  hosting: boolean
  since: string
  version: number
}

interface UserOffline {
  userId: string
  version: number
}

interface OnlineSnapshot {
  users: OnlineUser[]
  version: number
}

interface UserInvite {
  fromUserId: string
  fromName: string
  code: string
  sent: string
}

// Someone with an account in Keycloak, online or not.
interface DirectoryUser {
  userId: string
  username: string
  displayName: string
}

// A row in the Users tab. online is null when they're not.
interface ListedUser {
  userId: string
  displayName: string
  online: OnlineUser | null
}

// What we last heard about each person, by user id. user is null once
// they've gone offline - kept so an older "online" that turns up late
// can't bring them back.
type PresenceState = Record<string, { version: number; user: OnlineUser | null }>

// Messages can overtake each other (another tab's change lands while the
// snapshot is on its way), so only something newer than what we have counts.
function applyOnline(state: PresenceState, user: OnlineUser): PresenceState {
  const known = state[user.userId]
  if (known && known.version >= user.version) return state
  return { ...state, [user.userId]: { version: user.version, user } }
}

function applyOffline(state: PresenceState, offline: UserOffline): PresenceState {
  const known = state[offline.userId]
  if (known && known.version >= offline.version) return state
  return { ...state, [offline.userId]: { version: offline.version, user: null } }
}

// Everyone in the snapshot, unless we've heard something newer. Anyone we
// had who isn't in it went offline before it was taken - unless what we
// heard about them is newer than it.
function applySnapshot(state: PresenceState, snapshot: OnlineSnapshot): PresenceState {
  let next: PresenceState = {}
  for (const [userId, known] of Object.entries(state)) {
    if (known.version > snapshot.version) next[userId] = known
  }
  for (const user of snapshot.users) next = applyOnline(next, user)
  return next
}

const byName = (a: { displayName: string }, b: { displayName: string }) =>
  a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })

// Everyone online but you, by name.
function onlineUsers(state: PresenceState, myUserId: string): OnlineUser[] {
  return Object.values(state)
    .flatMap((known) => (known.user && known.user.userId !== myUserId ? [known.user] : []))
    .sort(byName)
}

// Everyone but you - online first, then everyone else, each by name. The
// directory is null if it couldn't be loaded, which leaves just who's
// online. Anyone online who isn't in it yet (an account made since it was
// fetched) is still listed.
function listUsers(directory: DirectoryUser[] | null, state: PresenceState, myUserId: string): ListedUser[] {
  const online = onlineUsers(state, myUserId)
  const onlineIds = new Set(online.map((u) => u.userId))
  const offline = (directory ?? [])
    .filter((u) => u.userId !== myUserId && !onlineIds.has(u.userId))
    .map((u) => ({ userId: u.userId, displayName: u.displayName || u.username, online: null }))
    .sort(byName)
  return [...online.map((u) => ({ userId: u.userId, displayName: u.displayName, online: u })), ...offline]
}

// Same shape annotation-store makes them (url-safe base64), and the most
// realtime-hub will pass on.
const CODE_SHAPE = /^[A-Za-z0-9_-]{1,64}$/

// The invite code from whatever was pasted or typed - the code on its own,
// or a whole invite link with it on the end as ?invite=. Null if neither.
function inviteCodeFrom(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (CODE_SHAPE.test(trimmed)) return trimmed
  try {
    const code = new URL(trimmed).searchParams.get('invite')?.trim()
    return code && CODE_SHAPE.test(code) ? code : null
  } catch {
    return null
  }
}

// What someone's doing, in a few words, from where you are.
function describeUser(user: OnlineUser | null, me: { slideId: string; sessionId: string | null }): string {
  if (!user) return 'Offline'
  if (!user.slideId) return 'Just signed in'
  if (me.sessionId && user.sessionId === me.sessionId) return 'In your session'
  const what = user.hosting ? 'Hosting a session' : user.sessionId ? 'In a session' : 'Working alone'
  return user.slideId === me.slideId ? `${what} · this slide` : `${what} · slide ${user.slideId}`
}

// Why you can't invite them, or null if you can. Only the host invites, only
// someone online can be asked, and a session is on one slide - anyone on
// another couldn't open it here.
function whyCantInvite(
  user: OnlineUser | null,
  me: { slideId: string; sessionId: string | null; hosting: boolean }
): string | null {
  if (!me.hosting || !me.sessionId) return 'Host a session to invite people'
  if (!user) return "They're offline"
  if (user.sessionId === me.sessionId) return "They're already in it"
  if (user.slideId !== me.slideId) return "They're on another slide"
  return null
}

export {
  applyOnline,
  applyOffline,
  applySnapshot,
  onlineUsers,
  listUsers,
  inviteCodeFrom,
  describeUser,
  whyCantInvite,
}
export type {
  PresenceWhere,
  OnlineUser,
  UserOffline,
  OnlineSnapshot,
  UserInvite,
  DirectoryUser,
  ListedUser,
  PresenceState,
}
