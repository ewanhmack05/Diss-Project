import type { CollectionMember } from '../../context/CollectionContext'

// Small vs large sessions, worked out the same way as annotation-store's
// SessionSize: at most maxEditors people editing, the host included. Past
// that, people joining come in view only, and the session is "large".
interface SessionSize {
  editors: number
  maxEditors: number
  // No editor places left - an edit link lets people in view only.
  full: boolean
  // More people than could all edit.
  large: boolean
}

function sessionSize(members: Pick<CollectionMember, 'role'>[], maxEditors: number): SessionSize {
  const editors = members.filter((m) => m.role === 'editor' || m.role === 'owner').length
  return { editors, maxEditors, full: editors >= maxEditors, large: members.length > maxEditors }
}

export { sessionSize }
export type { SessionSize }
