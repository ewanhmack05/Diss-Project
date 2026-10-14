import { useEffect, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'

// How many annotations or cell counts the collection has, from
// annotation-store's /total - for the Saved tab's label. Refetched on
// `revision`, the store's count of settled creates and deletes, so it keeps
// up with yours and everyone else's. Null until it's known. `at` is the
// revision it was fetched for - anything settled after that isn't in it yet.
function useSavedTotalAt(
  baseUrl: string,
  path: 'annotations' | 'cellcounts',
  collectionId: string | null,
  revision: number,
): { total: number | null; at: number } {
  const { authFetch } = useAuthContext()
  // Tagged with its collection, so joining a session doesn't show the last
  // collection's number while the new one loads.
  const [state, setState] = useState<{ collectionId: string; total: number; at: number } | null>(null)

  useEffect(() => {
    if (collectionId === null) return
    let cancelled = false
    authFetch(`${baseUrl}/${path}/total?collectionId=${encodeURIComponent(collectionId)}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<number>
      })
      .then((total) => {
        if (!cancelled) setState({ collectionId, total, at: revision })
      })
      // A missed refresh keeps the last number - the label isn't worth an error.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [baseUrl, path, collectionId, revision, authFetch])

  return state && state.collectionId === collectionId ? { total: state.total, at: state.at } : { total: null, at: -1 }
}

function useSavedTotal(
  baseUrl: string,
  path: 'annotations' | 'cellcounts',
  collectionId: string | null,
  revision: number,
): number | null {
  return useSavedTotalAt(baseUrl, path, collectionId, revision).total
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

export { useSavedTotal, useSavedTotalAt, savedTabLabel }
export type { ListTotal }
