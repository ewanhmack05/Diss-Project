import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import { ShapeTools } from '../Tools'
import SavedAnnotationEdit from './SavedAnnotationEdit'
import './SavedAnnotationList.css'

function SavedAnnotationList() {
  const { annotations, status, selectedAnnotationId, setSelectedAnnotationId } =
    useAnnotationStoreContext()

  const editing = annotations.find((a) => a.id === selectedAnnotationId)
  if (editing) {
    return (
      <SavedAnnotationEdit annotation={editing} onBack={() => setSelectedAnnotationId(null)} />
    )
  }

  if (status === 'loading') {
    return <p className="saved-annotation-list-empty">Loading...</p>
  }

  if (status === 'error') {
    return <p className="saved-annotation-list-empty">Couldn't reach the annotation store.</p>
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
            onClick={() => setSelectedAnnotationId(annotation.id)}
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
