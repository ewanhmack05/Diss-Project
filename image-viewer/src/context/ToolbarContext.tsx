import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type ToolId = 'annotations' | 'cellcount' | 'rotate' | 'ruler' | 'adjustments' | 'realtime'

// What each panel is called, for anything that has to name one.
const TOOL_NAMES: Record<ToolId, string> = {
  annotations: 'Annotations',
  cellcount: 'Cell Count',
  rotate: 'Rotate',
  ruler: 'Ruler',
  adjustments: 'Adjustments',
  realtime: 'RealTime',
}

interface ToolbarContextValue {
  activeTools: ToolId[]
  toggleTool: (id: ToolId) => void
  // Opens it if it isn't already - for things like a comparison invite
  // that need a panel showing.
  openTool: (id: ToolId) => void
  closeTool: (id: ToolId) => void
  // Which tab each panel is on, for panels that have them - kept here
  // rather than in the panel so Present can follow the host's.
  panelTabs: Partial<Record<ToolId, string>>
  setPanelTab: (id: ToolId, tab: string) => void
}

const ToolbarContext = createContext<ToolbarContextValue | null>(null)

function ToolbarContextProvider({ children }: { children: ReactNode }) {
  const [activeTools, setActiveTools] = useState<ToolId[]>([])
  const [panelTabs, setPanelTabs] = useState<Partial<Record<ToolId, string>>>({})

  // A panel opens on its first tab again after being closed.
  const forgetTab = useCallback((id: ToolId) => {
    setPanelTabs((current) => {
      if (!(id in current)) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }, [])

  const toggleTool = (id: ToolId) => {
    if (activeTools.includes(id)) forgetTab(id)
    setActiveTools((current) =>
      current.includes(id) ? current.filter((tool) => tool !== id) : [...current, id]
    )
  }

  const openTool = useCallback((id: ToolId) => {
    setActiveTools((current) => (current.includes(id) ? current : [...current, id]))
  }, [])

  const closeTool = useCallback(
    (id: ToolId) => {
      forgetTab(id)
      setActiveTools((current) => (current.includes(id) ? current.filter((tool) => tool !== id) : current))
    },
    [forgetTab]
  )

  const setPanelTab = useCallback((id: ToolId, tab: string) => {
    setPanelTabs((current) => (current[id] === tab ? current : { ...current, [id]: tab }))
  }, [])

  return (
    <ToolbarContext.Provider value={{ activeTools, toggleTool, openTool, closeTool, panelTabs, setPanelTab }}>
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

export { ToolbarContextProvider, useToolbarContext, TOOL_NAMES }
export type { ToolId }
