import { useEffect, useRef, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { isFiltered, pageUrls, type SavedPath } from './paging'
import { NO_FILTERS, filterKey, type SavedFilters } from './filters'

type PageStatus = 'loading' | 'ready' | 'error'

interface SavedPage<T> {
  fetched: T[]
  total: number
  // The revision it was fetched for - anything settled after isn't in it.
  at: number
  // When it was asked for (performance.now()), and whether a search or
  // filter narrowed it - an unfiltered total is the whole collection's.
  asked: number
  filtered: boolean
  // 'loading' only until the first page arrives - after that the last page
  // stays up while the next one loads, so the list doesn't flash empty.
  status: PageStatus
  loadingMore: boolean
}

// Typing in the search box waits this long after the last key before it
// asks the server, and a burst of saves turns into one refetch.
const SETTLE_MS = 250

// One page of a Saved list from annotation-store, plus the total for the
// same search and filters. Refetches when the page, the search, the filters
// or `revision` changes -
// revision is the store's count of settled saves and deletes, so the page
// catches up with them.
function useSavedPage<T>({
  baseUrl,
  path,
  collectionId,
  page,
  pageSize,
  search,
  filters = NO_FILTERS,
  revision,
}: {
  baseUrl: string
  path: SavedPath
  collectionId: string | null
  page: number
  pageSize: number
  search: string
  filters?: SavedFilters
  revision: number
}): SavedPage<T> {
  const { authFetch } = useAuthContext()
  // Tagged with the collection it came from, so joining a session doesn't
  // show the last collection's rows while the new ones load.
  const [state, setState] = useState<SavedPage<T> & { collectionId: string | null }>({
    fetched: [],
    total: 0,
    at: -1,
    asked: -1,
    filtered: false,
    status: 'loading',
    loadingMore: false,
    collectionId: null,
  })
  // Only the newest request's answer is used - a slow page 1 mustn't land
  // on top of the page 2 asked for after it.
  const latestRef = useRef(0)
  const previousRef = useRef<{ page: number; collectionId: string; key: string } | null>(null)
  // The effect goes by this rather than the object, which is new each time
  // the popout changes anything.
  const key = filterKey(filters)

  useEffect(() => {
    if (collectionId === null) return
    // The first load, a new page, a new collection or a picked filter is
    // fetched straight away; search and revision changes wait to settle.
    const previous = previousRef.current
    const immediate =
      previous === null ||
      previous.page !== page ||
      previous.collectionId !== collectionId ||
      previous.key !== key
    previousRef.current = { page, collectionId, key }
    const request = ++latestRef.current

    const timer = setTimeout(
      () => {
        setState((current) => ({ ...current, loadingMore: current.status === 'ready' && current.collectionId === collectionId }))
        const asked = performance.now()
        const askedFilters = JSON.parse(key) as SavedFilters
        const filtered = isFiltered(search, askedFilters)
        const urls = pageUrls(baseUrl, path, collectionId, page, pageSize, search, askedFilters)
        const json = (url: string) =>
          authFetch(url).then((response) => {
            if (!response.ok) throw new Error(String(response.status))
            return response.json()
          })
        Promise.all([json(urls.page) as Promise<T[]>, json(urls.total) as Promise<number>])
          .then(([fetched, total]) => {
            if (request !== latestRef.current) return
            setState({ fetched, total, at: revision, asked, filtered, status: 'ready', loadingMore: false, collectionId })
          })
          .catch(() => {
            if (request !== latestRef.current) return
            setState({ fetched: [], total: 0, at: revision, asked, filtered, status: 'error', loadingMore: false, collectionId })
          })
      },
      immediate ? 0 : SETTLE_MS,
    )
    return () => clearTimeout(timer)
  }, [baseUrl, path, collectionId, page, pageSize, search, key, revision, authFetch])

  if (state.collectionId !== collectionId) return { fetched: [], total: 0, at: -1, asked: -1, filtered: false, status: 'loading', loadingMore: false }
  return state
}

export default useSavedPage
export type { SavedPage }
