import { timeAgo } from '../saved/savedDates'

// What happens when two people change the same thing in a session - picked
// by the host when they start it, and saved on it. See annotation-store's
// Conflicts/EditConflicts.cs. Only colour, group, and a group's name and
// notes can conflict: labels and notes on annotations and counts are merged
// live, so nobody loses typing either way.
type EditPolicy = 'lastWriteWins' | 'firstComeWins'

const DEFAULT_EDIT_POLICY: EditPolicy = 'lastWriteWins'

const EDIT_POLICY_CHOICES: { policy: EditPolicy; label: string; note: string }[] = [
  {
    policy: 'lastWriteWins',
    label: 'Last change wins',
    note: "If two people change the same colour or group, the later change stays and the earlier one's gone.",
  },
  {
    policy: 'firstComeWins',
    label: 'First change wins',
    note: "If two people change the same colour or group, the second is asked whether to keep theirs or the first person's.",
  },
]

// The viewer's editPolicy option - only what the start box begins at.
function defaultEditPolicy(option: unknown): EditPolicy {
  return option === 'firstComeWins' || option === 'lastWriteWins' ? option : DEFAULT_EDIT_POLICY
}

// A 409 from annotation-store: the row as it is now, and who last changed
// the fields in the way.
interface Conflict {
  entity: string
  id: string
  current: Record<string, unknown>
  changedBy: string | null
  changedAt: string | null
  changed: string[]
}

function readConflict(body: unknown): Conflict | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (typeof b.id !== 'string' || !b.current || typeof b.current !== 'object') return null
  return {
    entity: typeof b.entity === 'string' ? b.entity : '',
    id: b.id,
    current: b.current as Record<string, unknown>,
    changedBy: typeof b.changedBy === 'string' ? b.changedBy : null,
    changedAt: typeof b.changedAt === 'string' ? b.changedAt : null,
    changed: Array.isArray(b.changed) ? b.changed.filter((c): c is string => typeof c === 'string') : [],
  }
}

const FIELD_NAMES: Record<string, string> = { Colour: 'colour', GroupId: 'group', Name: 'name', Notes: 'notes' }

function listed(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// "Bob changed the colour of Region 4 2 minutes ago".
function conflictMessage(conflict: Conflict, what: string, now: Date = new Date()): string {
  const fields = listed(conflict.changed.map((c) => FIELD_NAMES[c] ?? c.toLowerCase()))
  const who = conflict.changedBy ?? 'Someone'
  const when = conflict.changedAt ? ` ${timeAgo(conflict.changedAt, now).toLowerCase()}` : ''
  return `${who} changed ${fields ? `the ${fields} of ` : ''}${what}${when}, before your change got there.`
}

// "2 of 10 were changed by Bob first, so they were left as they are."
function bulkConflictMessage(conflicts: { changedBy: string | null }[], total: number): string {
  const people = [...new Set(conflicts.map((c) => c.changedBy ?? 'someone else'))]
  const by = people.length > 2 ? `${people.length} other people` : listed(people)
  const n = conflicts.length
  const which = n === total ? (total === 1 ? 'It was' : `All ${total} were`) : `${n} of ${total} ${n === 1 ? 'was' : 'were'}`
  return `${which} changed by ${by} first, so ${n === 1 ? 'it was left as it is' : 'they were left as they are'}.`
}

// Under first come wins a change goes out to everyone else only once it's
// saved, so nobody sees one that's then turned down. Last change wins sends
// straight away, as it always did - the delay is part of what's compared.
function sendsAfterSave(policy: EditPolicy): boolean {
  return policy === 'firstComeWins'
}

// Saves to one item one at a time, so a save never starts from a value an
// earlier save of yours hasn't stored yet - otherwise dragging the colour
// picker could conflict with itself.
function oneAtATime() {
  const queues = new Map<string, Promise<unknown>>()
  return <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const previous = queues.get(key) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(run)
    queues.set(key, next)
    void next.finally(() => {
      if (queues.get(key) === next) queues.delete(key)
    }).catch(() => {})
    return next
  }
}

export {
  DEFAULT_EDIT_POLICY,
  EDIT_POLICY_CHOICES,
  defaultEditPolicy,
  readConflict,
  conflictMessage,
  bulkConflictMessage,
  sendsAfterSave,
  oneAtATime,
}
export type { EditPolicy, Conflict }
