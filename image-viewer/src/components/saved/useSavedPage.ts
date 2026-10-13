import { useEffect, useRef, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { pageUrls } from './paging'

type PageStatus = 'loading' | 'ready' | 'error'

interface SavedPage<T> {
  fetched: T[]
  total: number
  // 'loading' only until the first page arrives - after that the last page
  // stays up while the next one loads, so the list doesn't flash empty.
  status: PageStatus
  loadingMore: boolean
}

// Typing in the search box waits this long after the last key before it
// asks the server, and a burst of saves turns into one refetch.
const SETTLE_MS = 250

// One page of a Saved list from annotation-store, plus the total for the
// same search. Refetches when the page, the search or `revision` changes -
// revision is the store's count of settled saves and deletes, so the page
// catches up with them.
function useSavedPage<T>({
  baseUrl,
  path,
  collectionId,
  page,
  pageSize,
  search,
  revision,
}: {
  baseUrl: string
  path: 'annotations' | 'cellcounts'
  collectionId: string | null
  page: number
  pageSize: number
  search: string
  revision: number
}): SavedPage<T> {
  const { authFetch } = useAuthContext()
  // Tagged with the collection it came from, so joining a session doesn't
  // show the last collection's rows while the new ones load.
  const [state, setState] = useState<SavedPage<T> & { collectionId: string | null }>({
    fetched: [],
    total: 0,
    status: 'loading',
    loadingMore: false,
    collectionId: null,
  })
  // Only the newest request's answer is used - a slow page 1 mustn't land
  // on top of the page 2 asked for after it.
  const latestRef = useRef(0)
  const previousRef = useRef<{ page: number; collectionId: string } | null>(null)

  useEffect(() => {
    if (collectionId === null) return
    // The first load, a new page or a new collection is fetched straight
    // away; search and revision changes wait to settle.
    const previous = previousRef.current
    const immediate = previous === null || previous.page !== page || previous.collectionId !== collectionId
    previousRef.current = { page, collectionId }
    const request = ++latestRef.current

    const timer = setTimeout(
      () => {
        setState((current) => ({ ...current, loadingMore: current.status === 'ready' && current.collectionId === collectionId }))
        const urls = pageUrls(baseUrl, path, collectionId, page, pageSize, search)
        const json = (url: string) =>
          authFetch(url).then((response) => {
            if (!response.ok) throw new Error(String(response.status))
            return response.json()
          })
        Promise.all([json(urls.page) as Promise<T[]>, json(urls.total) as Promise<number>])
          .then(([fetched, total]) => {
            if (request !== latestRef.current) return
            setState({ fetched, total, status: 'ready', loadingMore: false, collectionId })
          })
          .catch(() => {
            if (request !== latestRef.current) return
            setState({ fetched: [], total: 0, status: 'error', loadingMore: false, collectionId })
          })
      },
      immediate ? 0 : SETTLE_MS,
    )
    return () => clearTimeout(timer)
  }, [baseUrl, path, collectionId, page, pageSize, search, revision, authFetch])

  if (state.collectionId !== collectionId) return { fetched: [], total: 0, status: 'loading', loadingMore: false }
  return state
}

export default useSavedPage
export type { SavedPage }
