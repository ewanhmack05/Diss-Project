import type { Participant } from './realtime'

type ActiveKind = 'host' | 'editor' | 'viewer' | 'guest'

// Someone in the session's room right now - from the hub, so guests are in
// it too, unlike the session's members.
interface ActiveUser {
  userId: string
  name: string
  colour: string
  kind: ActiveKind
  me: boolean
  // More than one if they've got it open in more than one tab.
  connectionIds: string[]
}

const ORDER: Record<ActiveKind, number> = { host: 0, editor: 1, viewer: 2, guest: 3 }

function kindOf(participant: Participant): ActiveKind {
  if (participant.guest) return 'guest'
  if (participant.host) return 'host'
  return participant.canEdit ? 'editor' : 'viewer'
}

// One row per person, the host first, then editors, viewers and guests, by
// name. A person in two tabs is one row, with the most they can do in
// either - the other tab may not have caught up with a role change yet.
function activeUsers(me: Participant | null, others: Participant[]): ActiveUser[] {
  const byUser = new Map<string, ActiveUser>()
  for (const participant of me ? [me, ...others] : others) {
    const kind = kindOf(participant)
    const isMe = participant.userId === me?.userId
    const seen = byUser.get(participant.userId)
    if (!seen) {
      byUser.set(participant.userId, {
        userId: participant.userId,
        name: participant.displayName,
        colour: participant.colour,
        kind,
        me: isMe,
        connectionIds: [participant.connectionId],
      })
      continue
    }
    seen.connectionIds.push(participant.connectionId)
    if (ORDER[kind] < ORDER[seen.kind]) seen.kind = kind
  }
  return [...byUser.values()].sort(
    (a, b) => ORDER[a.kind] - ORDER[b.kind] || a.name.localeCompare(b.name, undefined, { numeric: true })
  )
}

// People with an account, and guests - shown apart, each still in the order
// activeUsers puts them in.
function splitActive(users: ActiveUser[]): { signedIn: ActiveUser[]; guests: ActiveUser[] } {
  return { signedIn: users.filter((u) => u.kind !== 'guest'), guests: users.filter((u) => u.kind === 'guest') }
}

export { activeUsers, splitActive }
export type { ActiveKind, ActiveUser }
