import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { CellCount } from '../interfaces/CellCount'
import { useImageViewerContext } from './ImageViewerContext'
import { useEmitEvent } from './EventContext'
import { useCollectionContext } from './CollectionContext'
import { useRealtimeContext } from './RealtimeContext'
import { useAuthContext } from './AuthContext'
import { applyOp } from '../components/realtime/realtime'
import { useSavedTotalAt } from '../components/saved/useSavedTotal'
import { jsonHeaders } from '../components/annotation/bulk'

type Status = 'loading' | 'ready' | 'error'

// The editable bits plus the counted facts the PUT also overwrites.
type CellCountEdit = Pick<CellCount, 'label' | 'notes' | 'withAnnotation' | 'withRoi' | 'count' | 'dotSize'>

interface CellCountStoreContextValue {
  // Not every saved count - only the ones loaded so far: the newest, the
  // Saved list's pages as you go through them, your own new ones and
  // anything arriving live. Ones from annotation-store's list come without
  // their dots (dots: null) - those load only for the count viewed on the
  // map. A count's dots can run to megabytes.
  cellCounts: CellCount[]
  status: Status
  // Same as AnnotationStoreContext's - the Saved list refetches its page on it.
  revision: number
  // How many cell counts the collection has, from annotation-store - null until
  // it's known. For the Saved tab's label.
  total: number | null
  // The Saved list's own unfiltered /total, so the label keeps up with
  // anything that wrote to annotation-store without telling realtime.
  seenTotal: (total: number, at: number, asked: number) => void
  wasDeleted: (id: string) => boolean
  // annotation-store's address, for the Saved list's own paged reads.
  baseUrl: string
  // Adds a page's counts to cellCounts, so viewing or editing one finds it.
  rememberCellCounts: (cellCounts: CellCount[]) => void
  selectedCellCountId: string | null
  viewedCellCountId: string | null
  addCellCount: (cellCount: CellCount) => void
  // Already saved by a GeoJSON import - see collections/useCollectionFiles.
  addImported: (cellCounts: CellCount[]) => void
  // Put back by a restore, without their dots - shown again, here only.
  // Whoever restored them tells everyone else.
  addRestored: (cellCounts: CellCount[]) => void
  // changeSet keeps every save of one edit as one change - see SavedCountEdit.
  updateCellCount: (id: string, patch: CellCountEdit, changeSet?: string) => void
  deleteCellCount: (id: string) => void
  setSelectedCellCountId: (id: string | null) => void
  setViewedCellCountId: (id: string | null) => void
}

const CellCountStoreContext = createContext<CellCountStoreContextValue | null>(null)

interface CellCountStoreContextProviderProps {
  baseUrl: string
  children: ReactNode
}

