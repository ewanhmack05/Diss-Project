import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Annotation } from '../interfaces/Annotation'
import { useImageViewerContext } from './ImageViewerContext'

// annotation-store's base URL - see annotation-store/README.md for how to
// point it at a different instance.
const ANNOTATION_STORE_URL = 'http://localhost:5252'

type Status = 'loading' | 'ready' | 'error'

interface AnnotationStoreContextValue {
  annotations: Annotation[]
  status: Status
  addAnnotation: (annotation: Annotation) => void
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void
  deleteAnnotation: (id: string) => void
}

const AnnotationStoreContext = createContext<AnnotationStoreContextValue | null>(null)

function AnnotationStoreContextProvider({ children }: { children: ReactNode }) {
  const { source } = useImageViewerContext()
  const slideId = source.kind === 'tiled' ? source.slideId : source.imagePath

  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [status, setStatus] = useState<Status>('loading')

  // Load whatever's already saved for this slide - the reason to have a
  // backend at all is that this survives a reload, unlike plain React state.
  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    fetch(`${ANNOTATION_STORE_URL}/annotations?slideId=${encodeURIComponent(slideId)}`)
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
  }, [slideId])

  // Writes are optimistic - update local state immediately for a responsive
  // UI, fire the request, and fall back to an error status if it didn't
  // actually persist. Fine for a proof of concept; a real conflict/rollback
  // story can wait until this has more than one collaborator writing to it.
  const addAnnotation = (annotation: Annotation) => {
    setAnnotations((current) => [...current, annotation])
    fetch(`${ANNOTATION_STORE_URL}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...annotation, slideId }),
    }).catch(() => setStatus('error'))
  }

  const updateAnnotation = (id: string, patch: Partial<Annotation>) => {
    setAnnotations((current) => current.map((a) => (a.id === id ? { ...a, ...patch } : a)))
    fetch(`${ANNOTATION_STORE_URL}/annotations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, slideId }),
    }).catch(() => setStatus('error'))
  }

  const deleteAnnotation = (id: string) => {
    setAnnotations((current) => current.filter((a) => a.id !== id))
    fetch(`${ANNOTATION_STORE_URL}/annotations/${id}`, { method: 'DELETE' }).catch(() =>
      setStatus('error')
    )
  }

  return (
    <AnnotationStoreContext.Provider
      value={{ annotations, status, addAnnotation, updateAnnotation, deleteAnnotation }}
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
