import { useState } from 'react'
import type { Collection } from '../../../context/CollectionContext'
import { useCollectionContext } from '../../../context/CollectionContext'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import { useCellCountStoreContext } from '../../../context/CellCountStoreContext'
import useSavedPage from '../../saved/useSavedPage'
import SavedPager from '../../saved/SavedPager'
import { SAVED_PAGE_SIZE, clampPage } from '../../saved/paging'
import { dayHeading, formatFullDate, formatTime } from '../../saved/savedDates'
import ChangeIcon from './ChangeIcon'
import HistoryDetail from './HistoryDetail'
import { byDay, changeKind, changeLabel, initials, wasPutBack, type ChangeSet } from './history'
import useRestoreChangeSet from './useRestoreChangeSet'
import './HistoryList.css'

// Every change made in the collection you're in, newest first, one line
// each under day headings. Clicking one opens it - who, when, what - and
// that's where anything it deleted can be put back. Editors only;
// everyone else just looks.
function HistoryList({ collection }: { collection: Collection }) {
  const { canEdit } = useCollectionContext()
  const { baseUrl, revision: annotationRevision } = useAnnotationStoreContext()
  const { revision: cellCountRevision } = useCellCountStoreContext()
  const restore = useRestoreChangeSet()
  const [page, setPage] = useState(0)
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
    revision,
  })

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
      {changeSets.length === 0 ? (
        <p className="collections-note">Nothing's changed in here yet.</p>
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
