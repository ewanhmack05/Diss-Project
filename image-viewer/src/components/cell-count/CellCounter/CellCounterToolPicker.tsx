import { useCellCountDrawContext } from '../../../context/CellCountDrawContext'
import { useDrawContext } from '../../../context/DrawContext'
import { DotSizeOptions, RoiBoxSizeOptions } from '../Tools'
import ColourPicker from '../../colour-picker/ColourPicker'
import './CellCounterToolPicker.css'

// The pre-count config screen - only rendered while idle (see CellCounter).
// Once Start is pressed, CellCounterDuring takes over for the rest of the
// session, so nothing here needs a `disabled={counting}` guard anymore.
function CellCounterToolPicker() {
  const {
    colour,
    dotSize,
    withAnnotation,
    withRoi,
    boxSizeMicrons,
    setCounting,
    setColour,
    setDotSize,
    setWithAnnotation,
    setWithRoi,
    setBoxSizeMicrons,
    setRoiConfirmed,
    resetCount,
  } = useCellCountDrawContext()
  // Mirrors FreeFormToolPicker's disabling the other way - a map click
  // can't mean both "add a shape vertex" and "tally a cell" at once, so
  // counting can't start while a shape tool is selected.
  const { activeTool } = useDrawContext()

  const handleStart = () => {
    resetCount()
    setRoiConfirmed(false)
    setCounting(true)
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

      <label className="cell-counter-tool-picker-field cell-counter-tool-picker-checkbox">
        <input
          type="checkbox"
          checked={withAnnotation}
          onChange={(e) => setWithAnnotation(e.target.checked)}
        />
        With annotation
      </label>
      <label className="cell-counter-tool-picker-field cell-counter-tool-picker-checkbox">
        <input
          type="checkbox"
          checked={withRoi}
          onChange={(e) => setWithRoi(e.target.checked)}
        />
        With region of interest
      </label>
      {withRoi && (
        <label className="cell-counter-tool-picker-field">
          Box size
          <select value={boxSizeMicrons} onChange={(e) => setBoxSizeMicrons(Number(e.target.value))}>
            {RoiBoxSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}µm
              </option>
            ))}
          </select>
        </label>
      )}

      <button
        type="button"
        className="cell-counter-tool-picker-button cell-counter-tool-picker-button--primary"
        disabled={activeTool !== null}
        onClick={handleStart}
      >
        Start counting
      </button>

      {activeTool && (
        <p className="cell-counter-tool-picker-hint">
          Deselect the annotation tool to start counting.
        </p>
      )}
    </div>
  )
}

export default CellCounterToolPicker
