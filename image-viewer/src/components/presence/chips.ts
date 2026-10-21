import type { Participant } from '../realtime/realtime'

// Who gets a chip on the bar and who's behind "+N more". A small session
// shows everyone. A large one shows just the people who can edit, the host
// first - the session's editor cap keeps that to a handful - and everyone
// watching is in the list "+N more" opens.
function splitChips(others: Participant[], large: boolean): { visible: Participant[]; more: Participant[] } {
  if (!large) return { visible: others, more: [] }
  const editors = others.filter((p) => p.canEdit || p.host)
  return {
    visible: [...editors.filter((p) => p.host), ...editors.filter((p) => !p.host)],
    more: others.filter((p) => !p.canEdit && !p.host),
  }
}

// Everyone once each, by name - someone in two tabs is two connections but
// one person, with one box setting.
function peopleByName(others: Participant[]): Participant[] {
  const seen = new Set<string>()
  return others
    .filter((p) => !seen.has(p.userId) && seen.add(p.userId))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }))
}

function matchesName(participant: Participant, search: string): boolean {
  const term = search.trim().toLowerCase()
  return term === '' || participant.displayName.toLowerCase().includes(term)
}

export { splitChips, peopleByName, matchesName }
