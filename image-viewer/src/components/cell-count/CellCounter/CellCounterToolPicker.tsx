import { useCellCountDrawContext } from '../../../context/CellCountDrawContext'
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
      {!withAnnotation && (
        <p className="cell-counter-tool-picker-hint">
          Clicks still tally, but no dot is drawn on the image.
        </p>
      )}

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
        onClick={handleStart}
      >
        Start counting
      </button>
    </div>
  )
}

export default CellCounterToolPicker
