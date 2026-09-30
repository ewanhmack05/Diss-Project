import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import VectorSource from 'ol/source/Vector'
import type { Annotation } from '../interfaces/Annotation'
import { useImageViewerContext } from './ImageViewerContext'
import { useEmitEvent } from './EventContext'
import { useCollectionContext } from './CollectionContext'
import { useRealtimeContext } from './RealtimeContext'
import { useAuthContext } from './AuthContext'
import { applyOp, isForCollection, type AnnotationOp } from '../components/realtime/realtime'

type Status = 'loading' | 'ready' | 'error'

interface AnnotationStoreContextValue {
  annotations: Annotation[]
  status: Status
  selectedAnnotationId: string | null
  // The OL features MapNode renders saved annotations as - shared here (not
  // owned by MapNode) so editing UI (colour changes, etc.) can preview
  // directly against the live map feature, the same way AddAnnotationForm
  // does against a pending draw's feature.
  annotationsSource: VectorSource
  addAnnotation: (annotation: Annotation) => void
  updateAnnotation: (id: string, patch: Pick<Annotation, 'label' | 'notes' | 'colour'>) => void
  deleteAnnotation: (id: string) => void
  setSelectedAnnotationId: (id: string | null) => void
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
  // Every op says which collection it's for - see isForCollection.
  const send = (op: AnnotationOp) => sendOp({ ...op, collectionId: collectionId ?? undefined })

  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
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
        if (op.entity !== 'annotation' || !isForCollection(op, collectionId)) return
        if (op.kind === 'delete') deletedIdsRef.current.add(op.id)
        setAnnotations((current) => applyOp(current, op))
        if (op.kind === 'delete') setSelectedAnnotationId((current) => (current === op.id ? null : current))
      }),
    [onOp, collectionId]
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
    send({ kind: 'create', entity: 'annotation', id: annotation.id, data: annotation })
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
  }

  // annotation-store's PUT replaces label, notes and colour together, so
  // pass all three.
  const updateAnnotation = (id: string, patch: Pick<Annotation, 'label' | 'notes' | 'colour'>) => {
    if (deletedIdsRef.current.has(id)) return
    setAnnotations((current) => current.map((a) => (a.id === id ? { ...a, ...patch } : a)))
    emit('annotation:updated', { id, patch })
    send({ kind: 'update', entity: 'annotation', id, data: patch })
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
    emit('annotation:deleted', { id })
    send({ kind: 'delete', entity: 'annotation', id })
    authFetch(`${baseUrl}/annotations/${id}`, { method: 'DELETE' })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
      })
      .catch(() => {
        setStatus('error')
        emit('annotation:deleted:error', { id })
      })
  }

  return (
    <AnnotationStoreContext.Provider
      value={{
        annotations,
        status,
        selectedAnnotationId,
        annotationsSource: annotationsSourceRef.current,
        addAnnotation,
        updateAnnotation,
        deleteAnnotation,
        setSelectedAnnotationId,
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

export { AnnotationStoreContextProvider, useAnnotationStoreContext }
