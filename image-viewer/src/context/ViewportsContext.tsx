import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

interface ViewportsContextValue {
  // The user id of whoever's name the pointer is over, in the chips on the
  // map or the Realtime panel's People list. Their box shows and is picked
  // out, even if it's switched off.
  pointedAt: string | null
  pointAt: (userId: string | null) => void
  // Boxes you've switched on or off yourself, by user id. Anyone not in
  // here follows the default - see viewportShown.
  shown: Record<string, boolean>
  setShown: (userId: string, on: boolean) => void
}

const ViewportsContext = createContext<ViewportsContextValue | null>(null)

// Which of everyone else's viewport boxes you see. Yours alone - nobody else
// hears what you switch on or off. Its own context rather than part of
// RealtimeContext, so hovering a name doesn't re-render everything that
// uses that.
function ViewportsContextProvider({ children }: { children: ReactNode }) {
  const [pointedAt, pointAt] = useState<string | null>(null)
  const [shown, setShownState] = useState<Record<string, boolean>>({})
  const setShown = useCallback((userId: string, on: boolean) => setShownState((current) => ({ ...current, [userId]: on })), [])
  return (
    <ViewportsContext.Provider value={{ pointedAt, pointAt, shown, setShown }}>{children}</ViewportsContext.Provider>
  )
}

function useViewportsContext(): ViewportsContextValue {
  const context = useContext(ViewportsContext)
  if (!context) {
    throw new Error('useViewportsContext must be used within a ViewportsContextProvider')
  }
  return context
}

// Hover and keyboard focus on a name both point at that person.
function pointerProps(userId: string, pointAt: (userId: string | null) => void) {
  return {
    onMouseEnter: () => pointAt(userId),
    onMouseLeave: () => pointAt(null),
    onFocus: () => pointAt(userId),
    onBlur: () => pointAt(null),
  }
}

export { ViewportsContextProvider, useViewportsContext, pointerProps }
