import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useImageViewerContext } from './ImageViewerContext'
import { useEmitEvent } from './EventContext'

type Status = 'loading' | 'ready' | 'error'

interface CollectionContextValue {
  collectionId: string | null
  status: Status
}

const CollectionContext = createContext<CollectionContextValue | null>(null)

interface CollectionContextProviderProps {
  baseUrl: string
  children: ReactNode
}

interface Collection {
  collectionId: string
  slideId: string
  collectionName: string
  created: string
  userId: string
}

// Stand-in until real auth/user identity exists - same idea as the backend's
// own placeholder UserId fields.
const PLACEHOLDER_USER_ID = '001'

function CollectionContextProvider({ baseUrl, children }: CollectionContextProviderProps) {
  const { source } = useImageViewerContext()
  const { slideId } = source
  const emit = useEmitEvent()

  const [collectionId, setCollectionId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setCollectionId(null)

    fetch(`${baseUrl}/collections/ensure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideId, userId: PLACEHOLDER_USER_ID }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<Collection>
      })
      .then((data) => {
        if (cancelled) return
        setCollectionId(data.collectionId)
        setStatus('ready')
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
  }, [baseUrl, slideId, emit])

  return <CollectionContext.Provider value={{ collectionId, status }}>{children}</CollectionContext.Provider>
}

function useCollectionContext(): CollectionContextValue {
  const context = useContext(CollectionContext)
  if (!context) {
    throw new Error('useCollectionContext must be used within a CollectionContextProvider')
  }
  return context
}

export { CollectionContextProvider, useCollectionContext }
