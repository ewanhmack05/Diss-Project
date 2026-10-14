import { describe, expect, it } from 'vitest'
import { SAVED_PAGE_SIZE, clampPage, isFiltered, mergePage, pageCount, pageUrls } from './paging'
import { NO_FILTERS } from './filters'

interface Row {
  id: string
  created: string
  label?: string
  createdById?: string
  shape?: string
}

// Rows "r1".."rn", r1 the newest, a minute apart, in the server's format.
function rows(n: number, from = 1): Row[] {
  return Array.from({ length: n }, (_, i) => {
    const index = from + i
    return { id: `r${index}`, created: new Date(Date.UTC(2026, 9, 13, 12, 0) - index * 60_000).toISOString().replace('Z', '+00:00') }
  })
}

const none = () => false

describe('SAVED_PAGE_SIZE', () => {
  it('is within what annotation-store will hand back in one page', () => {
    expect(SAVED_PAGE_SIZE).toBeGreaterThan(0)
    expect(SAVED_PAGE_SIZE).toBeLessThanOrEqual(500)
  })
})

describe('pageCount', () => {
  it('rounds up, and is never less than one page', () => {
    expect(pageCount(0, 50)).toBe(1)
    expect(pageCount(1, 50)).toBe(1)
    expect(pageCount(50, 50)).toBe(1)
    expect(pageCount(51, 50)).toBe(2)
    expect(pageCount(1987, 50)).toBe(40)
  })
})

describe('clampPage', () => {
  it('steps back to the last page when the page is past the end', () => {
    expect(clampPage(2, 100, 50)).toBe(1)
    expect(clampPage(1, 50, 50)).toBe(0)
    expect(clampPage(5, 0, 50)).toBe(0)
  })

  it('leaves a page that exists alone, and never goes below the first', () => {
    expect(clampPage(1, 51, 50)).toBe(1)
    expect(clampPage(-1, 100, 50)).toBe(0)
  })
})

describe('pageUrls', () => {
  it('asks for one page and the total for the same collection', () => {
    const urls = pageUrls('/store', 'annotations', 'c-1', 2, 50, '')
    expect(urls.page).toBe('/store/annotations?collectionId=c-1&skip=100&take=50')
    expect(urls.total).toBe('/store/annotations/total?collectionId=c-1')
  })

  it('sends the trimmed search to both, encoded', () => {
    const urls = pageUrls('/store', 'cellcounts', 'c-1', 0, 50, '  50% & more ')
    expect(urls.page).toBe('/store/cellcounts?collectionId=c-1&search=50%25+%26+more&skip=0&take=50')
    expect(urls.total).toBe('/store/cellcounts/total?collectionId=c-1&search=50%25+%26+more')
  })

  it('leaves out a search of just spaces', () => {
    expect(pageUrls('/store', 'annotations', 'c-1', 0, 50, '   ').total).toBe('/store/annotations/total?collectionId=c-1')
  })

  it('sends the filters to both, after the search', () => {
    const urls = pageUrls('/store', 'annotations', 'c-1', 0, 50, 'box', { ...NO_FILTERS, createdBy: ['bob'], shapes: ['rectangle'] })
    expect(urls.page).toBe('/store/annotations?collectionId=c-1&search=box&createdBy=bob&shape=rectangle&skip=0&take=50')
    expect(urls.total).toBe('/store/annotations/total?collectionId=c-1&search=box&createdBy=bob&shape=rectangle')
  })
})

describe('isFiltered', () => {
  it('is any search or filter', () => {
    expect(isFiltered('  ', NO_FILTERS)).toBe(false)
    expect(isFiltered('a', NO_FILTERS)).toBe(true)
    expect(isFiltered('', { ...NO_FILTERS, createdBy: ['bob'] })).toBe(true)
    expect(isFiltered('', { ...NO_FILTERS, notes: 'no' })).toBe(true)
  })
})

