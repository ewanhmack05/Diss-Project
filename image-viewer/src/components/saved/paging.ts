// How many rows a Saved list shows per page - change it here for both the
// annotations and cell counts lists. annotation-store caps a page at 500.
const SAVED_PAGE_SIZE = 50

interface Saved {
  id: string
  created: string
}

// The server writes "+00:00" and microseconds, a fresh local save writes
// "Z" and milliseconds, so these compare as times, not strings.
function time(item: Saved): number {
  const parsed = Date.parse(item.created)
  return Number.isNaN(parsed) ? -Infinity : parsed
}

function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

// Keeps a page number inside what's there - deleting the last row on the
// last page shouldn't leave you looking at an empty page past the end.
function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(0, page), pageCount(total, pageSize) - 1)
}

// GET /annotations or /cellcounts for one page, and /total for the same
// search, so the page count matches what the search finds.
function pageUrls(
  baseUrl: string,
  path: 'annotations' | 'cellcounts',
  collectionId: string,
  page: number,
  pageSize: number,
  search: string,
): { page: string; total: string } {
  const query = new URLSearchParams({ collectionId })
  const term = search.trim()
  if (term) query.set('search', term)
  const paged = new URLSearchParams(query)
  paged.set('skip', String(page * pageSize))
  paged.set('take', String(pageSize))
  return {
    page: `${baseUrl}/${path}?${paged}`,
    total: `${baseUrl}/${path}/total?${query}`,
  }
}

interface PageView<T> {
  items: T[]
  total: number
}

// What a fetched page should show right now. The page was right when it
// arrived, but things move on before the next fetch lands:
// - an edit shows straight away - the store's copy wins over the fetched one
// - a delete drops out straight away
// - something saved since (yours, or someone else's) goes to the top of the
//   first page - newest first means that's where the server will put it.
//   Only without a search, since whether it matches is the server's call.
// The next fetch, once the save settles, puts it all back in step.
function mergePage<T extends Saved>({
  fetched,
  total,
  live,
  isDeleted,
  page,
  search,
  pageSize,
}: {
  fetched: T[]
  total: number
  live: T[]
  isDeleted: (id: string) => boolean
  page: number
  search: string
  pageSize: number
}): PageView<T> {
  const liveById = new Map(live.map((item) => [item.id, item]))
  const kept = fetched.filter((item) => !isDeleted(item.id)).map((item) => liveById.get(item.id) ?? item)
  const removed = fetched.length - kept.length

  let added: T[] = []
  if (page === 0 && !search.trim()) {
    const fetchedIds = new Set(fetched.map((item) => item.id))
    // Compared against the oldest row on the page, not the newest - a fresh
    // save is stamped by this machine's clock, the fetched rows by the
    // server's, and the two can be a little apart. Strictly newer: times
    // here are to the millisecond and the server's to the microsecond, so a
    // row from the next page can share the oldest row's millisecond. A
    // short page holds everything there is, so anything missing belongs on it.
    const oldestFetched = fetched.length < pageSize ? -Infinity : time(fetched[fetched.length - 1])
    added = live
      .filter((item) => !fetchedIds.has(item.id) && !isDeleted(item.id) && time(item) > oldestFetched)
      .sort((a, b) => time(b) - time(a))
  }

  const items = [...added, ...kept].slice(0, pageSize)
  return { items, total: Math.max(items.length, total + added.length - removed) }
}

export { SAVED_PAGE_SIZE, pageCount, clampPage, pageUrls, mergePage }
export type { PageView }
