import { createContext, useContext, useState, type ReactNode } from 'react'
import type Feature from 'ol/Feature'
import type Geometry from 'ol/geom/Geometry'
import type { ShapeTool, LineStyleName } from '../components/annotation/Tools'

interface PendingAnnotation {
  feature: Feature<Geometry>
  shape: ShapeTool
}

// Quick draw skips the naming form - every shape drawn while it's on is
// saved straight away with this label/notes.
interface QuickDraw {
  enabled: boolean
  label: string
  notes: string
}

interface DrawContextValue {
  activeTool: ShapeTool | null
  colour: string
  lineThickness: number
  lineStyle: LineStyleName
  pending: PendingAnnotation | null
  quickDraw: QuickDraw
  setActiveTool: (tool: ShapeTool | null) => void
  setColour: (colour: string) => void
  setLineThickness: (thickness: number) => void
  setLineStyle: (style: LineStyleName) => void
  setPending: (pending: PendingAnnotation | null) => void
  setQuickDraw: (quickDraw: QuickDraw) => void
}

const DrawContext = createContext<DrawContextValue | null>(null)

function DrawContextProvider({ children }: { children: ReactNode }) {
  const [activeTool, setActiveTool] = useState<ShapeTool | null>(null)
  const [colour, setColour] = useState('#fff614')
  const [lineThickness, setLineThickness] = useState(2)
  const [lineStyle, setLineStyle] = useState<LineStyleName>('solid')
  const [pending, setPending] = useState<PendingAnnotation | null>(null)
  const [quickDraw, setQuickDraw] = useState<QuickDraw>({ enabled: false, label: '', notes: '' })

  return (
    <DrawContext.Provider
      value={{
        activeTool,
        colour,
        lineThickness,
        lineStyle,
        pending,
        quickDraw,
        setActiveTool,
        setColour,
        setLineThickness,
        setLineStyle,
        setPending,
        setQuickDraw,
      }}
    >
      {children}
    </DrawContext.Provider>
  )
}

function useDrawContext(): DrawContextValue {
  const context = useContext(DrawContext)
  if (!context) {
    throw new Error('useDrawContext must be used within a DrawContextProvider')
  }
  return context
}

export { DrawContextProvider, useDrawContext }
export type { PendingAnnotation, QuickDraw }
