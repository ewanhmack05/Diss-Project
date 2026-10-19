import { useCallback, useEffect, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'

// One answer from annotation-store's /total. `at` is the revision it was
// fetched for - anything settled after that isn't in it yet. `asked` is when
// it was asked for (performance.now()), which decides between two answers.
interface FetchedTotal {
  collectionId: string
  total: number
  at: number
  asked: number
}

// The total the label should go by. Either fetch can land first, so the one
// asked for later wins, not the one that arrived later - an old answer
// that was slow to come back mustn't undo a newer one. A different
// collection always replaces it.
function fresherTotal(current: FetchedTotal | null, next: FetchedTotal): FetchedTotal {
  if (current === null || current.collectionId !== next.collectionId) return next
  return next.asked >= current.asked ? next : current
}

// How many annotations or cell counts the collection has, for the Saved
// tab's label. Fetched again on `revision`, the store's count of settled
// creates and deletes, so it keeps up with yours and everyone else's. Not
// everything that writes to annotation-store goes through realtime, though
// (seed_stress.py doesn't) - so `seen` takes the Saved list's own unfiltered
// count too, whenever that's newer. Null until it's known.
function useSavedTotalAt(
  baseUrl: string,
  path: 'annotations' | 'cellcounts',
  collectionId: string | null,
  revision: number,
): { total: number | null; at: number; seen: (total: number, at: number, asked: number) => void } {
  const { authFetch } = useAuthContext()
  // Tagged with its collection, so joining a session doesn't show the last
  // collection's number while the new one loads.
  const [state, setState] = useState<FetchedTotal | null>(null)

  useEffect(() => {
    if (collectionId === null) return
    let cancelled = false
    const asked = performance.now()
    authFetch(`${baseUrl}/${path}/total?collectionId=${encodeURIComponent(collectionId)}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<number>
      })
      .then((total) => {
        if (!cancelled) setState((current) => fresherTotal(current, { collectionId, total, at: revision, asked }))
      })
      // A missed refresh keeps the last number - the label isn't worth an error.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [baseUrl, path, collectionId, revision, authFetch])

  const seen = useCallback(
    (total: number, at: number, asked: number) => {
      if (collectionId === null) return
      setState((current) => fresherTotal(current, { collectionId, total, at, asked }))
    },
    [collectionId]
  )

  return state && state.collectionId === collectionId
    ? { total: state.total, at: state.at, seen }
    : { total: null, at: -1, seen }
}

// What the Saved list says it's showing, while it's open - its count goes
// by the search and filters, so the tab can too.
interface ListTotal {
  total: number
  filtered: boolean
}

// The list's count while it's open, otherwise the collection's. "Saved", or
// "Saved (1,234)" once there's something saved - or "Saved (0)" when a
// search or filter finds nothing, so it's clear the 0 is theirs.
function savedTabLabel(total: number | null, list: ListTotal | null = null): string {
  if (list) return list.total || list.filtered ? `Saved (${list.total.toLocaleString()})` : 'Saved'
  return total ? `Saved (${total.toLocaleString()})` : 'Saved'
}

export { useSavedTotalAt, fresherTotal, savedTabLabel }
export type { ListTotal, FetchedTotal }
