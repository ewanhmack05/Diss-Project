import { useState } from 'react'
import type { Annotation } from '../../../interfaces/Annotation'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import { ShapeTools } from '../Tools'
import { LinePreview, ShapeGlyph } from '../ShapeGlyph'
import SavedAnnotationEdit from './SavedAnnotationEdit'
import SavedRow, { SavedDetails } from '../../saved/SavedRow'
import { formatLongDate, formatShortDate } from '../../saved/savedDates'
import { SAVED_PAGE_SIZE, clampPage, mergePage } from '../../saved/paging'
import useSavedPage from '../../saved/useSavedPage'
import SavedPager from '../../saved/SavedPager'
import { savedBy } from '../../saved/savedBy'
import { useAuthContext } from '../../../context/AuthContext'
import { useCollectionContext } from '../../../context/CollectionContext'
import './SavedAnnotationList.css'

function SavedAnnotationList() {
  const {
    annotations,
    status,
    revision,
    wasDeleted,
    baseUrl,
    selectedAnnotationId,
    setSelectedAnnotationId,
    viewedAnnotationId,
    setViewedAnnotationId,
  } = useAnnotationStoreContext()
  const { canEdit, collectionId } = useCollectionContext()
  const { user } = useAuthContext()
  // Kept here rather than reset on edit, so Back returns to the same results.
  const [search, setSearch] = useState('')
  // One open at a time. Kept through an edit too, so Back lands on it.
  const [openId, setOpenId] = useState<string | null>(null)
  // Kept through an edit too, and reset to the first page by a new search.
  const [page, setPage] = useState(0)
  // A page at a time from annotation-store, searched there too. The map
  // still has every annotation (the store's `annotations`); this list only
  // shows SAVED_PAGE_SIZE of them.
  const savedPage = useSavedPage<Annotation>({
    baseUrl,
    path: 'annotations',
    collectionId,
    page,
    pageSize: SAVED_PAGE_SIZE,
    search,
    revision,
  })

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

  if (status === 'loading' || savedPage.status === 'loading') {
    return <p className="saved-annotation-list-empty">Loading...</p>
  }

  if (status === 'error' || savedPage.status === 'error') {
    return <p className="saved-annotation-list-empty">Couldn't reach the annotation store.</p>
  }

  const { items, total } = mergePage({
    fetched: savedPage.fetched,
    total: savedPage.total,
    live: annotations,
    isDeleted: wasDeleted,
    page,
    search,
    pageSize: SAVED_PAGE_SIZE,
  })
  // A delete can leave this page past the end - step back to the last one.
  const shownPage = clampPage(page, total, SAVED_PAGE_SIZE)
  if (shownPage !== page) setPage(shownPage)

  if (total === 0 && !search.trim()) {
    return <p className="saved-annotation-list-empty">Nothing saved yet.</p>
  }

  return (
    <>
      <input
        type="search"
        className="saved-annotation-list-search"
        value={search}
        placeholder="Search saved annotations"
        onChange={(e) => {
          setSearch(e.target.value)
          setPage(0)
        }}
      />
      {items.length === 0 ? (
        <p className="saved-annotation-list-empty">{savedPage.loadingMore ? 'Searching...' : 'No matches.'}</p>
      ) : (
        <ul className="saved-annotation-list themed-scroll">
          {items.map((annotation) => {
            const shape = ShapeTools[annotation.shape].label
            const line = `${annotation.lineThickness}px ${annotation.lineStyle}`
            const by = savedBy(annotation, user.id)
            const isViewing = viewedAnnotationId === annotation.id
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
                    {isViewing && <span className="saved-row-tag saved-row-tag--active">On map</span>}
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
                    <>
                      {/* Open to viewers too - looking isn't editing. */}
                      <button
                        type="button"
                        className="saved-row-button"
                        onClick={() => setViewedAnnotationId(isViewing ? null : annotation.id)}
                      >
                        {isViewing ? 'Stop viewing' : 'View on map'}
                      </button>
                      <button
                        type="button"
                        className="saved-row-button saved-row-button--primary"
                        onClick={() => setSelectedAnnotationId(annotation.id)}
                        disabled={!canEdit}
                      >
                        Edit
                      </button>
                    </>
                  }
                />
              </SavedRow>
            )
          })}
        </ul>
      )}
      <SavedPager
        page={page}
        total={total}
        pageSize={SAVED_PAGE_SIZE}
        loading={savedPage.loadingMore}
        onPage={setPage}
      />
    </>
  )
}

export default SavedAnnotationList
