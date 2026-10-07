import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

// A button on a popup. Every button closes it, after running onClick.
interface DialogAction {
  label: string
  onClick?: () => void
  variant?: 'accent' | 'danger'
}

interface Dialog {
  id: string
  title: string
  message: string
  // At least one, or there'd be no way out. Escape runs the last one.
  actions: DialogAction[]
}

interface DialogContextValue {
  // The one on screen - the rest wait their turn.
  current: Dialog | null
  showDialog: (dialog: Omit<Dialog, 'id'>) => string
  closeDialog: (id: string) => void
}

const DialogContext = createContext<DialogContextValue | null>(null)

// Popups for things that need noticing, like being taken out of a session -
// a toast is too easy to miss when what you're looking at changes under you.
function DialogContextProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Dialog[]>([])
  const nextId = useRef(0)

  const showDialog = useCallback((dialog: Omit<Dialog, 'id'>) => {
    const id = `dialog-${nextId.current++}`
    const actions = dialog.actions.length > 0 ? dialog.actions : [{ label: 'OK' }]
    setQueue((current) => [...current, { ...dialog, actions, id }])
    return id
  }, [])

  const closeDialog = useCallback((id: string) => {
    setQueue((current) => current.filter((dialog) => dialog.id !== id))
  }, [])

  return (
    <DialogContext.Provider value={{ current: queue[0] ?? null, showDialog, closeDialog }}>
      {children}
    </DialogContext.Provider>
  )
}

function useDialogContext(): DialogContextValue {
  const context = useContext(DialogContext)
  if (!context) {
    throw new Error('useDialogContext must be used within a DialogContextProvider')
  }
  return context
}

export { DialogContextProvider, useDialogContext }
export type { Dialog, DialogAction }
