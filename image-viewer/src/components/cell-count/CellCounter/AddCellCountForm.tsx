import { useState } from 'react'
import { useCellCountStoreContext } from '../../../context/CellCountStoreContext'
import { useCellCountDrawContext } from '../../../context/CellCountDrawContext'
import DockedCard from '../../toolbar/DockedCard'
import './CellCountForm.css'

// Mirrors AddAnnotationForm: only rendered once a counting session has been
// stopped (pending non-null). Unlike AddAnnotationForm, colour/count/dot
// size aren't editable here - they were decided live during counting (see
// CellCounterToolPicker and MapNode), so this just labels and saves the
// result rather than letting them be second-guessed after the fact.
function AddCellCountForm() {
  const { addCellCount } = useCellCountStoreContext()
  const { pending, setPending, resetCount } = useCellCountDrawContext()
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')

  if (!pending) return null

  const handleSave = () => {
    if (!label.trim()) return
    addCellCount({
      id: crypto.randomUUID(),
      label: label.trim(),
      notes: notes.trim(),
      dots: JSON.stringify(pending.dots),
      withAnnotation: pending.withAnnotation,
      withRoi: pending.withRoi,
      count: pending.count,
      dotSize: pending.dotSize,
      locationX: pending.location?.x ?? null,
      locationY: pending.location?.y ?? null,
      regionOfInterest: pending.roiGeoJson
        ? { id: crypto.randomUUID(), geoJson: pending.roiGeoJson, created: new Date().toISOString() }
        : null,
      created: new Date().toISOString(),
    })
    setPending(null)
    resetCount()
  }

  const handleRecount = () => {
    setPending(null)
    resetCount()
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
            autoFocus
            placeholder="Name this count"
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

      <DockedCard title="Details" className="cell-count-form-details-card">
        <div className="cell-count-form-row">
          <div className="cell-count-form-field">
            Count
            <p className="cell-count-form-static">{pending.count}</p>
          </div>

          <div className="cell-count-form-field">
            Dot size
            <p className="cell-count-form-static">{pending.dotSize}px</p>
          </div>
        </div>
      </DockedCard>

      <DockedCard title="Actions" className="cell-count-form-actions-card">
        <div className="cell-count-form-actions">
          <button type="button" className="cell-count-form-button" onClick={handleRecount}>
            Recount
          </button>
          <button
            type="button"
            className="cell-count-form-button cell-count-form-button--primary"
            disabled={!label.trim()}
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </DockedCard>
    </div>
  )
}

export default AddCellCountForm
