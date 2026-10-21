import { useState } from 'react'
import type { Collection } from '../../../context/CollectionContext'
import { useCollectionContext } from '../../../context/CollectionContext'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import { useCellCountStoreContext } from '../../../context/CellCountStoreContext'
import useSavedPage from '../../saved/useSavedPage'
import SavedFilterMenu from '../../saved/SavedFilterMenu'
import { useSavedFacets } from '../../saved/useSavedFacets'
import { NO_FILTERS, activeFilterCount, type SavedFilters } from '../../saved/filters'
import { useAuthContext } from '../../../context/AuthContext'
import SavedPager from '../../saved/SavedPager'
import { SAVED_PAGE_SIZE, clampPage } from '../../saved/paging'
import { dayHeading, formatFullDate, formatTime } from '../../saved/savedDates'
import ChangeIcon from './ChangeIcon'
import HistoryDetail from './HistoryDetail'
import { KIND_LABELS, byDay, changeKind, changeLabel, initials, wasPutBack, type ChangeKind, type ChangeSet } from './history'
import useRestoreChangeSet from './useRestoreChangeSet'
import './HistoryList.css'

// Every change made in the collection you're in, newest first, one line
// each under day headings. Clicking one opens it - who, when, what - and
// that's where anything it deleted can be put back. Editors only;
// everyone else just looks. Can be narrowed to who made it, what kind of
// change and when, with the Saved lists' filter popout, and turned round to
// go oldest first.
function HistoryList({ collection }: { collection: Collection }) {
  const { canEdit } = useCollectionContext()
  const { baseUrl, revision: annotationRevision } = useAnnotationStoreContext()
  const { revision: cellCountRevision } = useCellCountStoreContext()
  const restore = useRestoreChangeSet()
  const { user } = useAuthContext()
  const [page, setPage] = useState(0)
  // Kept through opening a change and coming back.
  const [filters, setFilters] = useState<SavedFilters>(NO_FILTERS)
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest')
  // A copy of the one opened, so it stays put while the list refetches.
  const [opened, setOpened] = useState<ChangeSet | null>(null)
  const [restoring, setRestoring] = useState(false)
  // Whether the one opened has been put back since.
  const [putBack, setPutBack] = useState(false)
  // A restore is a change of its own, so the list loads again after one.
  const [restores, setRestores] = useState(0)
  // Both only go up, so the sum does too - any save or delete settling
  // means a new change to list.
  const revision = annotationRevision + cellCountRevision + restores
  const savedPage = useSavedPage<ChangeSet>({
    baseUrl,
    path: 'changesets',
    collectionId: collection.collectionId,
    page,
    pageSize: SAVED_PAGE_SIZE,
    search: '',
    filters,
    order,
    revision,
  })
  const facets = useSavedFacets(baseUrl, 'changesets', collection.collectionId, revision)
  const kinds = (facets?.kinds ?? []).map((k) => ({
    kind: k.kind,
    label: KIND_LABELS[k.kind as ChangeKind] ?? k.kind,
    glyph: <ChangeIcon kind={k.kind as ChangeKind} className="history-icon" />,
    count: k.count,
  }))
  const filtered = activeFilterCount(filters) > 0

  if (opened) {
    const putBackOpened = () => {
      setRestoring(true)
      restore(opened)
        // Stays open, now saying it's back.
        .then(() => setPutBack(true))
        .catch(() => {})
        .finally(() => {
          setRestoring(false)
          setRestores((n) => n + 1)
        })
    }
    return (
      <HistoryDetail
        changeSet={opened}
        canEdit={canEdit}
        restoring={restoring}
        putBack={putBack}
        onRestore={putBackOpened}
        onBack={() => setOpened(null)}
      />
    )
  }

  if (savedPage.status === 'loading') return <p className="collections-note">Loading…</p>
  if (savedPage.status === 'error') return <p className="collections-note">Couldn't load the history.</p>

  const { fetched: changeSets, total } = savedPage
  const shownPage = clampPage(page, total, SAVED_PAGE_SIZE)
  if (shownPage !== page) setPage(shownPage)
  const now = new Date()

  return (
    <section className="collections-section">
      <h3 className="collections-heading">History of {collection.collectionName} ({total.toLocaleString('en-GB')})</h3>
      <div className="history-tools">
        <SavedFilterMenu
          filters={filters}
          onChange={(next) => {
            setFilters(next)
            setPage(0)
          }}
          facets={facets}
          myId={user.id}
          kinds={kinds}
          peopleTitle="Made by"
          whenTitle="When"
          notes={false}
        />
        <button
          type="button"
          className="saved-filter-toggle"
          aria-label={order === 'newest' ? 'Newest first - show oldest first' : 'Oldest first - show newest first'}
          onClick={() => {
            setOrder(order === 'newest' ? 'oldest' : 'newest')
            setPage(0)
          }}
        >
          {order === 'newest' ? 'Newest first' : 'Oldest first'}
        </button>
      </div>
      {changeSets.length === 0 ? (
        <p className="collections-note">{filtered ? 'No changes match these filters.' : "Nothing's changed in here yet."}</p>
      ) : (
        <div className="history-days">
          {byDay(changeSets, (iso) => dayHeading(iso, now)).map((day) => (
            <div key={day.heading} className="history-day">
              <h4 className="history-day-heading">{day.heading}</h4>
              <ul className="history-rows">
                {day.items.map((changeSet) => {
                  const kind = changeKind(changeSet.what)
                  const stillDeleted = kind === 'delete' && !wasPutBack(changeSet)
                  return (
                    <li key={changeSet.id}>
                      <button
                        type="button"
                        className="history-row"
                        title={`${changeSet.userName || 'Someone'}, ${formatFullDate(changeSet.created)}`}
                        onClick={() => {
                          setOpened(changeSet)
                          setPutBack(false)
                        }}
                      >
                        <ChangeIcon kind={kind} className={`history-icon${stillDeleted ? ' history-icon--deleted' : ''}`} />
                        <span className="history-row-label">{changeLabel(changeSet)}</span>
                        <span className="history-avatar" aria-label={changeSet.userName || 'Someone'}>
                          {initials(changeSet.userName)}
                        </span>
                        <span className="history-row-time">{formatTime(changeSet.created)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      <SavedPager page={shownPage} total={total} pageSize={SAVED_PAGE_SIZE} loading={savedPage.loadingMore} onPage={setPage} />
    </section>
  )
}

export default HistoryList
