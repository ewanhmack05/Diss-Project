import { useEffect, useRef, useState } from 'react'
import { useCollectionContext, type CollectionRole, type Invite } from '../../context/CollectionContext'
import { useEmitEvent } from '../../context/EventContext'
import { formatLongDate } from '../saved/savedDates'
import { sessionSize } from './sessionSize'

const HOURS = [
  { hours: 1, label: 'in 1 hour' },
  { hours: 24, label: 'in 24 hours' },
  { hours: 24 * 7, label: 'in 7 days' },
]

// Short, so it fits on one line beside Change - Settings spells it out.
const CAN_TEXT: Record<CollectionRole, string> = {
  editor: 'Can edit',
  viewer: 'View only',
  owner: '',
}

// The option closest to how long the link was made to last.
function hoursOf(invite: Invite): number {
  const made = (new Date(invite.expires).getTime() - new Date(invite.created).getTime()) / 3_600_000
  return HOURS.reduce((best, option) => (Math.abs(option.hours - made) < Math.abs(best - made) ? option.hours : best), HOURS[0].hours)
}

function linkFor(code: string): string {
  return `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(code)}`
}

// The session's one working link, who it lets in as and how long it lasts.
// The Session tab and Settings each have their own, loaded when they open -
// only one's showing at a time.
function useSessionInvite() {
  const { session, loadInvites, inviteChanges, createInvite, updateInvite, stopInvite } = useCollectionContext()
  const emit = useEmitEvent()
  const [invite, setInvite] = useState<Invite | null>(null)
  const [role, setRole] = useState<CollectionRole>('editor')
  const [hours, setHours] = useState(24)
  const [busy, setBusy] = useState(false)
  const sessionId = session?.collectionId

  // Only a different session clears it - a new invite made elsewhere just
  // replaces it once it's loaded.
  useEffect(() => {
    setInvite(null)
  }, [sessionId])

  useEffect(() => {
    let cancelled = false
    if (!sessionId) return
    loadInvites()
      .then((invites) => {
        if (cancelled) return
        const current = invites[0] ?? null
        setInvite(current)
        if (current) {
          setRole(current.role)
          setHours(hoursOf(current))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionId, loadInvites, inviteChanges])

  // A new one stops the old one, for when the old one has gone further than
  // it should. Same role and expiry as before.
  const make = () => {
    setBusy(true)
    createInvite(role, hours)
      .then(setInvite)
      .catch(() => emit('session:error'))
      .finally(() => setBusy(false))
  }

  // With a working link, changing either setting changes it straight away.
  const change = (nextRole: CollectionRole, nextHours: number) => {
    const before = { role, hours }
    setRole(nextRole)
    setHours(nextHours)
    if (!invite) return
    setBusy(true)
    updateInvite(invite.code, nextRole, nextHours)
      .then(setInvite)
      .catch(() => {
        setRole(before.role)
        setHours(before.hours)
        emit('session:error')
      })
      .finally(() => setBusy(false))
  }

  const stop = () => {
    if (!invite) return
    stopInvite(invite.code)
      .then(() => setInvite(null))
      .catch(() => emit('session:error'))
  }

  return { session, invite, role, hours, busy, make, change, stop }
}

// The quick part, on the Session tab: the link and code to copy, and making
// one. What it lets people do is a line with a way into Settings.
function InviteLink({ onChange }: { onChange: () => void }) {
  const { invite, busy, make } = useSessionInvite()
  const emit = useEmitEvent()
  const inputRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  // Clipboard needs https or localhost - otherwise the text is selected
  // so it can be copied by hand.
  const copy = (text: string, field: HTMLInputElement | null, copied: string) => {
    const fallback = () => field?.select()
    if (!navigator.clipboard) {
      fallback()
      return
    }
    navigator.clipboard
      .writeText(text)
      .then(() => emit(copied))
      .catch(fallback)
  }

  return (
    <section className="realtime-section">
      <h3 className="realtime-heading">Invite</h3>
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
            <button
              type="button"
              className="realtime-button realtime-button--accent"
              onClick={() => copy(linkFor(invite.code), inputRef.current, 'session:link-copied')}
            >
              Copy
            </button>
          </div>
          <div className="realtime-invite-link">
            <span className="realtime-invite-code-label">Or the code</span>
            <input
              ref={codeRef}
              type="text"
              readOnly
              aria-label="Invite code"
              className="realtime-invite-code"
              value={invite.code}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className="realtime-button"
              onClick={() => copy(invite.code, codeRef.current, 'session:code-copied')}
            >
              Copy
            </button>
          </div>
          <div className="realtime-invite-about">
            <span
              className="realtime-invite-about-text"
              title={`People who join ${invite.role === 'viewer' ? 'can only view' : 'can edit'} · until ${formatLongDate(invite.expires)}`}
            >
              {CAN_TEXT[invite.role]} · until {formatLongDate(invite.expires)}
            </span>
            <button type="button" className="realtime-text-button" onClick={onChange}>
              Change
            </button>
          </div>
        </>
      ) : (
        <p className="realtime-note">No working link - make one to let people in.</p>
      )}
      <button type="button" className="realtime-button realtime-button--accent realtime-button--wide" disabled={busy} onClick={make}>
        {invite ? 'Make a new link' : 'Make a link'}
      </button>
    </section>
  )
}

// The rest, in Settings: who the link lets in as, how long it lasts, and
// stopping it. Both change the working link straight away.
function InviteSettings() {
  const { session, invite, role, hours, busy, change, stop } = useSessionInvite()

  return (
    <section className="realtime-section">
      <h3 className="realtime-heading">Invite link</h3>
      <div className="realtime-field">
        <span className="realtime-field-label">People who join can</span>
        <div className="realtime-segmented" role="group" aria-label="People who join can">
          {(['editor', 'viewer'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={role === option}
              className={`realtime-segment${role === option ? ' realtime-segment--active' : ''}`}
              disabled={busy}
              onClick={() => change(option, hours)}
            >
              {option === 'editor' ? 'Edit' : 'View only'}
            </button>
          ))}
        </div>
      </div>
      <label className="realtime-field realtime-field--row">
        <span className="realtime-field-label">Link expires</span>
        <select value={hours} disabled={busy} onChange={(e) => change(role, Number(e.target.value))}>
          {HOURS.map((option) => (
            <option key={option.hours} value={option.hours}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {role === 'editor' && session && sessionSize(session.members, session.maxEditors).full && (
        <p className="realtime-note">
          {session.maxEditors} people are editing already, so anyone joining now comes in view only. You can still
          make them editors from Active.
        </p>
      )}
      {invite ? (
        <div className="realtime-invite-about">
          <span className="realtime-invite-about-text">Working until {formatLongDate(invite.expires)}</span>
          <button type="button" className="realtime-text-button realtime-text-button--danger" onClick={stop}>
            Stop this link
          </button>
        </div>
      ) : (
        <p className="realtime-note">No working link. These are what the next one you make will do.</p>
      )}
    </section>
  )
}

export { InviteLink, InviteSettings }
