import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import VectorSource from 'ol/source/Vector'
import type { Annotation } from '../interfaces/Annotation'
import { useImageViewerContext } from './ImageViewerContext'
import { useEmitEvent } from './EventContext'

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

  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [status, setStatus] = useState<Status>('loading')
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const annotationsSourceRef = useRef(new VectorSource())

  // Load whatever's already saved for this slide - the reason to have a
  // backend at all is that this survives a reload, unlike plain React state.
  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    fetch(`${baseUrl}/annotations?slideId=${encodeURIComponent(slideId)}`)
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
  }, [baseUrl, slideId, emit])

  // Writes are optimistic - update local state immediately for a responsive
  // UI (and emit the corresponding event right away), fire the request, and
  // emit a matching :error event - separately - if it didn't actually
  // persist. Fine for a proof of concept; a real conflict/rollback story can
  // wait until this has more than one collaborator writing to it.
  const addAnnotation = (annotation: Annotation) => {
    setAnnotations((current) => [...current, annotation])
    emit('annotation:created', annotation)
    fetch(`${baseUrl}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...annotation, slideId }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
      })
      .catch(() => {
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
    setAnnotations((current) => current.filter((a) => a.id !== id))
    emit('annotation:deleted', { id })
    fetch(`${baseUrl}/annotations/${id}`, { method: 'DELETE' })
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
