import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ImageAdjustmentPreset } from '../interfaces/ImageAdjustment'
import {
  DEFAULT_ADJUSTMENTS,
  parseAdjustments,
  serializeAdjustments,
  withUpdatedAdjustments,
  type ImageAdjustmentValues,
} from '../components/adjustments/adjustments'
import { useImageViewerContext } from './ImageViewerContext'
import { useEmitEvent } from './EventContext'
import { useCollectionContext } from './CollectionContext'

type Status = 'loading' | 'ready' | 'error'

interface AdjustmentsContextValue {
  values: ImageAdjustmentValues
  setValues: (values: ImageAdjustmentValues) => void
  resetValues: () => void
  presets: ImageAdjustmentPreset[]
  status: Status
  savePreset: (name: string) => void
  applyPreset: (id: string) => void
  updatePreset: (id: string) => void
  deletePreset: (id: string) => void
}

const AdjustmentsContext = createContext<AdjustmentsContextValue | null>(null)

interface AdjustmentsContextProviderProps {
  baseUrl: string
  children: ReactNode
}

function AdjustmentsContextProvider({ baseUrl, children }: AdjustmentsContextProviderProps) {
  const { source } = useImageViewerContext()
  const { slideId } = source
  const emit = useEmitEvent()
  const { collectionId, status: collectionStatus } = useCollectionContext()

  const [values, setValues] = useState<ImageAdjustmentValues>({ ...DEFAULT_ADJUSTMENTS })
  const [presets, setPresets] = useState<ImageAdjustmentPreset[]>([])
  const [status, setStatus] = useState<Status>('loading')

  const resetValues = () => setValues({ ...DEFAULT_ADJUSTMENTS })

  // Same reasoning as AnnotationStoreContext's load effect - presets need to
  // survive a reload, so they live server-side rather than in plain state.
  useEffect(() => {
    let cancelled = false

    if (collectionId === null) {
      setStatus(collectionStatus === 'error' ? 'error' : 'loading')
      setPresets([])
      return
    }

    setStatus('loading')

    fetch(`${baseUrl}/imageadjustments?collectionId=${encodeURIComponent(collectionId)}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<ImageAdjustmentPreset[]>
      })
      .then((data) => {
        if (cancelled) return
        setPresets(data)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error')
          emit('imageadjustments:load-error', { slideId })
        }
      })

    return () => {
      cancelled = true
    }
  }, [baseUrl, slideId, collectionId, collectionStatus, emit])

  // Writes are optimistic, same pattern as AnnotationStoreContext - update
  // local state immediately, fire the request, and emit a separate :error
  // event if it didn't actually persist.
  const savePreset = (name: string) => {
    // Same reasoning as AnnotationStoreContext.addAnnotation - the panel
    // doesn't wait on this context's own status before letting Save happen.
    if (collectionId === null) {
      emit('imageadjustment:created:error', { name })
      return
    }
    const preset: ImageAdjustmentPreset = {
      imageAdjustmentId: crypto.randomUUID(),
      collectionId,
      adjustmentName: name,
      adjustments: serializeAdjustments(values),
      created: new Date().toISOString(),
    }
    setPresets((current) => [...current, preset])
    emit('imageadjustment:created', preset)
    fetch(`${baseUrl}/imageadjustments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preset),
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
      })
      .catch(() => {
        setStatus('error')
        emit('imageadjustment:created:error', preset)
      })
  }

  // Purely local - loads a saved preset's values onto the live sliders. No
  // network call: applying is just choosing what to preview, not a write.
  const applyPreset = (id: string) => {
    const preset = presets.find((p) => p.imageAdjustmentId === id)
    if (!preset) return
    setValues(parseAdjustments(preset.adjustments))
  }

  // "Overwrite this preset with what's on the sliders now."
  const updatePreset = (id: string) => {
    const preset = presets.find((p) => p.imageAdjustmentId === id)
    if (!preset) return
    const updated = withUpdatedAdjustments(preset, values)
    setPresets((current) => current.map((p) => (p.imageAdjustmentId === id ? updated : p)))
    emit('imageadjustment:updated', updated)
    fetch(`${baseUrl}/imageadjustments/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
      })
      .catch(() => {
        setStatus('error')
        emit('imageadjustment:updated:error', updated)
      })
  }

  const deletePreset = (id: string) => {
    setPresets((current) => current.filter((p) => p.imageAdjustmentId !== id))
    emit('imageadjustment:deleted', { id })
    fetch(`${baseUrl}/imageadjustments/${id}`, { method: 'DELETE' })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
      })
      .catch(() => {
        setStatus('error')
        emit('imageadjustment:deleted:error', { id })
      })
  }

  return (
    <AdjustmentsContext.Provider
      value={{
        values,
        setValues,
        resetValues,
        presets,
        status,
        savePreset,
        applyPreset,
        updatePreset,
        deletePreset,
      }}
    >
      {children}
    </AdjustmentsContext.Provider>
  )
}

function useAdjustmentsContext(): AdjustmentsContextValue {
  const context = useContext(AdjustmentsContext)
  if (!context) {
    throw new Error('useAdjustmentsContext must be used within an AdjustmentsContextProvider')
  }
  return context
}

export { AdjustmentsContextProvider, useAdjustmentsContext }
