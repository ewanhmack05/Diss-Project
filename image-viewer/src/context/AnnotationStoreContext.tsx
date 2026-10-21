import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import VectorSource from 'ol/source/Vector'
import type { Annotation } from '../interfaces/Annotation'
import { useImageViewerContext } from './ImageViewerContext'
import { useEmitEvent } from './EventContext'
import { useCollectionContext } from './CollectionContext'
import { useRealtimeContext } from './RealtimeContext'
import { useAuthContext } from './AuthContext'
import { applyOp } from '../components/realtime/realtime'
import { useSavedTotalAt } from '../components/saved/useSavedTotal'
import type { SavedFilters } from '../components/saved/filters'
import { changeSetHeaders, deleteAsOneChange, inBatches, newChangeSet } from '../components/annotation/bulk'

type Status = 'loading' | 'ready' | 'error'

// What the Select tab changes on many annotations at once. groupId null
// takes them out of their group.
interface BulkPatch {
  colour?: string
  groupId?: string | null
}

// The Saved list's search and filters, while it's open and narrowing
// anything - the map only draws what gets through.
interface MapFilter {
  search: string
  filters: SavedFilters
}

// How long the Undo on a bulk delete stays up. The delete goes to
// annotation-store straight away - only hidden there, in one change set - and
// Undo restores that change set. The change set can still be restored after
// this, the toast just stops offering it.
const UNDO_DELETE_MS = 8000
// How long a sent bulk delete is still taken off counts fetched before it.
const REMOVAL_KEEP_MS = 10000

interface AnnotationStoreContextValue {
  annotations: Annotation[]
  status: Status
  // Goes up each time a create or delete settles - yours once annotation-store
  // has answered, someone else's when it arrives. The Saved list refetches
  // its page on it.
  revision: number
  // How many annotations the collection has, from annotation-store - null until
  // it's known. For the Saved tab's label. Takes off a bulk delete straight
  // away, before annotation-store has answered.
  total: number | null
  // The Saved list's own unfiltered /total, so the label keeps up with
  // anything that wrote to annotation-store without telling realtime.
  seenTotal: (total: number, at: number, asked: number) => void
  // Deleted here but not yet out of a fetch made at revision `at` - for the
  // Saved list, which fetches separately, to take off its own count.
  pendingRemoved: (at: number) => Annotation[]
  mapFilter: MapFilter | null
  setMapFilter: (filter: MapFilter | null) => void
  wasDeleted: (id: string) => boolean
  // annotation-store's address, for the Saved list's own paged reads.
  baseUrl: string
  selectedAnnotationId: string | null
  // The saved annotation picked with View on map - the map flies to it and
  // draws a halo round it. Every annotation is drawn anyway; this just
  // picks one out.
  viewedAnnotationId: string | null
  // The OL features MapNode renders saved annotations as - shared here (not
  // owned by MapNode) so editing UI (colour changes, etc.) can preview
  // directly against the live map feature, the same way AddAnnotationForm
  // does against a pending draw's feature.
  annotationsSource: VectorSource
  addAnnotation: (annotation: Annotation) => void
  // Already saved by a GeoJSON import - see collections/useCollectionFiles.
  addImported: (annotations: Annotation[]) => void
  // Put back by a restore - shown again, here only. Whoever restored them
  // tells everyone else.
  addRestored: (annotations: Annotation[]) => void
  // Many at once, from the Select tab - one request, one toast.
  updateMany: (ids: string[], patch: BulkPatch) => void
  // Gone straight away and sent straight away, as one change set. Returns
  // the undo, or null if there was nothing to delete.
  deleteMany: (ids: string[]) => (() => void) | null
  // Local only, no request - for groups. markGrouped also tells everyone
  // else, after annotation-store has already grouped them; forgetGroup is
  // run by everyone when a group is deleted.
  markGrouped: (ids: string[], groupId: string) => void
  forgetGroup: (groupId: string) => void
  updateAnnotation: (id: string, patch: Pick<Annotation, 'label' | 'notes' | 'colour'>) => void
  deleteAnnotation: (id: string) => void
  setSelectedAnnotationId: (id: string | null) => void
  setViewedAnnotationId: (id: string | null) => void
}