describe('mergePage', () => {
  const base = { page: 0, search: '', pageSize: 3, isDeleted: none }

  it('shows the fetched page as it came when nothing has changed', () => {
    const fetched = rows(3)
    const view = mergePage({ ...base, fetched, total: 10, live: rows(10) })
    expect(view.items.map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
    expect(view.total).toBe(10)
  })

  it("shows an edit made since the fetch, from the store's copy", () => {
    const fetched = rows(3)
    const live = rows(3).map((r) => (r.id === 'r2' ? { ...r, label: 'renamed' } : r))
    const view = mergePage({ ...base, fetched, total: 3, live })
    expect(view.items[1].label).toBe('renamed')
  })

  it('drops a row deleted since the fetch, and counts it off the total', () => {
    const view = mergePage({ ...base, fetched: rows(3), total: 10, live: rows(10), isDeleted: (id) => id === 'r2' })
    expect(view.items.map((r) => r.id)).toEqual(['r1', 'r3'])
    expect(view.total).toBe(9)
  })

  it('puts a save made since the fetch at the top of the first page', () => {
    // Stamped by this machine in its own format - "Z", milliseconds.
    const mine = { id: 'new', created: new Date(Date.UTC(2026, 9, 13, 12, 5)).toISOString() }
    const view = mergePage({ ...base, fetched: rows(3), total: 10, live: [...rows(10), mine] })
    expect(view.items.map((r) => r.id)).toEqual(['new', 'r1', 'r2'])
    expect(view.total).toBe(11)
  })

  it("still puts it on top when this machine's clock is a little behind the server's", () => {
    // Older than the newest fetched row, but newer than the oldest on the
    // page. The server stamps it when the save lands, so it is the newest.
    const mine = { id: 'new', created: new Date(Date.UTC(2026, 9, 13, 11, 57, 30)).toISOString() }
    const view = mergePage({ ...base, fetched: rows(3), total: 10, live: [...rows(10), mine] })
    expect(view.items.map((r) => r.id)).toEqual(['new', 'r1', 'r2'])
  })

  it("doesn't pull older rows the store has loaded onto the first page", () => {
    // The store has all ten (annotations load everything) - r4..r10 belong
    // on later pages and stay there.
    const view = mergePage({ ...base, fetched: rows(3), total: 10, live: rows(10) })
    expect(view.items.map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it("doesn't pull in a row from the next page that shares the oldest row's millisecond", () => {
    // Real timestamps from annotation-store: 81 is the oldest on the page,
    // 80 is the first on page 2, 14 microseconds older - the same
    // millisecond once the browser parses them.
    const page = [
      { id: 'a130', created: '2026-10-13T15:57:46.329884+00:00' },
      { id: 'a129', created: '2026-10-13T15:57:46.329723+00:00' },
      { id: 'a81', created: '2026-10-13T15:57:46.311067+00:00' },
    ]
    const nextPage = { id: 'a80', created: '2026-10-13T15:57:46.311053+00:00' }
    const view = mergePage({ ...base, fetched: page, total: 4, live: [...page, nextPage] })
    expect(view.items.map((r) => r.id)).toEqual(['a130', 'a129', 'a81'])
    expect(view.total).toBe(4)
  })

  it('shows a fresh save on a short first page whatever its clock says - the page holds everything there is', () => {
    // An hour behind - far older than anything on the page.
    const mine = { id: 'new', created: new Date(Date.UTC(2026, 9, 13, 11, 0)).toISOString() }
    const view = mergePage({ ...base, pageSize: 50, fetched: rows(2), total: 2, live: [...rows(2), mine] })
    expect(view.items.map((r) => r.id)).toEqual(['new', 'r1', 'r2'])
    expect(view.total).toBe(3)
  })

  it('shows the very first save before the first fetch has anything', () => {
    const mine = { id: 'new', created: new Date().toISOString() }
    const view = mergePage({ ...base, fetched: [], total: 0, live: [mine] })
    expect(view.items.map((r) => r.id)).toEqual(['new'])
    expect(view.total).toBe(1)
  })

  it("leaves a search's results to the server", () => {
    const mine = { id: 'new', created: new Date(Date.UTC(2026, 9, 13, 12, 5)).toISOString() }
    const view = mergePage({ ...base, search: 'tumour', fetched: rows(2), total: 2, live: [...rows(2), mine] })
    expect(view.items.map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('only adds a fresh save that gets past the filters', () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 13, 12, minute)).toISOString()
    const live = [
      ...rows(2),
      { id: 'bob-box', created: at(5), createdById: 'bob', shape: 'rectangle' },
      { id: 'bob-line', created: at(6), createdById: 'bob', shape: 'line' },
      { id: 'alice-box', created: at(7), createdById: 'alice', shape: 'rectangle' },
    ]
    const ids = (createdBy: string[], shapes: string[]) =>
      mergePage({ ...base, pageSize: 50, filters: { ...NO_FILTERS, createdBy, shapes }, fetched: [], total: 0, live }).items.map(
        (r) => r.id
      )
    expect(ids(['bob'], [])).toEqual(['bob-line', 'bob-box'])
    expect(ids([], ['rectangle'])).toEqual(['alice-box', 'bob-box'])
    expect(ids(['bob'], ['rectangle'])).toEqual(['bob-box'])
  })

  it('only adds to the first page', () => {
    const mine = { id: 'new', created: new Date(Date.UTC(2026, 9, 13, 12, 5)).toISOString() }
    const view = mergePage({ ...base, page: 1, fetched: rows(3, 4), total: 10, live: [...rows(10), mine] })
    expect(view.items.map((r) => r.id)).toEqual(['r4', 'r5', 'r6'])
  })

  it("doesn't add back something deleted", () => {
    const mine = { id: 'new', created: new Date(Date.UTC(2026, 9, 13, 12, 5)).toISOString() }
    const view = mergePage({ ...base, fetched: rows(3), total: 3, live: [...rows(3), mine], isDeleted: (id) => id === 'new' })
    expect(view.items.map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('never says there are fewer than it shows', () => {
    const view = mergePage({ ...base, fetched: rows(3), total: 0, live: rows(3) })
    expect(view.total).toBe(3)
  })
})
