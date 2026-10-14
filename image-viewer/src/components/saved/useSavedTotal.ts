import { useEffect, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'

// How many annotations or cell counts the collection has, from
// annotation-store's /total - for the Saved tab's label. Refetched on
// `revision`, the store's count of settled creates and deletes, so it keeps
// up with yours and everyone else's. Null until it's known.
function useSavedTotal(
  baseUrl: string,
  path: 'annotations' | 'cellcounts',
  collectionId: string | null,
  revision: number,
): number | null {
  const { authFetch } = useAuthContext()
  // Tagged with its collection, so joining a session doesn't show the last
  // collection's number while the new one loads.
  const [state, setState] = useState<{ collectionId: string; total: number } | null>(null)

  useEffect(() => {
    if (collectionId === null) return
    let cancelled = false
    authFetch(`${baseUrl}/${path}/total?collectionId=${encodeURIComponent(collectionId)}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<number>
      })
      .then((total) => {
        if (!cancelled) setState({ collectionId, total })
      })
      // A missed refresh keeps the last number - the label isn't worth an error.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [baseUrl, path, collectionId, revision, authFetch])

  return state && state.collectionId === collectionId ? state.total : null
}

// "Saved", or "Saved (1,234)" once there's something saved.
function savedTabLabel(total: number | null): string {
  return total ? `Saved (${total.toLocaleString()})` : 'Saved'
}

export { useSavedTotal, savedTabLabel }
