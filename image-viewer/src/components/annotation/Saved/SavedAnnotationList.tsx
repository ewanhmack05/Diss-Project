import { useState } from 'react'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import { ShapeTools } from '../Tools'
import { LinePreview, ShapeGlyph } from '../ShapeGlyph'
import SavedAnnotationEdit from './SavedAnnotationEdit'
import SavedRow, { SavedDetails } from '../../saved/SavedRow'
import { formatLongDate, formatShortDate, newestFirst } from '../../saved/savedDates'
import { savedBy } from '../../saved/savedBy'
import { useAuthContext } from '../../../context/AuthContext'
import { useCollectionContext } from '../../../context/CollectionContext'
import './SavedAnnotationList.css'

function SavedAnnotationList() {
  const { annotations, status, selectedAnnotationId, setSelectedAnnotationId } =
    useAnnotationStoreContext()
  const { canEdit } = useCollectionContext()
  const { user } = useAuthContext()
  // Kept here rather than reset on edit, so Back returns to the same results.
  const [search, setSearch] = useState('')
  // One open at a time. Kept through an edit too, so Back lands on it.
  const [openId, setOpenId] = useState<string | null>(null)

  const editing = annotations.find((a) => a.id === selectedAnnotationId)
  if (editing && canEdit) {
    return (
      <SavedAnnotationEdit
        key={editing.id}
        annotation={editing}
        onBack={() => setSelectedAnnotationId(null)}
      />
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

  const query = search.trim().toLowerCase()
  const filtered = newestFirst(
    query
      ? annotations.filter(
        (a) =>
          a.label.toLowerCase().includes(query) ||
          a.notes.toLowerCase().includes(query) ||
          ShapeTools[a.shape].label.toLowerCase().includes(query),
      )
      : annotations,
  )

  return (
    <>
      <input
        type="search"
        className="saved-annotation-list-search"
        value={search}
        placeholder="Search saved annotations"
        onChange={(e) => setSearch(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p className="saved-annotation-list-empty">No matches.</p>
      ) : (
        <ul className="saved-annotation-list themed-scroll">
          {filtered.map((annotation) => {
            const shape = ShapeTools[annotation.shape].label
            const line = `${annotation.lineThickness}px ${annotation.lineStyle}`
            const by = savedBy(annotation, user.id)
            return (
              <SavedRow
                key={annotation.id}
                open={openId === annotation.id}
                onToggle={() => setOpenId((current) => (current === annotation.id ? null : annotation.id))}
                leading={<ShapeGlyph shape={annotation.shape} colour={annotation.colour} />}
                label={annotation.label}
                trailing={<span className="saved-annotation-list-shape">{shape}</span>}
                meta={
                  <>
                    <span className="saved-row-tag">
                      <LinePreview
                        colour={annotation.colour}
                        thickness={annotation.lineThickness}
                        lineStyle={annotation.lineStyle}
                      />
                      {line}
                    </span>
                    <span className="saved-row-spacer" />
                    {by && <span className="saved-row-by">{by}</span>}
                    <span>{formatShortDate(annotation.created)}</span>
                  </>
                }
                notes={annotation.notes}
              >
                <SavedDetails
                  items={[
                    ['Shape', shape],
                    ['Line', line],
                    ...(annotation.notes ? [['Notes', annotation.notes] as [string, string]] : []),
                    ...(by ? [['Saved by', by] as [string, string]] : []),
                    ['Saved', formatLongDate(annotation.created)],
                  ]}
                  actions={
                    <button
                      type="button"
                      className="saved-row-button saved-row-button--primary"
                      onClick={() => setSelectedAnnotationId(annotation.id)}
                      disabled={!canEdit}
                    >
                      Edit
                    </button>
                  }
                />
              </SavedRow>
            )
          })}
        </ul>
      )}
    </>
  )
}

export default SavedAnnotationList