const AnnotationStoreContext = createContext<AnnotationStoreContextValue | null>(null)

interface AnnotationStoreContextProviderProps {
  baseUrl: string
  children: ReactNode
}

function AnnotationStoreContextProvider({ baseUrl, children }: AnnotationStoreContextProviderProps) {
  const { source } = useImageViewerContext()
  const { slideId } = source
  const emit = useEmitEvent()
  const { collectionId, status: collectionStatus, canEdit } = useCollectionContext()
  const { sendOp, onOp } = useRealtimeContext()
  const { authFetch, user } = useAuthContext()

  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [viewedAnnotationId, setViewedAnnotationId] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [mapFilter, setMapFilter] = useState<MapFilter | null>(null)
  // Read straight after a bump, to know which revision a delete settled at.
  const revisionRef = useRef(0)
  const bumpRevision = useCallback(() => {
    revisionRef.current += 1
    setRevision(revisionRef.current)
  }, [])
  // Bulk deletes - from when they're made until a fetch after they're saved.
  // settledAt is the revision they were saved at, null until then.
  const [removals, setRemovals] = useState<{ key: number; items: Annotation[]; settledAt: number | null }[]>([])
  const pendingRemoved = useCallback(
    (at: number) => removals.filter((r) => r.settledAt === null || r.settledAt > at).flatMap((r) => r.items),
    [removals]
  )
  const fetchedTotal = useSavedTotalAt(baseUrl, 'annotations', collectionId, revision)
  const total = fetchedTotal.total === null ? null : Math.max(0, fetchedTotal.total - pendingRemoved(fetchedTotal.at).length)
  const wasDeleted = useCallback((id: string) => deletedIdsRef.current.has(id), [])
  const nextRemovalRef = useRef(0)
  const annotationsSourceRef = useRef(new VectorSource())
  // Anything deleted, by you or anyone else. An edit form that closes
  // because its annotation was deleted still flushes its last autosave,
  // and that has to be dropped rather than PUT to something that's gone.
  const deletedIdsRef = useRef(new Set<string>())

  // Load whatever's already saved for this slide - the reason to have a
  // backend at all is that this survives a reload, unlike plain React state.
  useEffect(() => {
    let cancelled = false

    if (collectionId === null) {
      setStatus(collectionStatus === 'error' ? 'error' : 'loading')
      setAnnotations([])
      return
    }

    setStatus('loading')

    authFetch(`${baseUrl}/annotations?collectionId=${encodeURIComponent(collectionId)}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<Annotation[]>
      })
      .then((data) => {
        if (cancelled) return
        setAnnotations(data)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error')
          emit('annotations:load-error', { slideId })
        }
      })

    return () => {
      cancelled = true
    }
  }, [baseUrl, slideId, collectionId, collectionStatus, emit, authFetch])

  // Someone else's change, already saved by them - just mirror it locally.
  // No toast/emit here, those are for your own actions.
  useEffect(
    () =>
      onOp(({ op }) => {
        if (op.entity !== 'annotation') return
        if (op.kind === 'delete') deletedIdsRef.current.add(op.id)
        // Put back by someone else.
        if (op.kind === 'create') deletedIdsRef.current.delete(op.id)
        setAnnotations((current) => applyOp(current, op))
        if (op.kind === 'delete') {
          setSelectedAnnotationId((current) => (current === op.id ? null : current))
          setViewedAnnotationId((current) => (current === op.id ? null : current))
        }
        // A regroup changes what a group filter lets through.
        if (op.kind !== 'update' || (op.data && typeof op.data === 'object' && 'groupId' in op.data))
          bumpRevision()
      }),
    [onOp]
  )

  // Writes are optimistic - update local state immediately for a responsive
  // UI (and emit the corresponding event right away), fire the request, and
  // emit a matching :error event - separately - if it didn't actually
  // persist. Fine for a proof of concept; a real conflict/rollback story can
  // wait until this has more than one collaborator writing to it.
  const addAnnotation = (unstamped: Annotation) => {
    // Shows who saved it straight away - annotation-store sets the same from the token.
    const annotation = { ...unstamped, createdById: user.id, createdByName: user.name }
    // Only a viewer in the collection you're working in - annotation-store would
    // turn it down anyway.
    if (!canEdit) {
      emit('collection:read-only')
      return
    }
    // Neither the draw tools nor AddAnnotationForm wait on this context's own
    // status before letting a save happen - collectionId can still be null
    // this early. Posting null there would 400 against the backend's
    // non-nullable CollectionId, so this bails before the optimistic add
    // ever makes the annotation look saved when it can't be.
    if (collectionId === null) {
      emit('annotation:created:error', annotation)
      return
    }
    setAnnotations((current) => [...current, annotation])
    emit('annotation:created', annotation)
    // Sent straight away rather than after the save, to keep the delay down.
    // A save that then fails isn't rolled back for anyone, same as locally.
    sendOp({ kind: 'create', entity: 'annotation', id: annotation.id, data: annotation })
    authFetch(`${baseUrl}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...annotation, collectionId }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
      })
      .catch(() => {
        setStatus('error')
        emit('annotation:created:error', annotation)
      })
      .finally(bumpRevision)
  }

  // Already saved, all together, by an import - just shown, and sent to
  // everyone else. One toast for the import rather than one each.
  const addImported = (imported: Annotation[]) => {
    if (imported.length === 0) return
    setAnnotations((current) => [...current, ...imported])
    for (const annotation of imported) sendOp({ kind: 'create', entity: 'annotation', id: annotation.id, data: annotation })
    bumpRevision()
  }

  const addRestored = (restored: Annotation[]) => {
    if (restored.length === 0) return
    const ids = new Set(restored.map((a) => a.id))
    for (const id of ids) deletedIdsRef.current.delete(id)
    // Not taken off the count any more, if it was a delete from just now.
    setRemovals((current) => current.map((r) => ({ ...r, items: r.items.filter((a) => !ids.has(a.id)) })))
    setAnnotations((current) => [...current, ...restored.filter((a) => !current.some((c) => c.id === a.id))])
    bumpRevision()
  }

  const updateMany = (ids: string[], patch: BulkPatch) => {
    if (!canEdit) {
      emit('collection:read-only')
      return
    }
    if (collectionId === null || ids.length === 0) return
    const wanted = new Set(ids)
    setAnnotations((current) => current.map((a) => (wanted.has(a.id) ? { ...a, ...patch } : a)))
    for (const id of ids) sendOp({ kind: 'update', entity: 'annotation', id, data: patch })
    const changeSet = newChangeSet()
    Promise.all(
      inBatches(ids).map((batch) =>
        authFetch(`${baseUrl}/annotations/bulk`, {
          method: 'PUT',
          headers: changeSetHeaders(changeSet),
          body: JSON.stringify({
            collectionId,
            ids: batch,
            colour: patch.colour,
            setGroup: 'groupId' in patch,
            groupId: patch.groupId ?? null,
          }),
        }).then((response) => {
          if (!response.ok) throw new Error(String(response.status))
        })
      )
    )
      .then(() => {
        emit('annotations:updated', { count: ids.length })
        if ('groupId' in patch) bumpRevision()
      })
      .catch(() => {
        setStatus('error')
        emit('annotations:updated:error', { count: ids.length })
      })
  }

  const deleteMany = (ids: string[]) => {
    if (!canEdit) {
      emit('collection:read-only')
      return null
    }
    const wanted = new Set(ids)
    const removed = annotations.filter((a) => wanted.has(a.id))
    if (collectionId === null || removed.length === 0) return null

    for (const a of removed) deletedIdsRef.current.add(a.id)
    setAnnotations((current) => current.filter((a) => !wanted.has(a.id)))
    setSelectedAnnotationId((current) => (current && wanted.has(current) ? null : current))
    setViewedAnnotationId((current) => (current && wanted.has(current) ? null : current))
    for (const a of removed) sendOp({ kind: 'delete', entity: 'annotation', id: a.id })

    const key = nextRemovalRef.current++
    setRemovals((current) => [...current, { key, items: removed, settledAt: null }])
    const { deleted, undo } = deleteAsOneChange(
      removed.map((a) => a.id),
      (batch, headers) =>
        authFetch(`${baseUrl}/annotations/bulk-delete`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ collectionId, ids: batch }),
        }),
      (path) => authFetch(`${baseUrl}${path}`, { method: 'POST' })
    )
    deleted
      .catch(() => emit('annotations:deleted:error', { count: removed.length }))
      .finally(() => {
        bumpRevision()
        const settledAt = revisionRef.current
        setRemovals((current) => current.map((r) => (r.key === key ? { ...r, settledAt } : r)))
        // Every fetch made since has caught up well before this.
        setTimeout(() => setRemovals((current) => current.filter((r) => r.key !== key)), REMOVAL_KEEP_MS)
      })

    let undone = false
    return () => {
      if (undone) return
      undone = true
      undo()
        .then(() => {
          setRemovals((current) => current.filter((r) => r.key !== key))
          addRestored(removed)
          for (const a of removed) sendOp({ kind: 'create', entity: 'annotation', id: a.id, data: a })
        })
        .catch(() => emit('annotations:restored:error', { count: removed.length }))
    }
  }

  const markGrouped = (ids: string[], groupId: string) => {
    const wanted = new Set(ids)
    setAnnotations((current) => current.map((a) => (wanted.has(a.id) ? { ...a, groupId } : a)))
    for (const id of ids) sendOp({ kind: 'update', entity: 'annotation', id, data: { groupId } })
  }

  const forgetGroup = useCallback((groupId: string) => {
    setAnnotations((current) => current.map((a) => (a.groupId === groupId ? { ...a, groupId: null } : a)))
  }, [])

  // annotation-store's PUT replaces label, notes and colour together, so
  // pass all three.
  const updateAnnotation = (id: string, patch: Pick<Annotation, 'label' | 'notes' | 'colour'>) => {
    if (deletedIdsRef.current.has(id)) return
    setAnnotations((current) => current.map((a) => (a.id === id ? { ...a, ...patch } : a)))
    emit('annotation:updated', { id, patch })
    sendOp({ kind: 'update', entity: 'annotation', id, data: patch })
    authFetch(`${baseUrl}/annotations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, slideId }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
      })
      .catch(() => {
        setStatus('error')
        emit('annotation:updated:error', { id, patch })
      })
  }

  const deleteAnnotation = (id: string) => {
    deletedIdsRef.current.add(id)
    setAnnotations((current) => current.filter((a) => a.id !== id))
    setViewedAnnotationId((current) => (current === id ? null : current))
    emit('annotation:deleted', { id })
    sendOp({ kind: 'delete', entity: 'annotation', id })
    authFetch(`${baseUrl}/annotations/${id}`, { method: 'DELETE' })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
      })
      .catch(() => {
        setStatus('error')
        emit('annotation:deleted:error', { id })
      })
      .finally(bumpRevision)
  }

  return (
    <AnnotationStoreContext.Provider
      value={{
        annotations,
        status,
        revision,
        wasDeleted,
        baseUrl,
        total,
        seenTotal: fetchedTotal.seen,
        pendingRemoved,
        mapFilter,
        setMapFilter,
        selectedAnnotationId,
        viewedAnnotationId,
        annotationsSource: annotationsSourceRef.current,
        addAnnotation,
        addImported,
        addRestored,
        updateMany,
        deleteMany,
        markGrouped,
        forgetGroup,
        updateAnnotation,
        deleteAnnotation,
        setSelectedAnnotationId,
        setViewedAnnotationId,
      }}
    >
      {children}
    </AnnotationStoreContext.Provider>
  )
}

function useAnnotationStoreContext(): AnnotationStoreContextValue {
  const context = useContext(AnnotationStoreContext)
  if (!context) {
    throw new Error('useAnnotationStoreContext must be used within an AnnotationStoreContextProvider')
  }
  return context
}

export { AnnotationStoreContextProvider, useAnnotationStoreContext, UNDO_DELETE_MS }
export type { BulkPatch, MapFilter }
