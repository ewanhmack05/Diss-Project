import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { useToastContext } from './ToastContext'

type EmitEvent = (event: string, payload?: unknown) => void

const EventContext = createContext<EmitEvent | null>(null)

// Maps the viewer's public event names (see App's `on` prop) to a toast.
// Covers annotation CRUD outcomes - both the optimistic local change and,
// separately, whether it actually persisted - plus the two connection
// failures a host can't otherwise see (tiler, annotation store).
const TOAST_MESSAGES: Record<string, { message: string; variant: 'success' | 'error' }> = {
  'annotation:created': { message: 'Annotation saved', variant: 'success' },
  'annotation:created:error': { message: "Couldn't save annotation", variant: 'error' },
  'annotation:updated': { message: 'Annotation updated', variant: 'success' },
  'annotation:updated:error': { message: "Couldn't update annotation", variant: 'error' },
  'annotation:deleted': { message: 'Annotation deleted', variant: 'success' },
  'annotation:deleted:error': { message: "Couldn't delete annotation", variant: 'error' },
  'annotations:load-error': { message: "Couldn't reach the annotation store", variant: 'error' },
  'slide:load-error': { message: "Couldn't reach the tile server", variant: 'error' },
}

interface EventContextProviderProps {
  on?: (event: string, payload: unknown) => void
  children: ReactNode
}

// The single place every user-facing action funnels through: forwards to the
// host's `on` prop (if given) and, separately, surfaces a toast for it -
// both driven off the same event name/payload, per the app's public event
// vocabulary above.
function EventContextProvider({ on, children }: EventContextProviderProps) {
  const { addToast } = useToastContext()

  const emit = useCallback<EmitEvent>(
    (event, payload) => {
      on?.(event, payload)
      const toast = TOAST_MESSAGES[event]
      if (toast) addToast(toast.message, toast.variant)
    },
    [on, addToast]
  )

  return <EventContext.Provider value={emit}>{children}</EventContext.Provider>
}

function useEmitEvent(): EmitEvent {
  const context = useContext(EventContext)
  if (!context) {
    throw new Error('useEmitEvent must be used within an EventContextProvider')
  }
  return context
}

export { EventContextProvider, useEmitEvent }
