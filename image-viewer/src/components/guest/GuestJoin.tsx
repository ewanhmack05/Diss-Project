import { useEffect, useState } from 'react'
import { NAME_MAX, nameProblem, tidyName } from '../../textFilter'
import { fetchGuestInvite, requestGuestPass, type GuestInvite, type GuestPass } from './guestPass'
import '../realtime/InviteGate.css'
import './GuestJoin.css'

const STATUS_TEXT = {
  expired: 'It expired',
  stopped: 'The host stopped it',
  ended: 'The session has ended',
} as const

const FAILED_TEXT = {
  missing: "This link doesn't work any more.",
  closed: 'This invite has just run out.',
  busy: 'Too many tries from here - wait a minute and try again.',
  failed: "Couldn't join - try again.",
} as const

interface GuestJoinProps {
  storeUrl: string
  hubUrl?: string
  code: string
  onJoined: (pass: GuestPass) => void
  // create - straight to making an account rather than signing in.
  onSignIn: (create: boolean) => void
}

type State = { kind: 'loading' } | { kind: 'missing' } | { kind: 'ready'; invite: GuestInvite }

// Opening an invite link without being signed in. Sign in or make an
// account as usual, or join to look on under a name you type. The name goes
// to the hub when you join the room and nowhere else - see docs/guests.md.
function GuestJoin({ storeUrl, hubUrl, code, onJoined, onSignIn }: GuestJoinProps) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchGuestInvite(storeUrl, code).then((invite) => {
      if (!cancelled) setState(invite ? { kind: 'ready', invite } : { kind: 'missing' })
    })
    return () => {
      cancelled = true
    }
  }, [storeUrl, code])

  if (state.kind === 'loading') {
    return (
      <div className="invite">
        <p className="invite-note">Opening the invite…</p>
      </div>
    )
  }

  const accounts = (
    <p className="invite-signed-in">
      Got an account?{' '}
      <button type="button" className="invite-link" onClick={() => onSignIn(false)}>
        Sign in
      </button>{' '}
      ·{' '}
      <button type="button" className="invite-link" onClick={() => onSignIn(true)}>
        Make an account
      </button>
    </p>
  )

  if (state.kind === 'missing') {
    return (
      <div className="invite">
        <div className="invite-card">
          <span className="invite-eyebrow">Invite</span>
          <h1 className="invite-title">This link doesn't work</h1>
          <p className="invite-note">Check it was copied in full, or ask whoever sent it for a new one.</p>
          {accounts}
        </div>
      </div>
    )
  }

  const { invite } = state

  if (invite.status !== 'open') {
    return (
      <div className="invite">
        <div className="invite-card">
          <span className="invite-eyebrow">Invite</span>
          <h1 className="invite-title">This invite has run out</h1>
          <p className="invite-note">
            {STATUS_TEXT[invite.status]}. Ask {invite.hostName || 'the host'} for a new one.
          </p>
          {accounts}
        </div>
      </div>
    )
  }

  const join = async () => {
    const wrong = nameProblem(name)
    if (wrong) {
      setProblem(wrong)
      return
    }
    if (!hubUrl) {
      setProblem(FAILED_TEXT.failed)
      return
    }
    setJoining(true)
    const result = await requestGuestPass(hubUrl, code, tidyName(name))
    setJoining(false)
    if (result.ok) onJoined(result.pass)
    else setProblem(FAILED_TEXT[result.reason])
  }

  return (
    <div className="invite">
      <form
        className="invite-card"
        onSubmit={(e) => {
          e.preventDefault()
          join()
        }}
      >
        <span className="invite-eyebrow">Invite</span>
        <h1 className="invite-title">
          {invite.hostName || 'Someone'} invited you to {invite.collectionName}
        </h1>
        <dl className="invite-facts">
          <dt>Slide</dt>
          <dd>{invite.slideId}</dd>
          <dt>As a guest</dt>
          <dd>Look, but not change anything. Make an account to edit</dd>
        </dl>
        <label className="guest-join-label" htmlFor="guest-name">
          Your name
        </label>
        <input
          id="guest-name"
          className="guest-join-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={NAME_MAX * 2}
          aria-invalid={!!problem}
          aria-describedby="guest-name-note"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setProblem(null)
          }}
        />
        {problem ? (
          <p id="guest-name-note" className="invite-note invite-note--warning" role="alert">
            {problem}
          </p>
        ) : (
          <p id="guest-name-note" className="invite-note">
            Shown to people in the session while you're in it. It isn't saved - once you leave, it's gone.
          </p>
        )}
        <button type="submit" className="invite-button invite-button--primary" disabled={joining || !name.trim()}>
          {joining ? 'Joining…' : 'Join as a guest'}
        </button>
        {accounts}
      </form>
    </div>
  )
}

export default GuestJoin
