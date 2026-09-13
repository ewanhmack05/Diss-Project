import { useState } from 'react'
import { useCellCountStoreContext } from '../../../context/CellCountStoreContext'
import type { CellCount } from '../../../interfaces/CellCount'
import { parseCellCountDots, colourBreakdownFromDots } from '../CellCountDots'
import CellCountColourSwatch from '../CellCountColourSwatch'
import DockedCard from '../../toolbar/DockedCard'
import '../CellCounter/CellCountForm.css'

interface SavedCountEditProps {
  cellCount: CellCount
  onBack: () => void
}

// Simpler than SavedAnnotationEdit - a cell count has no geometry, so
// there's no OL feature anywhere to keep a live colour preview in sync
// with (or revert on an unsaved exit); this just edits local form state
// and writes it on Save. Only label/notes are actually editable - colour
// breakdown, withAnnotation/withRoi, and count/dot size are all facts
// about how the session was counted, same "not something to retype after
// the fact" call already made for count/dot size on the initial save
// screen. They still ride along in the PUT body unchanged (the endpoint
// overwrites whatever it's given), just not as editable fields.
function SavedCountEdit({ cellCount, onBack }: SavedCountEditProps) {
  const { updateCellCount, deleteCellCount } = useCellCountStoreContext()
  const [label, setLabel] = useState(cellCount.label)
  const [notes, setNotes] = useState(cellCount.notes)

  const colourBreakdown = colourBreakdownFromDots(parseCellCountDots(cellCount.dots))

  const handleSave = () => {
    if (!label.trim()) return
    updateCellCount(cellCount.id, {
      label: label.trim(),
      notes: notes.trim(),
      withAnnotation: cellCount.withAnnotation,
      withRoi: cellCount.withRoi,
      count: cellCount.count,
      dotSize: cellCount.dotSize,
    })
    onBack()
  }

  const handleDelete = () => {
    deleteCellCount(cellCount.id)
    onBack()
  }

  return (
    <div className="cell-count-form">
      <DockedCard className="cell-count-form-field-card">
        <label className="cell-count-form-field">
          Label
          <input
            type="text"
            value={label}
            maxLength={64}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
      </DockedCard>

      <DockedCard className="cell-count-form-field-card cell-count-form-notes-card">
        <label className="cell-count-form-field">
          Notes
          <textarea
            value={notes}
            maxLength={256}
            rows={3}
            placeholder="Add any thoughts on this count"
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </DockedCard>

      {/* Everything below is a fact about how the session was counted, not
          something this screen lets you retype (see the comment above) -
          grouped into one Details card rather than one each, the same
          "same slot" reasoning used throughout the docked toolbars: with
          nothing else in this view sharing a row with a different card
          count, there's no resize risk in bundling them together, and it
          keeps this card list from growing much past AddCellCountForm's. */}
      <DockedCard title="Details" className="cell-count-form-details-card cell-count-form-summary-card">
        <div className="cell-count-form-field">
          Colour
          <div className="cell-count-form-static cell-count-form-colour-breakdown">
            <CellCountColourSwatch breakdown={colourBreakdown} className="cell-count-form-colour-swatch" />
            {colourBreakdown.length > 0 ? (
              colourBreakdown.map(({ colour, count: colourCount }) => (
                <span key={colour} className="cell-count-form-colour-chip">
                  <span className="cell-count-form-colour-chip-swatch" style={{ backgroundColor: colour }} />
                  {colourCount}
                </span>
              ))
            ) : (
              <span>No colour recorded</span>
            )}
          </div>
        </div>

        <div className="cell-count-form-row">
          <div className="cell-count-form-field">
            With annotation
            <p className="cell-count-form-static">{cellCount.withAnnotation ? 'Yes' : 'No'}</p>
          </div>

          <div className="cell-count-form-field">
            With region of interest
            <p className="cell-count-form-static">{cellCount.withRoi ? 'Yes' : 'No'}</p>
          </div>
        </div>

        <div className="cell-count-form-row">
          <div className="cell-count-form-field">
            Count
            <p className="cell-count-form-static">{cellCount.count}</p>
          </div>

          <div className="cell-count-form-field">
            Dot size
            <p className="cell-count-form-static">{cellCount.dotSize}px</p>
          </div>
        </div>
      </DockedCard>

      <DockedCard title="Actions" className="cell-count-form-actions-card">
        <div className="cell-count-form-actions cell-count-form-actions--stacked">
          <button
            type="button"
            className="cell-count-form-button cell-count-form-button--primary"
            disabled={!label.trim()}
            onClick={handleSave}
          >
            Save
          </button>
          <button
            type="button"
            className="cell-count-form-button cell-count-form-button--danger"
            data-cy="delete-button"
            onClick={handleDelete}
          >
            Delete
          </button>
          <button type="button" className="cell-count-form-button" onClick={onBack}>
            Back
          </button>
        </div>
      </DockedCard>
    </div>
  )
}

export default SavedCountEdit
