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

// The same limits as annotation-store's SessionSize - it turns anything
// outside them down.
const DEFAULT_MAX_EDITORS = 6
const LEAST_MAX_EDITORS = 1
const MOST_MAX_EDITORS = 50

// The viewer's maxEditors option, kept inside the limits - it's only the
// number the box starts at.
function defaultMaxEditors(option: number | undefined): number {
  if (option === undefined || !Number.isFinite(option)) return DEFAULT_MAX_EDITORS
  return Math.min(MOST_MAX_EDITORS, Math.max(LEAST_MAX_EDITORS, Math.round(option)))
}

// What the host typed, or null if it isn't a whole number inside the limits.
function readMaxEditors(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value >= LEAST_MAX_EDITORS && value <= MOST_MAX_EDITORS ? value : null
}

function sessionSize(members: Pick<CollectionMember, 'role'>[], maxEditors: number): SessionSize {
  const editors = members.filter((m) => m.role === 'editor' || m.role === 'owner').length
  return { editors, maxEditors, full: editors >= maxEditors, large: members.length > maxEditors }
}

export { DEFAULT_MAX_EDITORS, LEAST_MAX_EDITORS, MOST_MAX_EDITORS, defaultMaxEditors, readMaxEditors, sessionSize }
export type { SessionSize }
