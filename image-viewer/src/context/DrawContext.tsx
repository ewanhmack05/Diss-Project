import { createContext, useContext, useState, type ReactNode } from 'react'
import type Feature from 'ol/Feature'
import type Geometry from 'ol/geom/Geometry'
import type { ShapeTool, LineStyleName } from '../components/annotation/Tools'

interface PendingAnnotation {
  feature: Feature<Geometry>
  shape: ShapeTool
}

interface DrawContextValue {
  activeTool: ShapeTool | null
  colour: string
  lineThickness: number
  lineStyle: LineStyleName
  pending: PendingAnnotation | null
  setActiveTool: (tool: ShapeTool | null) => void
  setColour: (colour: string) => void
  setLineThickness: (thickness: number) => void
  setLineStyle: (style: LineStyleName) => void
  setPending: (pending: PendingAnnotation | null) => void
}

const DrawContext = createContext<DrawContextValue | null>(null)

function DrawContextProvider({ children }: { children: ReactNode }) {
  const [activeTool, setActiveTool] = useState<ShapeTool | null>(null)
  const [colour, setColour] = useState('#fff614')
  const [lineThickness, setLineThickness] = useState(2)
  const [lineStyle, setLineStyle] = useState<LineStyleName>('solid')
  const [pending, setPending] = useState<PendingAnnotation | null>(null)

  return (
    <DrawContext.Provider
      value={{
        activeTool,
        colour,
        lineThickness,
        lineStyle,
        pending,
        setActiveTool,
        setColour,
        setLineThickness,
        setLineStyle,
        setPending,
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
export type { PendingAnnotation }
