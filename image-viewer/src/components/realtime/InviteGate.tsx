import { useEffect, useState, type ReactNode } from 'react'
import { useCollectionContext, type InvitePreview } from '../../context/CollectionContext'
import { useImageViewerContext } from '../../context/ImageViewerContext'
import { useAuthContext } from '../../context/AuthContext'
import './InviteGate.css'

const ROLE_TEXT = {
  editor: 'Add and change annotations and counts',
  viewer: 'Look, but not change anything',
  owner: 'Host it',
} as const

const STATUS_TEXT = {
  expired: 'It expired',
  stopped: 'The host stopped it',
  ended: 'The session has ended',
} as const

function inviteCode(): string | null {
  return new URLSearchParams(window.location.search).get('invite')
}

// Takes ?invite= out of the address once it's been dealt with, so a reload
// doesn't ask again.
function forgetInvite() {
  const params = new URLSearchParams(window.location.search)
  params.delete('invite')
  const query = params.toString()
  window.history.replaceState(window.history.state, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash)
}

type State =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'ready'; preview: InvitePreview }
  | { kind: 'joining'; preview: InvitePreview }
  | { kind: 'failed'; preview: InvitePreview }

// Opening an invite link lands here, after signing in and before the viewer.
// Shows who asked you and to what, then joins or carries on alone.
function InviteGate({ children }: { children: ReactNode }) {
  const { status, previewInvite, acceptInvite } = useCollectionContext()
  const { source } = useImageViewerContext()
  const { user, switchUser } = useAuthContext()
  const [state, setState] = useState<State>(() => (inviteCode() ? { kind: 'loading' } : { kind: 'none' }))

  useEffect(() => {
    const code = inviteCode()
    if (!code || status !== 'ready') return
    let cancelled = false
    previewInvite(code).then((preview) => {
      if (cancelled) return
      setState(preview ? { kind: 'ready', preview } : { kind: 'missing' })
    })
    return () => {
      cancelled = true
    }
  }, [status, previewInvite])

  const carryOn = () => {
    forgetInvite()
    setState({ kind: 'none' })
  }

  if (state.kind === 'none') return children
  if (state.kind === 'loading') {
    return (
      <div className="invite">
        <p className="invite-note">Opening the invite…</p>
      </div>
    )
  }

  if (state.kind === 'missing') {
    return (
      <div className="invite">
        <div className="invite-card">
          <span className="invite-eyebrow">Invite</span>
          <h1 className="invite-title">This link doesn't work</h1>
          <p className="invite-note">Check it was copied in full, or ask whoever sent it for a new one.</p>
          <button type="button" className="invite-button" onClick={carryOn}>
            Open the slide on my own
          </button>
        </div>
      </div>
    )
  }

  const { preview } = state
  const join = () => {
    setState({ kind: 'joining', preview })
    acceptInvite(preview.code)
      .then(carryOn)
      .catch(() => setState({ kind: 'failed', preview }))
  }

  if (preview.status !== 'open') {
    return (
      <div className="invite">
        <div className="invite-card">
          <span className="invite-eyebrow">Invite</span>
          <h1 className="invite-title">This link has run out</h1>
          <p className="invite-note">
            {STATUS_TEXT[preview.status]}. Ask {preview.hostName || 'the host'} for a new one - you can still open
            the slide and work on your own.
          </p>
          <button type="button" className="invite-button" onClick={carryOn}>
            Open the slide on my own
          </button>
        </div>
      </div>
    )
  }

  // The viewer shows one slide - a session on another can't be opened here.
  const otherSlide = preview.slideId !== source.slideId

  return (
    <div className="invite">
      <div className="invite-card">
        <span className="invite-eyebrow">Invite</span>
        <h1 className="invite-title">
          {preview.hostName || 'Someone'} invited you to {preview.collectionName}
        </h1>
        <dl className="invite-facts">
          <dt>Slide</dt>
          <dd>{preview.slideId}</dd>
          <dt>You'll be able to</dt>
          <dd>{ROLE_TEXT[preview.role]}</dd>
          <dt>In it now</dt>
          <dd>{preview.people.length > 0 ? preview.people.join(', ') : 'Nobody else yet'}</dd>
        </dl>
        {preview.alreadyMember && <p className="invite-note">You're already in this session.</p>}
        {otherSlide && (
          <p className="invite-note invite-note--warning">
            This session is on slide {preview.slideId}, but this viewer has slide {source.slideId} open.
          </p>
        )}
        {state.kind === 'failed' && <p className="invite-note invite-note--warning">Couldn't join - try again.</p>}
        <div className="invite-actions">
          <button
            type="button"
            className="invite-button invite-button--primary"
            disabled={otherSlide || state.kind === 'joining'}
            onClick={join}
          >
            {state.kind === 'joining' ? 'Joining…' : preview.alreadyMember ? 'Open session' : 'Join session'}
          </button>
          <button type="button" className="invite-button" onClick={carryOn}>
            Work on my own
          </button>
        </div>
        <p className="invite-signed-in">
          Signed in as {user.name} ·{' '}
          <button type="button" className="invite-link" onClick={switchUser}>
            not you?
          </button>
        </p>
      </div>
    </div>
  )
}

export default InviteGate
