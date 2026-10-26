import { formatFullDate, timeAgo } from '../../saved/savedDates'
import ChangeIcon from './ChangeIcon'
import ChangeList from './ChangeList'
import { canRestore, changeKind, changeLabel, initials, restoreNote, restoreStatus, shortId, wasPutBack, type ChangeSet } from './history'
import Icon from '../../../icons/Icon'
import chevronLeftSvg from '../../../icons/chevron-left.svg?raw'

interface HistoryDetailProps {
  changeSet: ChangeSet
  canEdit: boolean
  restoring: boolean
  // Put back since it was opened - the title keeps what it said then.
  putBack: boolean
  onRestore: () => void
  onBack: () => void
}

// One change opened up - who, exactly when, what it changed from and to,
// and what's still deleted. This is the confirm too: Put back here does it
// straight away.
function HistoryDetail({ changeSet, canEdit, restoring, putBack, onRestore, onBack }: HistoryDetailProps) {
  const current = putBack ? { ...changeSet, deleted: 0 } : changeSet
  const kind = changeKind(changeSet.what)
  const status = restoreStatus(current)
  const restorable = canRestore(current, canEdit)
  const stillDeleted = kind === 'delete' && !wasPutBack(current)

  return (
    <section className="history-detail">
      <button type="button" className="history-back" onClick={onBack}>
        <Icon svg={chevronLeftSvg} size={12} />
        History
      </button>

      <h3 className="history-detail-title">
        <ChangeIcon kind={kind} className={`history-icon${stillDeleted ? ' history-icon--deleted' : ''}`} />
        {changeLabel(changeSet)}
      </h3>

      <dl className="history-facts">
        <dt>Who</dt>
        <dd className="history-who">
          <span className="history-avatar">{initials(changeSet.userName)}</span>
          {changeSet.userName || 'Someone'}
        </dd>
        <dt>When</dt>
        <dd>
          {formatFullDate(changeSet.created)}
          <span className="history-fact-sub">{timeAgo(changeSet.created)}</span>
        </dd>
        {status && (
          <>
            <dt>Deleted</dt>
            <dd>{status}</dd>
          </>
        )}
        <dt>Change</dt>
        <dd className="history-id" title={changeSet.id}>
          {shortId(changeSet.id)}
        </dd>
      </dl>

      <ChangeList changeSetId={changeSet.id} />

      {restorable ? (
        <>
          <p className="collections-note">{restoreNote(changeSet)}</p>
          <div className="collections-button-row">
            <button type="button" className="collections-button collections-button--accent" disabled={restoring} onClick={onRestore}>
              {restoring ? 'Putting back…' : 'Put back'}
            </button>
            <button type="button" className="collections-button" disabled={restoring} onClick={onBack}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        current.deleted > 0 &&
        !canEdit && <p className="collections-note">Only editors can put things back.</p>
      )}
    </section>
  )
}

export default HistoryDetail
