import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import VectorSource from 'ol/source/Vector'
import type { Annotation } from '../interfaces/Annotation'
import { useImageViewerContext } from './ImageViewerContext'
import { useEmitEvent } from './EventContext'
import { useCollectionContext } from './CollectionContext'
import { mergePolledItems } from './pollMerge'

type Status = 'loading' | 'ready' | 'error'

const POLL_INTERVAL_MS = 5000

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
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void
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
  const { collectionId, status: collectionStatus } = useCollectionContext()

  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const annotationsSourceRef = useRef(new VectorSource())
  // Ids this tab has added/deleted locally but whose POST/DELETE hasn't
  // round-tripped yet - guards the poll below from clobbering an in-flight
  // create or resurrecting an in-flight delete. Refs, not state: they don't
  // need to trigger a render, just be current when a poll tick reads them.
  const pendingCreateIdsRef = useRef<Set<string>>(new Set())
  const pendingDeleteIdsRef = useRef<Set<string>>(new Set())

  // Load whatever's already saved for this slide - the reason to have a
  // backend at all is that this survives a reload, unlike plain React state.
  useEffect(() => {
    let cancelled = false

    // A ref set from the previous collection means nothing once collectionId
    // changes - carrying it over could wrongly preserve/suppress an id that
    // just happens to collide in the new collection's list.
    pendingCreateIdsRef.current.clear()
    pendingDeleteIdsRef.current.clear()

    if (collectionId === null) {
      setStatus(collectionStatus === 'error' ? 'error' : 'loading')
      setAnnotations([])
      return
    }

    setStatus('loading')

    fetch(`${baseUrl}/annotations?collectionId=${encodeURIComponent(collectionId)}`)
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
  }, [baseUrl, slideId, collectionId, collectionStatus, emit])

  // The load above only runs once per collection, so an annotation written
  // straight against the store by something other than this tab (a second
  // collaborator) would otherwise only ever show up after a manual reload.
  // This polls for that, merging against this tab's own pending
  // creates/deletes so a tick landing mid-write can't clobber or resurrect
  // one (see mergePolledItems).
  useEffect(() => {
    if (collectionId === null || status === 'error') return

    let cancelled = false

    const poll = () => {
      fetch(`${baseUrl}/annotations?collectionId=${encodeURIComponent(collectionId)}`)
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status))
          return response.json() as Promise<Annotation[]>
        })
        .then((data) => {
          if (cancelled) return
          setAnnotations((current) =>
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

  // Writes are optimistic - update local state immediately for a responsive
  // UI (and emit the corresponding event right away), fire the request, and
  // emit a matching :error event - separately - if it didn't actually
  // persist. Fine for a proof of concept; a real conflict/rollback story can
  // wait until this has more than one collaborator writing to it.
  const addAnnotation = (annotation: Annotation) => {
    // Neither the draw tools nor AddAnnotationForm wait on this context's own
    // status before letting a save happen - collectionId can still be null
    // this early. Posting null there would 400 against the backend's
    // non-nullable CollectionId, so this bails before the optimistic add
    // ever makes the annotation look saved when it can't be.
    if (collectionId === null) {
      emit('annotation:created:error', annotation)
      return
    }
    pendingCreateIdsRef.current.add(annotation.id)
    setAnnotations((current) => [...current, annotation])
    emit('annotation:created', annotation)
    fetch(`${baseUrl}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...annotation, collectionId }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        pendingCreateIdsRef.current.delete(annotation.id)
      })
      .catch(() => {
        pendingCreateIdsRef.current.delete(annotation.id)
        setStatus('error')
        emit('annotation:created:error', annotation)
      })
  }

  const updateAnnotation = (id: string, patch: Partial<Annotation>) => {
    setAnnotations((current) => current.map((a) => (a.id === id ? { ...a, ...patch } : a)))
    emit('annotation:updated', { id, patch })
    fetch(`${baseUrl}/annotations/${id}`, {
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
    pendingDeleteIdsRef.current.add(id)
    setAnnotations((current) => current.filter((a) => a.id !== id))
    emit('annotation:deleted', { id })
    fetch(`${baseUrl}/annotations/${id}`, { method: 'DELETE' })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        pendingDeleteIdsRef.current.delete(id)
      })
      .catch(() => {
        pendingDeleteIdsRef.current.delete(id)
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
