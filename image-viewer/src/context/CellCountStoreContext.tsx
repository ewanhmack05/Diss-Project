import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { CellCount } from '../interfaces/CellCount'
import { useImageViewerContext } from './ImageViewerContext'
import { useEmitEvent } from './EventContext'
import { useCollectionContext } from './CollectionContext'
import { mergePolledItems } from './pollMerge'

type Status = 'loading' | 'ready' | 'error'

const POLL_INTERVAL_MS = 5000

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
  // Ids this tab has added/deleted locally but whose POST/DELETE hasn't
  // round-tripped yet - guards the poll below from clobbering an in-flight
  // create or resurrecting an in-flight delete. Refs, not state: they don't
  // need to trigger a render, just be current when a poll tick reads them.
  const pendingCreateIdsRef = useRef<Set<string>>(new Set())
  const pendingDeleteIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false

    // A ref set from the previous collection means nothing once collectionId
    // changes - carrying it over could wrongly preserve/suppress an id that
    // just happens to collide in the new collection's list.
    pendingCreateIdsRef.current.clear()
    pendingDeleteIdsRef.current.clear()

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

  // The load above only runs once per collection, so a cell count written
  // straight against the store by something other than this tab (a second
  // collaborator) would otherwise only ever show up after a manual reload.
  // This polls for that, merging against this tab's own pending
  // creates/deletes so a tick landing mid-write can't clobber or resurrect
  // one (see mergePolledItems).
  useEffect(() => {
    if (collectionId === null || status === 'error') return

    let cancelled = false

    const poll = () => {
      fetch(`${baseUrl}/cellcounts?collectionId=${encodeURIComponent(collectionId)}`)
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status))
          return response.json() as Promise<CellCount[]>
        })
        .then((data) => {
          if (cancelled) return
          setCellCounts((current) =>
            mergePolledItems(data, current, pendingCreateIdsRef.current, pendingDeleteIdsRef.current)
          )
        })
        .catch(() => {
          // A single missed poll isn't worth surfacing - the next tick retries.
        })
    }

    const intervalId = setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [baseUrl, collectionId, status])

  const addCellCount = (cellCount: CellCount) => {
    // Same reasoning as AnnotationStoreContext.addAnnotation - counting can
    // start and finish before collectionId resolves, and posting null would
    // 400 against the backend's non-nullable CollectionId.
    if (collectionId === null) {
      emit('cellcount:created:error', cellCount)
      return
    }
    pendingCreateIdsRef.current.add(cellCount.id)
    setCellCounts((current) => [...current, cellCount])
    emit('cellcount:created', cellCount)
    fetch(`${baseUrl}/cellcounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cellCount, collectionId }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        pendingCreateIdsRef.current.delete(cellCount.id)
      })
      .catch(() => {
        pendingCreateIdsRef.current.delete(cellCount.id)
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
    pendingDeleteIdsRef.current.add(id)
    setCellCounts((current) => current.filter((c) => c.id !== id))
    emit('cellcount:deleted', { id })
    fetch(`${baseUrl}/cellcounts/${id}`, { method: 'DELETE' })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        pendingDeleteIdsRef.current.delete(id)
      })
      .catch(() => {
        pendingDeleteIdsRef.current.delete(id)
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
