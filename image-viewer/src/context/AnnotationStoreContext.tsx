import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Annotation } from '../interfaces/Annotation'

interface AnnotationStoreContextValue {
  annotations: Annotation[]
  addAnnotation: (annotation: Annotation) => void
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void
  deleteAnnotation: (id: string) => void
}

const AnnotationStoreContext = createContext<AnnotationStoreContextValue | null>(null)

// Holds annotations purely in memory for now - no REST client to a backend
// annotation-store service yet, per the project's current scope.
function AnnotationStoreContextProvider({ children }: { children: ReactNode }) {
  const [annotations, setAnnotations] = useState<Annotation[]>([])

  const addAnnotation = (annotation: Annotation) => {
    setAnnotations((current) => [...current, annotation])
  }

  const updateAnnotation = (id: string, patch: Partial<Annotation>) => {
    setAnnotations((current) => current.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }

  const deleteAnnotation = (id: string) => {
    setAnnotations((current) => current.filter((a) => a.id !== id))
  }

  return (
    <AnnotationStoreContext.Provider
      value={{ annotations, addAnnotation, updateAnnotation, deleteAnnotation }}
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