// Mirrors AnnotationStoreContext - same slide-scoped optimistic-write
// pattern against the same annotation-store service, just a different
// endpoint. Unlike annotations it doesn't load everything up front - only
// the newest count, then whatever's paged through or asked for. No OL
// feature source here (unlike annotations, cell counts aren't drawn on the
// map), so there's nothing to keep in sync beyond this state itself.
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
  const [revision, setRevision] = useState(0)
  const { total, seen: seenTotal } = useSavedTotalAt(baseUrl, 'cellcounts', collectionId, revision)
  const bumpRevision = () => setRevision((current) => current + 1)
  const wasDeleted = useCallback((id: string) => deletedIdsRef.current.has(id), [])
  // Ids being fetched by ensureCellCountDots, so asking twice fetches once.
  const ensuringRef = useRef(new Set<string>())
  // Same as AnnotationStoreContext - a form closing because its count was
  // deleted mustn't then PUT its last autosave to something that's gone.
  const deletedIdsRef = useRef(new Set<string>())
  const loadedForRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (collectionId === null) {
      setStatus(collectionStatus === 'error' ? 'error' : 'loading')
      setCellCounts([])
      loadedForRef.current = null
      return
    }

    // Another collection's counts don't carry over. Only on an actual
    // change - this also reruns when sign-in hands out a new authFetch.
    if (loadedForRef.current !== collectionId) {
      setCellCounts([])
      loadedForRef.current = collectionId
    }
    setStatus('loading')

    // Just the newest, for the counter's "Recent" card. The Saved list loads
    // its own pages.
    authFetch(`${baseUrl}/cellcounts?collectionId=${encodeURIComponent(collectionId)}&take=1`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<CellCount[]>
      })
      .then((data) => {
        if (cancelled) return
        // Merged rather than set - the Saved list may have loaded a page
        // already.
        setCellCounts((current) => [...current, ...data.filter((c) => !current.some((known) => known.id === c.id))])
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
        // Put back by someone else.
        if (op.kind === 'create') deletedIdsRef.current.delete(op.id)
        setCellCounts((current) => applyOp(current, op))
        if (op.kind === 'delete') {
          setSelectedCellCountId((current) => (current === op.id ? null : current))
          setViewedCellCountId((current) => (current === op.id ? null : current))
        }
        if (op.kind !== 'update') setRevision((current) => current + 1)
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
      .finally(bumpRevision)
  }

  // Already saved, all together, by an import - same as
  // AnnotationStoreContext's addImported.
  const addImported = (imported: CellCount[]) => {
    if (imported.length === 0) return
    setCellCounts((current) => [...current, ...imported])
    for (const cellCount of imported) sendOp({ kind: 'create', entity: 'cellCount', id: cellCount.id, data: cellCount })
    bumpRevision()
  }

  const addRestored = (restored: CellCount[]) => {
    if (restored.length === 0) return
    for (const c of restored) deletedIdsRef.current.delete(c.id)
    setCellCounts((current) => [...current, ...restored.filter((c) => !current.some((known) => known.id === c.id))])
    bumpRevision()
  }

  // annotation-store's PUT replaces all of these together, so pass them all.
  const updateCellCount = (id: string, patch: CellCountEdit, changeSet?: string) => {
    if (deletedIdsRef.current.has(id)) return
    setCellCounts((current) => current.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    emit('cellcount:updated', { id, patch })
    sendOp({ kind: 'update', entity: 'cellCount', id, data: patch })
    authFetch(`${baseUrl}/cellcounts/${id}`, {
      method: 'PUT',
      headers: jsonHeaders(changeSet),
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
      .finally(bumpRevision)
  }

  // Counts already here keep their own copy - it has any edit made since
  // the page was fetched.
  const rememberCellCounts = useCallback((fetched: CellCount[]) => {
    setCellCounts((current) => {
      const known = new Set(current.map((c) => c.id))
      const fresh = fetched.filter((c) => !known.has(c.id) && !deletedIdsRef.current.has(c.id))
      return fresh.length === 0 ? current : [...current, ...fresh]
    })
  }, [])

  // Runs from an effect and needs what's loaded right now, without changing
  // identity every time a count is added.
  const cellCountsRef = useRef(cellCounts)
  useEffect(() => {
    cellCountsRef.current = cellCounts
  }, [cellCounts])
  // A count's dots, fetched by id if they aren't here - the whole count,
  // if you've never paged to it, e.g. following a host who's viewing it.
  // The fetched count takes the place of the dot-less one from the list,
  // keeping any edit made since.
  const ensureCellCountDots = useCallback(
    (id: string) => {
      const known = cellCountsRef.current.find((c) => c.id === id)
      if (known && known.dots !== null) return
      if (deletedIdsRef.current.has(id) || ensuringRef.current.has(id)) return
      ensuringRef.current.add(id)
      authFetch(`${baseUrl}/cellcounts/${encodeURIComponent(id)}`)
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status))
          return response.json() as Promise<CellCount>
        })
        .then((full) => {
          if (deletedIdsRef.current.has(id)) return
          setCellCounts((current) =>
            current.some((c) => c.id === id)
              ? current.map((c) => (c.id === id ? { ...full, ...c, dots: full.dots } : c))
              : [...current, full]
          )
        })
        .catch(() => emit('cellcount:load-error', { id }))
        .finally(() => ensuringRef.current.delete(id))
    },
    [authFetch, baseUrl, emit]
  )

  // Only the count on the map needs its dots - the list and the edit form
  // make do with the summary. Whoever picked it: following a host can land
  // on a count you've never paged to.
  useEffect(() => {
    if (viewedCellCountId) ensureCellCountDots(viewedCellCountId)
  }, [viewedCellCountId, ensureCellCountDots])

  return (
    <CellCountStoreContext.Provider
      value={{
        cellCounts,
        status,
        revision,
        wasDeleted,
        baseUrl,
        total,
        seenTotal,
        rememberCellCounts,
        selectedCellCountId,
        viewedCellCountId,
        addCellCount,
        addImported,
        addRestored,
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
