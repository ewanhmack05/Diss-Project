import { useCellCountDrawContext } from '../../../context/CellCountDrawContext'
import { DotSizeOptions } from '../Tools'
import ColourPicker from '../../colour-picker/ColourPicker'
import DockedCard from '../../toolbar/DockedCard'
import { formatDistancePixels } from '../../ruler/ruler'
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
    withAnnotation,
    withRoi,
    roiConfirmed,
    dotHistory,
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
        {/* Its own class rather than reusing cell-counter-tool-picker-actions-card
            - that one is pinned to flex:0 1 16em to match Options' width in
            the main 4-card row (see the "same slot" rule further down),
            which is too narrow for "Confirm placement" here and isn't a
            constraint this single-card screen has any reason to share. */}
        <DockedCard className="cell-counter-tool-picker-roi-actions-card">
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
        </DockedCard>
      </div>
    )
  }

  return (
    <div className="cell-counter-tool-picker">
      <DockedCard className="cell-counter-tool-picker-field-card">
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
      </DockedCard>

      <DockedCard title="Colour" className="cell-counter-tool-picker-colour-card">
        <ColourPicker value={colour} onChange={setColour} />
      </DockedCard>

      <DockedCard title="Actions" className="cell-counter-tool-picker-actions-card">
        <div className="cell-counter-tool-picker-actions cell-counter-tool-picker-actions--stacked">
          <button type="button" className="cell-counter-tool-picker-button" onClick={requestUndo}>
            Undo
          </button>
          <button type="button" className="cell-counter-tool-picker-button" onClick={requestRedo}>
            Redo
          </button>
        </div>
      </DockedCard>

      {/* Same class as CellCounterToolPicker's spare card, on purpose - it
          keeps this view's card count at 4, matching idle, so flex:1 (see
          DockedCard.css) divides the row the same way in both. A count of
          3 here made every other card wider than in idle, which is what
          was actually behind "boxes changing size" between the two.

          Without withAnnotation there's no per-click record to show here
          (see MapNode's tally handler - a dot Feature, with its colour and
          position, is only ever created when withAnnotation is on), so
          it's just a big tally instead. With it on, dotHistory (kept live
          by MapNode alongside its own undo/redo stack) gives an actual
          click-by-click log. */}
      {withAnnotation ? (
        <DockedCard
          title="History"
          className="cell-counter-tool-picker-spare-card cell-counter-tool-picker-history-card"
        >
          {dotHistory.length === 0 ? (
            <p className="cell-counter-tool-picker-history-empty">No clicks yet</p>
          ) : (
            <ul className="cell-counter-tool-picker-history">
              {dotHistory
                .map((dot, index) => (
                  <li key={index} className="cell-counter-tool-picker-history-row">
                    <span
                      className="cell-counter-tool-picker-history-swatch"
                      style={{ background: dot.colour }}
                    />
                    <span className="cell-counter-tool-picker-history-coords">
                      {formatDistancePixels(dot.x)}, {formatDistancePixels(dot.y)}
                    </span>
                  </li>
                ))
                .reverse()}
            </ul>
          )}
        </DockedCard>
      ) : (
        <DockedCard title="Count" className="cell-counter-tool-picker-spare-card">
          <p className="cell-counter-tool-picker-tally-big">{count}</p>
        </DockedCard>
      )}

      <button
        type="button"
        className="cell-counter-tool-picker-button cell-counter-tool-picker-button--primary"
        onClick={handleStop}
      >
        Stop counting
      </button>

      {/* Unannotated already has its own dedicated Count card above (no
          history to compete with it for room) - this is just for the
          annotated case, in the row's own leftover space below the button
          rather than squeezed into the History card alongside the list. */}
      {withAnnotation && (
        <p className="cell-counter-tool-picker-count-line">
          Count <strong>{count}</strong>
        </p>
      )}
    </div>
  )
}

export default CellCounterDuring
