import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useImageViewerContext } from './ImageViewerContext'
import { useEmitEvent } from './EventContext'
import { useAuthContext } from './AuthContext'
import { useRealtimeContext } from './RealtimeContext'

type Status = 'loading' | 'ready' | 'error'

type CollectionRole = 'viewer' | 'editor' | 'owner'

interface CollectionMember {
  userId: string
  displayName: string
  role: CollectionRole
}

// As annotation-store gives it - see its Collections/CollectionEndpoints.cs.
interface Collection {
  collectionId: string
  slideId: string
  collectionName: string
  created: string
  ownerId: string
  myRole: CollectionRole
  members: CollectionMember[]
}

interface CollectionContextValue {
  // The one being worked in - where annotations and cell counts are read
  // from and saved to. Your own unless you've switched to one shared with you.
  collectionId: string | null
  // Always your own - image adjustments are personal, so they stay here.
  personalCollectionId: string | null
  status: Status
  // Every collection on this slide you're in, your own first.
  collections: Collection[]
  active: Collection | null
  canEdit: boolean
  setActiveCollectionId: (id: string) => void
  // Owner only. Rejects if annotation-store says no.
  addMember: (userId: string, displayName: string, role?: CollectionRole) => Promise<void>
  removeMember: (userId: string) => Promise<void>
}

const CollectionContext = createContext<CollectionContextValue | null>(null)

interface CollectionContextProviderProps {
  baseUrl: string
  children: ReactNode
}

// Remembered per tab, so a reload stays in the same collection.
const activeKey = (slideId: string) => `active-collection:${slideId}`

function readStoredActive(slideId: string): string | null {
  try {
    return sessionStorage.getItem(activeKey(slideId))
  } catch {
    return null
  }
}

function CollectionContextProvider({ baseUrl, children }: CollectionContextProviderProps) {
  const { source } = useImageViewerContext()
  const { slideId } = source
  const emit = useEmitEvent()
  const { authFetch } = useAuthContext()
  const { sendOp, onOp } = useRealtimeContext()

  const [personalCollectionId, setPersonalCollectionId] = useState<string | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  // Ids seen so far, so being added to a new one can be pointed out.
  const seenRef = useRef<Set<string> | null>(null)
  const activeIdRef = useRef(activeId)
  useEffect(() => {
    activeIdRef.current = activeId
  })

  const loadCollections = useCallback(async () => {
    const response = await authFetch(`${baseUrl}/collections?slideId=${encodeURIComponent(slideId)}`)
    if (!response.ok) throw new Error(String(response.status))
    const list = (await response.json()) as Collection[]

    const seen = seenRef.current
    if (seen) {
      for (const collection of list) {
        if (!seen.has(collection.collectionId)) {
          emit('collection:added', { collectionId: collection.collectionId, name: collection.collectionName })
        }
      }
    }
    seenRef.current = new Set(list.map((c) => c.collectionId))

    setCollections(list)
    // Taken out of the one you were in (or it's gone) - back to your own.
    const current = activeIdRef.current
    if (current && !list.some((c) => c.collectionId === current)) {
      if (seen?.has(current)) emit('collection:removed', { collectionId: current })
      setActiveId(null)
    }
    return list
  }, [authFetch, baseUrl, slideId, emit])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setPersonalCollectionId(null)
    setCollections([])
    seenRef.current = null
    setActiveId(readStoredActive(slideId))

    authFetch(`${baseUrl}/collections/ensure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideId }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<Collection>
      })
      .then(async (own) => {
        if (cancelled) return
        setPersonalCollectionId(own.collectionId)
        await loadCollections()
        if (!cancelled) setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error')
          emit('collection:load-error', { slideId })
        }
      })

    return () => {
      cancelled = true
    }
  }, [baseUrl, slideId, authFetch, loadCollections, emit])

  // Someone added or took someone out - fetch the list again, in case it's us.
  useEffect(
    () =>
      onOp(({ op }) => {
        if (op.entity === 'collection') loadCollections().catch(() => {})
      }),
    [onOp, loadCollections]
  )

  const setActiveCollectionId = useCallback(
    (id: string) => {
      setActiveId(id)
      try {
        sessionStorage.setItem(activeKey(slideId), id)
      } catch {
        // Just not remembered across a reload.
      }
    },
    [slideId]
  )

  const active =
    collections.find((c) => c.collectionId === activeId) ??
    collections.find((c) => c.collectionId === personalCollectionId) ??
    null
  const collectionId = status === 'ready' ? (active?.collectionId ?? personalCollectionId) : null

  const changeMembers = useCallback(
    async (userId: string, init: RequestInit) => {
      if (!active) return
      const response = await authFetch(
        `${baseUrl}/collections/${active.collectionId}/members/${encodeURIComponent(userId)}`,
        init
      )
      if (!response.ok) throw new Error(String(response.status))
      await loadCollections()
      // Tells everyone else on the slide to look again.
      sendOp({ kind: 'update', entity: 'collection', id: active.collectionId, collectionId: active.collectionId })
    },
    [active, authFetch, baseUrl, loadCollections, sendOp]
  )

  const addMember = useCallback(
    (userId: string, displayName: string, role: CollectionRole = 'editor') =>
      changeMembers(userId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, role }),
      }),
    [changeMembers]
  )

  const removeMember = useCallback((userId: string) => changeMembers(userId, { method: 'DELETE' }), [changeMembers])

  return (
    <CollectionContext.Provider
      value={{
        collectionId,
        personalCollectionId: status === 'ready' ? personalCollectionId : null,
        status,
        collections,
        active,
        canEdit: active ? active.myRole !== 'viewer' : false,
        setActiveCollectionId,
        addMember,
        removeMember,
      }}
    >
      {children}
    </CollectionContext.Provider>
  )
}

function useCollectionContext(): CollectionContextValue {
  const context = useContext(CollectionContext)
  if (!context) {
    throw new Error('useCollectionContext must be used within a CollectionContextProvider')
  }
  return context
}

export { CollectionContextProvider, useCollectionContext }
export type { Collection, CollectionMember, CollectionRole }
