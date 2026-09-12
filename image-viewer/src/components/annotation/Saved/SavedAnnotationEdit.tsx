import { useEffect, useRef, useState } from 'react'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import type { Annotation } from '../../../interfaces/Annotation'
import ColourPicker from '../../colour-picker/ColourPicker'
import '../FreeForm/AnnotationForm.css'

interface SavedAnnotationEditProps {
  annotation: Annotation
  onBack: () => void
}

// Mirrors SavedAnnotationEdit.tsx, but its archive-button/validateArchive flow
// (soft-delete: active=false + move to a private collection) is replaced with
// a real delete - no archiving in this project's scope.
function SavedAnnotationEdit({ annotation, onBack }: SavedAnnotationEditProps) {
  const { annotationsSource, updateAnnotation, deleteAnnotation } = useAnnotationStoreContext()
  const [label, setLabel] = useState(annotation.label)
  const [notes, setNotes] = useState(annotation.notes ?? '')
  const [colour, setColour] = useState(annotation.colour)
  const committedRef = useRef(false)

  // Colour swatches preview live against the actual map feature, same as
  // AddAnnotationForm does for a pending draw. Unlike a pending draw though,
  // this feature is the persisted one still rendered everywhere else, so if
  // the user leaves without saving - Back, Delete, switching tabs, closing
  // the panel, all of which unmount this component - the preview must be
  // reverted to what's actually saved. Save/Delete flag committedRef so
  // their own unmount doesn't undo the change (or the delete) they just made.
  useEffect(() => {
    return () => {
      if (!committedRef.current) {
        annotationsSource.getFeatureById(annotation.id)?.set('colour', annotation.colour)
      }
    }
  }, [annotation, annotationsSource])

  const handleColourChange = (next: string) => {
    setColour(next)
    annotationsSource.getFeatureById(annotation.id)?.set('colour', next)
  }

  const handleSave = () => {
    if (!label.trim()) return
    committedRef.current = true
    updateAnnotation(annotation.id, { label: label.trim(), notes: notes.trim(), colour })
    onBack()
  }

  const handleDelete = () => {
    committedRef.current = true
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

      <ColourPicker value={colour} onChange={handleColourChange} />

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
