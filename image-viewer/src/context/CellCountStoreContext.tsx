import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { CellCount } from '../interfaces/CellCount'
import { useImageViewerContext } from './ImageViewerContext'
import { useEmitEvent } from './EventContext'
import { useCollectionContext } from './CollectionContext'

type Status = 'loading' | 'ready' | 'error'

interface CellCountStoreContextValue {
  cellCounts: CellCount[]
  status: Status
  selectedCellCountId: string | null
  viewedCellCountId: string | null
  addCellCount: (cellCount: CellCount) => void
  updateCellCount: (id: string, patch: Partial<CellCount>) => void
  deleteCellCount: (id: string) => void
  setSelectedCellCountId: (id: string | null) => void
  setViewedCellCountId: (id: string | null) => void
}

const CellCountStoreContext = createContext<CellCountStoreContextValue | null>(null)

interface CellCountStoreContextProviderProps {
  baseUrl: string
  children: ReactNode
}

// Mirrors AnnotationStoreContext - same slide-scoped load/optimistic-write
// pattern against the same annotation-store service, just a different
// endpoint. No OL feature source here (unlike annotations, cell counts
// aren't drawn on the map), so there's nothing to keep in sync beyond this
// state itself.
function CellCountStoreContextProvider({ baseUrl, children }: CellCountStoreContextProviderProps) {
  const { source } = useImageViewerContext()
  const { slideId } = source
  const emit = useEmitEvent()
  const { collectionId, status: collectionStatus } = useCollectionContext()

  const [cellCounts, setCellCounts] = useState<CellCount[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [selectedCellCountId, setSelectedCellCountId] = useState<string | null>(null)
  const [viewedCellCountId, setViewedCellCountId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (collectionId === null) {
      setStatus(collectionStatus === 'error' ? 'error' : 'loading')
      setCellCounts([])
      return
    }

    setStatus('loading')

    fetch(`${baseUrl}/cellcounts?collectionId=${encodeURIComponent(collectionId)}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<CellCount[]>
      })
      .then((data) => {
        if (cancelled) return
        setCellCounts(data)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error')
          emit('cellcounts:load-error', { slideId })
        }
      })

    return () => {
      cancelled = true
    }
  }, [baseUrl, slideId, collectionId, collectionStatus, emit])

  const addCellCount = (cellCount: CellCount) => {
    // Same reasoning as AnnotationStoreContext.addAnnotation - counting can
    // start and finish before collectionId resolves, and posting null would
    // 400 against the backend's non-nullable CollectionId.
    if (collectionId === null) {
      emit('cellcount:created:error', cellCount)
      return
    }
    setCellCounts((current) => [...current, cellCount])
    emit('cellcount:created', cellCount)
    fetch(`${baseUrl}/cellcounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cellCount, collectionId }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
      })
      .catch(() => {
        setStatus('error')
        emit('cellcount:created:error', cellCount)
      })
  }

  const updateCellCount = (id: string, patch: Partial<CellCount>) => {
    setCellCounts((current) => current.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    emit('cellcount:updated', { id, patch })
    fetch(`${baseUrl}/cellcounts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, slideId }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
      })
      .catch(() => {
        setStatus('error')
        emit('cellcount:updated:error', { id, patch })
      })
  }

  const deleteCellCount = (id: string) => {
    setCellCounts((current) => current.filter((c) => c.id !== id))
    emit('cellcount:deleted', { id })
    fetch(`${baseUrl}/cellcounts/${id}`, { method: 'DELETE' })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
      })
      .catch(() => {
        setStatus('error')
        emit('cellcount:deleted:error', { id })
      })
  }

  return (
    <CellCountStoreContext.Provider
      value={{
        cellCounts,
        status,
        selectedCellCountId,
        viewedCellCountId,
        addCellCount,
        updateCellCount,
        deleteCellCount,
        setSelectedCellCountId,
        setViewedCellCountId,
      }}
    >
      {children}
    </CellCountStoreContext.Provider>
  )
}

function useCellCountStoreContext(): CellCountStoreContextValue {
  const context = useContext(CellCountStoreContext)
  if (!context) {
    throw new Error('useCellCountStoreContext must be used within a CellCountStoreContextProvider')
  }
  return context
}

export { CellCountStoreContextProvider, useCellCountStoreContext }
