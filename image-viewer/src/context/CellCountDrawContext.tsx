import { createContext, useContext, useState, type ReactNode } from 'react'
import type { CellCountDot } from '../interfaces/CellCount'

interface CellCountLocation {
  x: number
  y: number
}

// Assembled by MapNode (not CellCounterToolPicker) once counting stops - it's
// the one place with both the map (for `location`/`dots`, both only
// knowable from the placed dot features) and the session's context values,
// so it snapshots dotSize/location/dots itself rather than trusting values
// a caller might pass stale. There's no single `colour` here - colour can
// change live per-dot during a session (see CellCounterDuring), so each
// dot carries its own.
interface PendingCellCount {
  count: number
  withAnnotation: boolean
  withRoi: boolean
  dots: CellCountDot[]
  dotSize: number
  location: CellCountLocation | null
  // ROI box as GeoJson, null unless withRoi was on. Read off the actual
  // box feature when counting stops, not recomputed from boxSizeMicrons -
  // the box can be dragged from where it started.
  roiGeoJson: string | null
}

interface CellCountDrawContextValue {
  counting: boolean
  colour: string
  dotSize: number
  count: number
  withAnnotation: boolean
  withRoi: boolean
  boxSizeMicrons: number
  roiConfirmed: boolean
  pending: PendingCellCount | null
  setCounting: (counting: boolean) => void
  setColour: (colour: string) => void
  setDotSize: (size: number) => void
  setWithAnnotation: (withAnnotation: boolean) => void
  setWithRoi: (withRoi: boolean) => void
  setBoxSizeMicrons: (size: number) => void
  setRoiConfirmed: (confirmed: boolean) => void
  incrementCount: () => void
  decrementCount: () => void
  resetCount: () => void
  setPending: (pending: PendingCellCount | null) => void
  // Undo/redo actually happens in MapNode (it's the one holding both the
  // placed-dot features and the map to remove/re-add them from) - these
  // are just a request bell CellCounterDuring's Undo/Redo buttons can
  // ring from a different component, each incrementing a counter MapNode
  // watches for changes on. MapNode's own Z/Y keydown handling calls its
  // undo/redo directly, since it's already the one holding them.
  undoSignal: number
  redoSignal: number
  requestUndo: () => void
  requestRedo: () => void
}

const CellCountDrawContext = createContext<CellCountDrawContextValue | null>(null)

const DEFAULT_BOX_SIZE_MICRONS = 500

// Mirrors DrawContext, but a cell count is built from discrete map clicks
// over time rather than one continuous drag gesture - `counting` (like
// activeTool) gates a click interaction in MapNode, `count` ticks up live
// as each click lands, and stopping freezes it into `pending` for the
// save screen, same shape as a just-drawn annotation. withAnnotation and
// withRoi are decided before counting starts (see CellCounterToolPicker)
// since they change how MapNode handles each click - whether it draws a
// dot, and whether it's confined to an ROI box - so they ride along into
// `pending` rather than being asked again at save time. roiConfirmed gates
// a second phase within an ROI session: the box can be dragged into place
// first, and clicks only start tallying once it's confirmed - otherwise
// placing the box would itself register as clicks.
function CellCountDrawContextProvider({ children }: { children: ReactNode }) {
  const [counting, setCounting] = useState(false)
  const [colour, setColour] = useState('#fff614')
  const [dotSize, setDotSize] = useState(6)
  const [count, setCount] = useState(0)
  const [withAnnotation, setWithAnnotation] = useState(true)
  const [withRoi, setWithRoi] = useState(false)
  const [boxSizeMicrons, setBoxSizeMicrons] = useState(DEFAULT_BOX_SIZE_MICRONS)
  const [roiConfirmed, setRoiConfirmed] = useState(false)
  const [pending, setPending] = useState<PendingCellCount | null>(null)
  const [undoSignal, setUndoSignal] = useState(0)
  const [redoSignal, setRedoSignal] = useState(0)

  const incrementCount = () => setCount((current) => current + 1)
  const decrementCount = () => setCount((current) => Math.max(0, current - 1))
  const resetCount = () => setCount(0)
  const requestUndo = () => setUndoSignal((current) => current + 1)
  const requestRedo = () => setRedoSignal((current) => current + 1)

  return (
    <CellCountDrawContext.Provider
      value={{
        counting,
        colour,
        dotSize,
        count,
        withAnnotation,
        withRoi,
        boxSizeMicrons,
        roiConfirmed,
        pending,
        setCounting,
        setColour,
        setDotSize,
        setWithAnnotation,
        setWithRoi,
        setBoxSizeMicrons,
        setRoiConfirmed,
        incrementCount,
        decrementCount,
        resetCount,
        setPending,
        undoSignal,
        redoSignal,
        requestUndo,
        requestRedo,
      }}
    >
      {children}
    </CellCountDrawContext.Provider>
  )
}

function useCellCountDrawContext(): CellCountDrawContextValue {
  const context = useContext(CellCountDrawContext)
  if (!context) {
    throw new Error('useCellCountDrawContext must be used within a CellCountDrawContextProvider')
  }
  return context
}

export { CellCountDrawContextProvider, useCellCountDrawContext }
export type { PendingCellCount, CellCountLocation }
