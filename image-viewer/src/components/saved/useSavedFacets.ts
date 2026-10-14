import { useEffect, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'

interface SavedAuthor {
  id: string
  name: string
  count: number
}

interface SavedColour {
  // Hex, lower case.
  colour: string
  count: number
}

// The filter popout's choices that depend on what's saved - who's saved
// something and, for annotations, the colours used.
interface SavedFacets {
  authors: SavedAuthor[]
  colours: SavedColour[]
}

// From annotation-store's /facets. Refetched on `revision` like
// useSavedTotal, so someone's first save or a new colour shows up. Null
// until it's known.
function useSavedFacets(
  baseUrl: string,
  path: 'annotations' | 'cellcounts',
  collectionId: string | null,
  revision: number,
): SavedFacets | null {
  const { authFetch } = useAuthContext()
  const [state, setState] = useState<{ collectionId: string; facets: SavedFacets } | null>(null)

  useEffect(() => {
    if (collectionId === null) return
    let cancelled = false
    authFetch(`${baseUrl}/${path}/facets?collectionId=${encodeURIComponent(collectionId)}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<SavedFacets>
      })
      .then((facets) => {
        if (!cancelled) setState({ collectionId, facets })
      })
      // A missed refresh keeps the last choices - the filters still work.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [baseUrl, path, collectionId, revision, authFetch])

  return state && state.collectionId === collectionId ? state.facets : null
}

export { useSavedFacets }
export type { SavedFacets, SavedAuthor, SavedColour }
