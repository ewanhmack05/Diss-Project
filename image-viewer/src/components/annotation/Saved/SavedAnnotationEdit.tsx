import { useState } from 'react'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import type { Annotation } from '../../../interfaces/Annotation'
import ColourPicker from '../FreeForm/ColourPicker'
import '../FreeForm/AnnotationForm.css'

interface SavedAnnotationEditProps {
  annotation: Annotation
  onBack: () => void
}

// Mirrors SavedAnnotationEdit.tsx, but its archive-button/validateArchive flow
// (soft-delete: active=false + move to a private collection) is replaced with
// a real delete - no archiving in this project's scope.
function SavedAnnotationEdit({ annotation, onBack }: SavedAnnotationEditProps) {
  const { updateAnnotation, deleteAnnotation } = useAnnotationStoreContext()
  const [label, setLabel] = useState(annotation.label)
  const [colour, setColour] = useState(annotation.colour)

  const handleSave = () => {
    if (!label.trim()) return
    updateAnnotation(annotation.id, { label: label.trim(), colour })
    onBack()
  }

  const handleDelete = () => {
    deleteAnnotation(annotation.id)
    onBack()
  }

  return (
    <div className="annotation-form">
      <label className="annotation-form-field">
        Label
        <input
          type="text"
          value={label}
          maxLength={64}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>

      <ColourPicker value={colour} onChange={setColour} />

      <div className="annotation-form-actions">
        <button type="button" className="annotation-form-button" onClick={onBack}>
          Back
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
      <div className="annotation-form-actions">
        <button
          type="button"
          className="annotation-form-button annotation-form-button--danger"
          data-cy="delete-button"
          onClick={handleDelete}
        >
          Delete
        </button>
      </div>
    </div>
  )
}

export default SavedAnnotationEdit
