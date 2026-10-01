import { useEffect, useRef, useState } from 'react'
import { useCollectionContext, type CollectionRole, type Invite } from '../../context/CollectionContext'
import { useEmitEvent } from '../../context/EventContext'
import { formatLongDate } from '../saved/savedDates'

const HOURS = [
  { hours: 1, label: 'in 1 hour' },
  { hours: 24, label: 'in 24 hours' },
  { hours: 24 * 7, label: 'in 7 days' },
]

const CAN_TEXT: Record<CollectionRole, string> = {
  editor: 'People who join can edit',
  viewer: 'People who join can only view',
  owner: '',
}

function linkFor(code: string): string {
  return `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(code)}`
}

// The host's invite link - one working link at a time. Making a new one
// stops the old one, so changing who it's for is just making another.
function SessionInvite() {
  const { session, loadInvites, createInvite, stopInvite } = useCollectionContext()
  const emit = useEmitEvent()
  const [invite, setInvite] = useState<Invite | null>(null)
  const [role, setRole] = useState<CollectionRole>('editor')
  const [hours, setHours] = useState(24)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const sessionId = session?.collectionId

  useEffect(() => {
    let cancelled = false
    setInvite(null)
    if (!sessionId) return
    loadInvites()
      .then((invites) => {
        if (!cancelled) setInvite(invites[0] ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionId, loadInvites])

  const make = () => {
    setBusy(true)
    createInvite(role, hours)
      .then(setInvite)
      .catch(() => emit('session:error'))
      .finally(() => setBusy(false))
  }

  const stop = () => {
    if (!invite) return
    stopInvite(invite.code)
      .then(() => setInvite(null))
      .catch(() => emit('session:error'))
  }

  // Clipboard needs https or localhost - otherwise the link is selected
  // so it can be copied by hand.
  const copy = () => {
    if (!invite) return
    const link = linkFor(invite.code)
    const fallback = () => inputRef.current?.select()
    if (!navigator.clipboard) {
      fallback()
      return
    }
    navigator.clipboard
      .writeText(link)
      .then(() => emit('session:link-copied'))
      .catch(fallback)
  }

  return (
    <section className="realtime-section">
      <h3 className="realtime-heading">Invite link</h3>
      {invite ? (
        <>
          <div className="realtime-invite-link">
            <input
              ref={inputRef}
              type="text"
              readOnly
              aria-label="Invite link"
              value={linkFor(invite.code)}
              onFocus={(e) => e.target.select()}
            />
            <button type="button" className="realtime-button realtime-button--accent" onClick={copy}>
              Copy
            </button>
          </div>
          <div className="realtime-invite-about">
            <span>
              {CAN_TEXT[invite.role]} · until {formatLongDate(invite.expires)}
            </span>
            <button type="button" className="realtime-text-button realtime-text-button--danger" onClick={stop}>
              Stop this link
            </button>
          </div>
        </>
      ) : (
        <p className="realtime-note">No working link - make one to invite people in.</p>
      )}

      <div className="realtime-field">
        <span className="realtime-field-label">People who join can</span>
        <div className="realtime-segmented" role="group" aria-label="People who join can">
          {(['editor', 'viewer'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={role === option}
              className={`realtime-segment${role === option ? ' realtime-segment--active' : ''}`}
              onClick={() => setRole(option)}
            >
              {option === 'editor' ? 'Edit' : 'View only'}
            </button>
          ))}
        </div>
      </div>
      <label className="realtime-field realtime-field--row">
        <span className="realtime-field-label">Link expires</span>
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          {HOURS.map((option) => (
            <option key={option.hours} value={option.hours}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="realtime-button realtime-button--accent realtime-button--wide" disabled={busy} onClick={make}>
        {invite ? 'Make a new link' : 'Make a link'}
      </button>
      {invite && <p className="realtime-note">A new link stops the one above working.</p>}
    </section>
  )
}

export default SessionInvite
