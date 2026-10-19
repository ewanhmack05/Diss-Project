import type { CollectionMember } from '../../context/CollectionContext'

// Small vs large sessions, worked out the same way as annotation-store's
// SessionSize: an edit link lets in maxEditors editors, the host included,
// and anyone after that joins view only. The host can still make more. The
// session is "large" once it has more people than that.
interface SessionSize {
  editors: number
  maxEditors: number
  // As many editors as an edit link lets in - anyone joining now is view
  // only. Can be more than maxEditors if the host made more.
  full: boolean
  // More people than an edit link lets in as editors.
  large: boolean
}

function sessionSize(members: Pick<CollectionMember, 'role'>[], maxEditors: number): SessionSize {
  const editors = members.filter((m) => m.role === 'editor' || m.role === 'owner').length
  return { editors, maxEditors, full: editors >= maxEditors, large: members.length > maxEditors }
}

export { sessionSize }
export type { SessionSize }
