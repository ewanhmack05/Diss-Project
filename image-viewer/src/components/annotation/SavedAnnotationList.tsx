import { useState } from 'react'
import { useAnnotationStoreContext } from '../../context/AnnotationStoreContext'
import { ShapeTools } from './Tools'
import SavedAnnotationEdit from './SavedAnnotationEdit'
import './SavedAnnotationList.css'

function SavedAnnotationList() {
  const { annotations } = useAnnotationStoreContext()
  const [editingId, setEditingId] = useState<string | null>(null)

  const editing = annotations.find((a) => a.id === editingId)
  if (editing) {
    return <SavedAnnotationEdit annotation={editing} onBack={() => setEditingId(null)} />
  }

  if (annotations.length === 0) {
    return <p className="saved-annotation-list-empty">Nothing saved yet.</p>
  }

  return (
    <ul className="saved-annotation-list">
      {annotations.map((annotation) => (
        <li key={annotation.id}>
          <button
            type="button"
            className="saved-annotation-list-item"
            onClick={() => setEditingId(annotation.id)}
          >
            <span
              className="saved-annotation-list-swatch"
              style={{ backgroundColor: annotation.colour }}
            />
            <span className="saved-annotation-list-label">{annotation.label}</span>
            <span className="saved-annotation-list-shape">
              {ShapeTools[annotation.shape].label}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export default SavedAnnotationList
