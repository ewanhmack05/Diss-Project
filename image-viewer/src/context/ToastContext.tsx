import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

type ToastVariant = 'success' | 'error' | 'info'

// A button on a toast, e.g. "Go" / "Ignore" on a request. Clicking one
// also dismisses the toast.
interface ToastAction {
  label: string
  onClick?: () => void
  primary?: boolean
}

interface ToastOptions {
  actions?: ToastAction[]
  // In ms. null keeps it up until it's dismissed or an action is clicked.
  duration?: number | null
}

interface Toast {
  id: string
  message: string
  variant: ToastVariant
  actions: ToastAction[]
}

interface ToastContextValue {
  toasts: Toast[]
  // Returns the toast's id, so it can be taken down early.
  addToast: (message: string, variant: ToastVariant, options?: ToastOptions) => string
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TOAST_DURATION_MS = 5000
// Longer when there's something to click, so there's time to read it first.
const ACTION_TOAST_DURATION_MS = 15000

function ToastContextProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const addToast = useCallback(
    (message: string, variant: ToastVariant, options?: ToastOptions) => {
      const id = `toast-${nextId.current++}`
      const actions = options?.actions ?? []
      setToasts((current) => [...current, { id, message, variant, actions }])
      const duration =
        options?.duration !== undefined ? options.duration : actions.length > 0 ? ACTION_TOAST_DURATION_MS : TOAST_DURATION_MS
      if (duration !== null) setTimeout(() => removeToast(id), duration)
      return id
    },
    [removeToast]
  )

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  )
}

function useToastContext(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToastContext must be used within a ToastContextProvider')
  }
  return context
}

export { ToastContextProvider, useToastContext }
export type { Toast, ToastAction, ToastOptions, ToastVariant }
