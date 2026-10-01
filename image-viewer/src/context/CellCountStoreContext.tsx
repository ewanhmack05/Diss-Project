import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { CellCount } from '../interfaces/CellCount'
import { useImageViewerContext } from './ImageViewerContext'
import { useEmitEvent } from './EventContext'
import { useCollectionContext } from './CollectionContext'
import { useRealtimeContext } from './RealtimeContext'
import { useAuthContext } from './AuthContext'
import { applyOp } from '../components/realtime/realtime'

type Status = 'loading' | 'ready' | 'error'

// The editable bits plus the counted facts the PUT also overwrites.
type CellCountEdit = Pick<CellCount, 'label' | 'notes' | 'withAnnotation' | 'withRoi' | 'count' | 'dotSize'>

interface CellCountStoreContextValue {
  cellCounts: CellCount[]
  status: Status
  selectedCellCountId: string | null
  viewedCellCountId: string | null
  addCellCount: (cellCount: CellCount) => void
  updateCellCount: (id: string, patch: CellCountEdit) => void
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
  const { collectionId, status: collectionStatus, canEdit } = useCollectionContext()
  const { sendOp, onOp } = useRealtimeContext()
  const { authFetch, user } = useAuthContext()

  const [cellCounts, setCellCounts] = useState<CellCount[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [selectedCellCountId, setSelectedCellCountId] = useState<string | null>(null)
  const [viewedCellCountId, setViewedCellCountId] = useState<string | null>(null)
  // Same as AnnotationStoreContext - a form closing because its count was
  // deleted mustn't then PUT its last autosave to something that's gone.
  const deletedIdsRef = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false

    if (collectionId === null) {
      setStatus(collectionStatus === 'error' ? 'error' : 'loading')
      setCellCounts([])
      return
    }

    setStatus('loading')

    authFetch(`${baseUrl}/cellcounts?collectionId=${encodeURIComponent(collectionId)}`)
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
  }, [baseUrl, slideId, collectionId, collectionStatus, emit, authFetch])

  // Same as AnnotationStoreContext - mirror someone else's saved change.
  useEffect(
    () =>
      onOp(({ op }) => {
        if (op.entity !== 'cellCount') return
        if (op.kind === 'delete') deletedIdsRef.current.add(op.id)
        setCellCounts((current) => applyOp(current, op))
        if (op.kind === 'delete') {
          setSelectedCellCountId((current) => (current === op.id ? null : current))
          setViewedCellCountId((current) => (current === op.id ? null : current))
        }
      }),
    [onOp]
  )

  const addCellCount = (unstamped: CellCount) => {
    // Shows who saved it straight away - annotation-store sets the same from the token.
    const cellCount = { ...unstamped, createdById: user.id, createdByName: user.name }
    // Only a viewer in the collection you're working in - annotation-store would
    // turn it down anyway.
    if (!canEdit) {
      emit('collection:read-only')
      return
    }
    // Same reasoning as AnnotationStoreContext.addAnnotation - counting can
    // start and finish before collectionId resolves, and posting null would
    // 400 against the backend's non-nullable CollectionId.
    if (collectionId === null) {
      emit('cellcount:created:error', cellCount)
      return
    }
    setCellCounts((current) => [...current, cellCount])
    emit('cellcount:created', cellCount)
    sendOp({ kind: 'create', entity: 'cellCount', id: cellCount.id, data: cellCount })
    authFetch(`${baseUrl}/cellcounts`, {
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

  // annotation-store's PUT replaces all of these together, so pass them all.
  const updateCellCount = (id: string, patch: CellCountEdit) => {
    if (deletedIdsRef.current.has(id)) return
    setCellCounts((current) => current.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    emit('cellcount:updated', { id, patch })
    sendOp({ kind: 'update', entity: 'cellCount', id, data: patch })
    authFetch(`${baseUrl}/cellcounts/${id}`, {
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
    deletedIdsRef.current.add(id)
    setCellCounts((current) => current.filter((c) => c.id !== id))
    emit('cellcount:deleted', { id })
    sendOp({ kind: 'delete', entity: 'cellCount', id })
    authFetch(`${baseUrl}/cellcounts/${id}`, { method: 'DELETE' })
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
export type { CellCountEdit }
