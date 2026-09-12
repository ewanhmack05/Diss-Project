import { useCellCountDrawContext } from '../../../context/CellCountDrawContext'
import { DotSizeOptions } from '../Tools'
import ColourPicker from '../../colour-picker/ColourPicker'
import './CellCounterToolPicker.css'

// Rendered for the whole time counting is active (see CellCounter) - first
// the ROI placement step if withRoi is on and not yet confirmed, then the
// live tally itself. Reuses CellCounterToolPicker's stylesheet/class names
// since it's the same panel, just swapped out for the counting phase.
function CellCounterDuring() {
  const {
    colour,
    dotSize,
    count,
    withRoi,
    roiConfirmed,
    setColour,
    setDotSize,
    setCounting,
    setRoiConfirmed,
    resetCount,
    requestUndo,
    requestRedo,
  } = useCellCountDrawContext()

  // Just flips `counting` off - MapNode is the one that actually assembles
  // `pending` (it's the only place with both the map, for `location`, and
  // the live session values), triggered off that same transition.
  const handleStop = () => {
    setCounting(false)
  }

  // Backs out of ROI placement without ever confirming it - MapNode sees
  // the same counting=true->false transition as handleStop, but reads
  // roiConfirmed still false at that instant and treats it as a discard
  // rather than a finished session, so this never reaches the save screen.
  const handleCancelPlacement = () => {
    resetCount()
    setCounting(false)
  }

  if (withRoi && !roiConfirmed) {
    return (
      <div className="cell-counter-tool-picker">
        <p className="cell-counter-tool-picker-hint">
          Drag the box into position, then confirm to start counting.
        </p>
        <div className="cell-counter-tool-picker-actions">
          <button type="button" className="cell-counter-tool-picker-button" onClick={handleCancelPlacement}>
            Cancel
          </button>
          <button
            type="button"
            className="cell-counter-tool-picker-button cell-counter-tool-picker-button--primary"
            onClick={() => setRoiConfirmed(true)}
          >
            Confirm placement
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="cell-counter-tool-picker">
      <label className="cell-counter-tool-picker-field">
        Dot size
        <select value={dotSize} onChange={(e) => setDotSize(Number(e.target.value))}>
          {DotSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}px
            </option>
          ))}
        </select>
      </label>

      <ColourPicker value={colour} onChange={setColour} />

      <div className="cell-counter-tool-picker-actions">
        <button type="button" className="cell-counter-tool-picker-button" onClick={requestUndo}>
          Undo
        </button>
        <button type="button" className="cell-counter-tool-picker-button" onClick={requestRedo}>
          Redo
        </button>
      </div>

      <p className="cell-counter-tool-picker-tally">Count: {count}</p>
      <button
        type="button"
        className="cell-counter-tool-picker-button cell-counter-tool-picker-button--primary"
        onClick={handleStop}
      >
        Stop counting
      </button>
      <p className="cell-counter-tool-picker-hint">
        {withRoi ? 'Click inside the box to tally a cell.' : 'Click on the image to tally a cell.'}
        {' '}Z to undo, Y to redo.
      </p>
    </div>
  )
}

export default CellCounterDuring
