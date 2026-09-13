import { useState } from 'react'
import { useDrawContext } from '../../../context/DrawContext'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import { featureToGeoJson } from '../../open-layers/GeoJSON'
import ColourPicker from '../../colour-picker/ColourPicker'
import DockedCard from '../../toolbar/DockedCard'
import './AnnotationForm.css'

function AddAnnotationForm() {
  const { pending, colour, lineThickness, lineStyle, setColour, setPending } = useDrawContext()
  const { addAnnotation } = useAnnotationStoreContext()
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')

  if (!pending) return null

  const handleSave = () => {
    if (!label.trim()) return
    addAnnotation({
      id: crypto.randomUUID(),
      label: label.trim(),
      notes: notes.trim(),
      colour,
      shape: pending.shape,
      lineStyle,
      lineThickness,
      geoJson: featureToGeoJson(pending.feature),
      created: new Date().toISOString(),
    })
    setPending(null)
    setLabel('')
    setNotes('')
  }

  const handleRedraw = () => {
    setPending(null)
    setLabel('')
    setNotes('')
  }

  // feature.set() fires OL's own change event, which the draw layer is
  // already listening for - re-styling the pending shape immediately, no
  // extra re-render plumbing needed.
  const handleColourChange = (next: string) => {
    setColour(next)
    pending.feature.set('colour', next)
  }

  return (
    <div className="annotation-form">
      <DockedCard className="annotation-form-field-card">
        <label className="annotation-form-field">
          Label
          <input
            type="text"
            value={label}
            maxLength={64}
            autoFocus
            placeholder="Name this annotation"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
      </DockedCard>

      <DockedCard className="annotation-form-field-card annotation-form-notes-card">
        <label className="annotation-form-field">
          Notes
          <textarea
            value={notes}
            maxLength={256}
            rows={3}
            placeholder="Add any thoughts on this annotation"
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </DockedCard>

      <DockedCard title="Colour" className="annotation-form-colour-card">
        <ColourPicker value={colour} onChange={handleColourChange} />
      </DockedCard>

      <DockedCard title="Actions" className="annotation-form-actions-card">
        <div className="annotation-form-actions">
          <button type="button" className="annotation-form-button" onClick={handleRedraw}>
            Redraw
          </button>
          <button
            type="button"
            className="annotation-form-button annotation-form-button--primary"
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

export default AddAnnotationForm
