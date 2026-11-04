import { useEffect, useState } from 'react'
import { useAuthContext } from '../../../context/AuthContext'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import { useCellCountStoreContext } from '../../../context/CellCountStoreContext'
import { useCollectionContext } from '../../../context/CollectionContext'
import Icon from '../../../icons/Icon'
import chevronLeftSvg from '../../../icons/chevron-left.svg?raw'
import SavedPager from '../../saved/SavedPager'
import { dayHeading, formatFullDate, formatTime, timeAgo } from '../../saved/savedDates'
import ChangeIcon from './ChangeIcon'
import ChangeLineItem from './ChangeLines'
import { byDay, initials } from './history'
import {
  asLines,
  canGoBack,
  goBackNote,
  isNow,
  previewPath,
  timelinePath,
  versionKind,
  versionTitle,
  type Item,
  type ItemPreview,
  type ItemTimeline,
  type ItemVersion,
} from './itemVersions'
import useGoBackItem from './useGoBackItem'
import '../CollectionsPanel.css'
import './HistoryList.css'

const PAGE_SIZE = 20

type Loaded<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; result: T }

function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="history-back" onClick={onClick}>
      <Icon svg={chevronLeftSvg} size={12} />
      {label}
    </button>
  )
}

// One version picked - what going back to it would do, and the button. This
// is the confirm, the same as a change opened in the History tab.
function GoBackPage({
  item,
  version,
  onCancel,
  onWentBack,
}: {
  item: Item
  version: ItemVersion
  onCancel: () => void
  // Told it's gone back, or that someone's changed it since so it couldn't.
  onWentBack: (result: { status: 'done'; name: string | null } | { status: 'changed' }) => void
}) {
  const { authFetch } = useAuthContext()
  const { baseUrl } = useAnnotationStoreContext()
  const goBack = useGoBackItem()
  const [loaded, setLoaded] = useState<Loaded<ItemPreview>>({ status: 'loading' })
  const [going, setGoing] = useState(false)
  const { entity, id } = item

  useEffect(() => {
    let cancelled = false
    authFetch(`${baseUrl}${previewPath({ entity, id }, version.id)}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<ItemPreview>
      })
      .then((result) => {
        if (!cancelled) setLoaded({ status: 'ready', result })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [authFetch, baseUrl, entity, id, version.id])

  const preview = loaded.status === 'ready' ? loaded.result : null
  const lines = preview ? asLines(preview.changes, preview.groups) : []

  return (
    <section className="history-detail">
      <BackButton label="Timeline" onClick={onCancel} />
      <h3 className="history-detail-title">{preview?.gone ? 'Bring it back as it was' : 'Go back to how it was'}</h3>
      <dl className="history-facts">
        <dt>From</dt>
        <dd>
          {formatFullDate(version.created)}
          <span className="history-fact-sub">
            {timeAgo(version.created)}, {version.userName || 'someone'}
          </span>
        </dd>
      </dl>
      {loaded.status === 'loading' && <p className="collections-note">Working out what would change…</p>}
      {loaded.status === 'error' && <p className="collections-note">History doesn't say how it was then, so it can't go back to this.</p>}
      {preview && lines.length === 0 && !preview.gone && <p className="collections-note">It's already how it was then.</p>}
      {preview && (lines.length > 0 || preview.gone) && (
        <>
          <section className="history-changes">
            <h4 className="history-changes-heading">{preview.gone ? 'It comes back as' : 'What would change'}</h4>
            <ul className="history-change-list">
              {lines.map((line, i) => (
                <ChangeLineItem key={i} line={line} toOnly={preview.gone} />
              ))}
            </ul>
          </section>
          <p className="collections-note">{goBackNote(item.entity, preview)}</p>
          <div className="collections-button-row">
            <button
              type="button"
              className="collections-button collections-button--accent"
              disabled={going}
              onClick={() => {
                setGoing(true)
                goBack(item, version.id, preview.latest)
                  .then((result) => {
                    if (result.status !== 'failed') onWentBack(result)
                  })
                  .finally(() => setGoing(false))
              }}
            >
              {going ? 'Putting back…' : preview.gone ? 'Bring it back' : 'Go back to this'}
            </button>
            <button type="button" className="collections-button" disabled={going} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  )
}

interface ItemHistoryProps {
  item: Item
  // What Back goes back to - "Saved", "Change".
  backLabel: string
  onBack: () => void
  // Told once it's gone back, so a list behind it can load again.
  onWentBack?: () => void
}

// Everything that's happened to one annotation or cell count, newest first,
// each change from and to. Editors can go back to any point on it - which
// undoes everything since, whoever did it. Anyone in the collection can look.
function ItemHistory({ item, backLabel, onBack, onWentBack }: ItemHistoryProps) {
  const { authFetch } = useAuthContext()
  const { canEdit, collectionId } = useCollectionContext()
  const { baseUrl, revision: annotationRevision } = useAnnotationStoreContext()
  const { revision: cellCountRevision } = useCellCountStoreContext()
  const [page, setPage] = useState(0)
  const [wentBack, setWentBack] = useState(0)
  const [loaded, setLoaded] = useState<Loaded<ItemTimeline>>({ status: 'loading' })
  const [going, setGoing] = useState<ItemVersion | null>(null)
  // Going back can change what it's called.
  const [name, setName] = useState(item.name)
  // Both only go up. A save or delete settling may be a new version.
  const revision = annotationRevision + cellCountRevision + wentBack
  const { entity, id } = item

  useEffect(() => {
    if (collectionId === null) return
    let cancelled = false
    authFetch(`${baseUrl}${timelinePath({ entity, id }, collectionId, page * PAGE_SIZE, PAGE_SIZE)}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<ItemTimeline>
      })
      .then((result) => {
        if (!cancelled) setLoaded({ status: 'ready', result })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [authFetch, baseUrl, collectionId, entity, id, page, revision])

  if (going) {
    return (
      <GoBackPage
        item={{ ...item, name }}
        version={going}
        onCancel={() => setGoing(null)}
        onWentBack={(result) => {
          setGoing(null)
          // Loaded again either way - what's showing is out of date.
          setPage(0)
          setWentBack((n) => n + 1)
          if (result.status === 'done') {
            setName(result.name)
            onWentBack?.()
          }
        }}
      />
    )
  }

  const now = new Date()
  const timeline = loaded.status === 'ready' ? loaded.result : null

  return (
    <section className="history-detail">
      <BackButton label={backLabel} onClick={onBack} />
      <h3 className="history-detail-title history-item-title">History of {name || 'this one'}</h3>
      {loaded.status === 'loading' && <p className="collections-note">Loading…</p>}
      {loaded.status === 'error' && <p className="collections-note">Couldn't load its history.</p>}
      {timeline && timeline.versions.length === 0 && (
        <p className="collections-note">Nothing's recorded for this one - it hasn't changed since changes started being kept.</p>
      )}
      {timeline && (
        <div className="history-days">
          {byDay(timeline.versions, (iso) => dayHeading(iso, now)).map((day) => (
            <div key={day.heading} className="history-day">
              <h4 className="history-day-heading">{day.heading}</h4>
              <ul className="history-versions">
                {day.items.map((version) => {
                  const lines = asLines(version.changes, timeline.groups)
                  return (
                    <li key={version.id} className="history-version">
                      <div className="history-version-head" title={`${version.userName || 'Someone'}, ${formatFullDate(version.created)}`}>
                        <ChangeIcon kind={versionKind(version)} className="history-icon" />
                        <span className="history-row-label">{versionTitle(version)}</span>
                        {isNow(version, timeline.latest) && <span className="history-version-now">Now</span>}
                        <span className="history-avatar" aria-label={version.userName || 'Someone'}>
                          {initials(version.userName)}
                        </span>
                        <span className="history-row-time">{formatTime(version.created)}</span>
                      </div>
                      {lines.length > 0 && (
                        <ul className="history-change-list history-version-changes">
                          {lines.map((line, i) => (
                            <ChangeLineItem key={i} line={line} />
                          ))}
                        </ul>
                      )}
                      {canGoBack(version, timeline.latest, canEdit) && (
                        <button type="button" className="history-version-back" onClick={() => setGoing(version)}>
                          {version.op === 'delete' ? 'Back to how it was when deleted' : 'Go back to this'}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {timeline && <SavedPager page={page} total={timeline.total} pageSize={PAGE_SIZE} loading={false} onPage={setPage} />}
    </section>
  )
}

export default ItemHistory
