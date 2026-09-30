import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type ToolId = 'annotations' | 'cellcount' | 'rotate' | 'ruler' | 'adjustments' | 'realtime'

interface ToolbarContextValue {
  activeTools: ToolId[]
  toggleTool: (id: ToolId) => void
  // Opens it if it isn't already - for things like a comparison invite
  // that need a panel showing.
  openTool: (id: ToolId) => void
}

const ToolbarContext = createContext<ToolbarContextValue | null>(null)

function ToolbarContextProvider({ children }: { children: ReactNode }) {
  const [activeTools, setActiveTools] = useState<ToolId[]>([])

  const toggleTool = (id: ToolId) => {
    setActiveTools((current) =>
      current.includes(id) ? current.filter((tool) => tool !== id) : [...current, id]
    )
  }

  const openTool = useCallback((id: ToolId) => {
    setActiveTools((current) => (current.includes(id) ? current : [...current, id]))
  }, [])

  return (
    <ToolbarContext.Provider value={{ activeTools, toggleTool, openTool }}>
      {children}
    </ToolbarContext.Provider>
  )
}

function useToolbarContext(): ToolbarContextValue {
  const context = useContext(ToolbarContext)
  if (!context) {
    throw new Error('useToolbarContext must be used within a ToolbarContextProvider')
  }
  return context
}

export { ToolbarContextProvider, useToolbarContext }
export type { ToolId }
