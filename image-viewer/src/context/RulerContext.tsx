import { createContext, useContext, useState, type ReactNode } from 'react'

interface Measurement {
  pixelDistance: number
  // null when the slide has no openslide.mpp-x/-y (a format that doesn't
  // report it) - the panel falls back to showing pixelDistance instead.
  realDistanceMicrons: number | null
}

interface RulerContextValue {
  lastMeasurement: Measurement | null
  setLastMeasurement: (measurement: Measurement | null) => void
  // Bumped by clearMeasurement - MapNode watches this to remove the drawn
  // line from the map, the same way CellCountDrawContext's undoSignal/
  // redoSignal tell it to act without owning the map itself.
  clearSignal: number
  clearMeasurement: () => void
}

const RulerContext = createContext<RulerContextValue | null>(null)

function RulerContextProvider({ children }: { children: ReactNode }) {
  const [lastMeasurement, setLastMeasurement] = useState<Measurement | null>(null)
  const [clearSignal, setClearSignal] = useState(0)

  const clearMeasurement = () => {
    setLastMeasurement(null)
    setClearSignal((signal) => signal + 1)
  }

  return (
    <RulerContext.Provider value={{ lastMeasurement, setLastMeasurement, clearSignal, clearMeasurement }}>
      {children}
    </RulerContext.Provider>
  )
}

function useRulerContext(): RulerContextValue {
  const context = useContext(RulerContext)
  if (!context) {
    throw new Error('useRulerContext must be used within a RulerContextProvider')
  }
  return context
}

export { RulerContextProvider, useRulerContext }
export type { Measurement }
