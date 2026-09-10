import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import VectorSource from 'ol/source/Vector'
import type { Annotation } from '../interfaces/Annotation'
import { useImageViewerContext } from './ImageViewerContext'

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
  // Notifies App's `on` prop, if given, about annotation CRUD - the viewer's
  // public event surface for a host that wants to observe changes.
  onEvent?: (event: string, payload: unknown) => void
  children: ReactNode
}

function AnnotationStoreContextProvider({
  baseUrl,
  onEvent,
  children,
}: AnnotationStoreContextProviderProps) {
  const { source } = useImageViewerContext()
  const { slideId } = source

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
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [baseUrl, slideId])

  // Writes are optimistic - update local state immediately for a responsive
  // UI, fire the request, and fall back to an error status if it didn't
  // actually persist. Fine for a proof of concept; a real conflict/rollback
  // story can wait until this has more than one collaborator writing to it.
  const addAnnotation = (annotation: Annotation) => {
    setAnnotations((current) => [...current, annotation])
    onEvent?.('annotation:created', annotation)
    fetch(`${baseUrl}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...annotation, slideId }),
    }).catch(() => setStatus('error'))
  }

  const updateAnnotation = (id: string, patch: Partial<Annotation>) => {
    setAnnotations((current) => current.map((a) => (a.id === id ? { ...a, ...patch } : a)))
    onEvent?.('annotation:updated', { id, patch })
    fetch(`${baseUrl}/annotations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, slideId }),
    }).catch(() => setStatus('error'))
  }

  const deleteAnnotation = (id: string) => {
    setAnnotations((current) => current.filter((a) => a.id !== id))
    onEvent?.('annotation:deleted', { id })
    fetch(`${baseUrl}/annotations/${id}`, { method: 'DELETE' }).catch(() => setStatus('error'))
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
