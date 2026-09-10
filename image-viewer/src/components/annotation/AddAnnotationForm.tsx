import { useState } from 'react'
import { useDrawContext } from '../../context/DrawContext'
import { useAnnotationStoreContext } from '../../context/AnnotationStoreContext'
import { featureToGeoJson } from '../open-layers/GeoJSON'
import ColourPicker from './ColourPicker'
import './AnnotationForm.css'

function AddAnnotationForm() {
  const { pending, colour, lineThickness, lineStyle, setColour, setPending } = useDrawContext()
  const { addAnnotation } = useAnnotationStoreContext()
  const [label, setLabel] = useState('')

  if (!pending) return null

  const handleSave = () => {
    if (!label.trim()) return
    addAnnotation({
      id: crypto.randomUUID(),
      label: label.trim(),
      colour,
      shape: pending.shape,
      lineStyle,
      lineThickness,
      geoJson: featureToGeoJson(pending.feature),
      created: new Date().toISOString(),
    })
    setPending(null)
    setLabel('')
  }

  const handleRedraw = () => {
    setPending(null)
    setLabel('')
  }

  return (
    <div className="annotation-form">
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

      <ColourPicker value={colour} onChange={setColour} />

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
    </div>
  )
}

export default AddAnnotationForm
