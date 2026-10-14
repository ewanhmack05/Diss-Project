import { useState } from 'react'
import type { Annotation } from '../../../interfaces/Annotation'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import { ShapeOrder, ShapeTools } from '../Tools'
import { LinePreview, ShapeGlyph } from '../ShapeGlyph'
import SavedAnnotationEdit from './SavedAnnotationEdit'
import SavedRow, { SavedDetails } from '../../saved/SavedRow'
import { formatLongDate, formatShortDate } from '../../saved/savedDates'
import { SAVED_PAGE_SIZE, clampPage, isFiltered, mergePage } from '../../saved/paging'
import { NO_FILTERS, type SavedFilters } from '../../saved/filters'
import useSavedPage from '../../saved/useSavedPage'
import SavedPager from '../../saved/SavedPager'
import SavedFilterMenu from '../../saved/SavedFilterMenu'
import { useSavedFacets } from '../../saved/useSavedFacets'
import { savedBy } from '../../saved/savedBy'
import { useAuthContext } from '../../../context/AuthContext'
import { useCollectionContext } from '../../../context/CollectionContext'
import './SavedAnnotationList.css'

const SHAPE_CHOICES = ShapeOrder.map((shape) => ({
  value: shape,
  label: ShapeTools[shape].label,
  glyph: <ShapeGlyph shape={shape} />,
}))

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
  // Same as the search - kept through an edit, and back to the first page
  // when changed.
  const [filters, setFilters] = useState<SavedFilters>(NO_FILTERS)
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
    filters,
    revision,
  })
  const facets = useSavedFacets(baseUrl, 'annotations', collectionId, revision)

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
    filters,
    pageSize: SAVED_PAGE_SIZE,
  })
  // A delete can leave this page past the end - step back to the last one.
  const shownPage = clampPage(page, total, SAVED_PAGE_SIZE)
  if (shownPage !== page) setPage(shownPage)

  if (total === 0 && !isFiltered(search, filters)) {
    return <p className="saved-annotation-list-empty">Nothing saved yet.</p>
  }

  return (
    <>
      <div className="saved-search-row">
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
        <SavedFilterMenu
          filters={filters}
          onChange={(next) => {
            setFilters(next)
            setPage(0)
          }}
          facets={facets}
          myId={user.id}
          shapes={SHAPE_CHOICES}
          colours
        />
      </div>
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
