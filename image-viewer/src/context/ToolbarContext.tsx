import { createContext, useContext, useState, type ReactNode } from 'react'

type ToolId = 'annotations' | 'cellcount' | 'rotate' | 'ruler' | 'adjustments'

interface ToolbarContextValue {
  activeTools: ToolId[]
  toggleTool: (id: ToolId) => void
}

const ToolbarContext = createContext<ToolbarContextValue | null>(null)

function ToolbarContextProvider({ children }: { children: ReactNode }) {
  const [activeTools, setActiveTools] = useState<ToolId[]>([])

  const toggleTool = (id: ToolId) => {
    setActiveTools((current) =>
      current.includes(id) ? current.filter((tool) => tool !== id) : [...current, id]
    )
  }

  return (
    <ToolbarContext.Provider value={{ activeTools, toggleTool }}>
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
