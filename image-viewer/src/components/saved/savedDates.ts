// Dates for the saved lists - short on the row ("30 Sep", with the year
// only when it isn't this year), in full when a row is opened.

function toDate(iso: string): Date | null {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatShortDate(iso: string, now: Date = new Date()): string {
  const date = toDate(iso)
  if (!date) return ''
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

function formatLongDate(iso: string): string {
  const date = toDate(iso)
  if (!date) return 'Unknown'
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day}, ${time}`
}

// Newest first, by `created`. The server sends them in this order too, but
// anything saved since (yours or someone else's, live) is added to the end
// of the list, so the lists sort for themselves. Unreadable dates go last.
function newestFirst<T extends { created: string }>(items: T[]): T[] {
  const time = (item: T) => toDate(item.created)?.getTime() ?? -Infinity
  return [...items].sort((a, b) => time(b) - time(a))
}

export { formatShortDate, formatLongDate, newestFirst }
