import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
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
  if (!params.has('invite')) return
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

interface InviteGateContextValue {
  // Shows an invite over the viewer - a code someone typed in, or one a
  // someone sent from the Users tab. Same checks as opening a link.
  openInvite: (code: string) => void
}

const InviteGateContext = createContext<InviteGateContextValue | null>(null)

// Opening an invite link lands here, after signing in and before the viewer.
// A code typed in, or sent from the Users tab, comes up over the viewer instead, so
// whatever you were doing is still there if you say no. Shows who asked you
// and to what, then joins or carries on as you were.
function InviteGate({ children }: { children: ReactNode }) {
  const { status, previewInvite, acceptInvite } = useCollectionContext()
  const { source } = useImageViewerContext()
  const { user, switchUser } = useAuthContext()
  // A guest's link was used to get them in (see AuthContext), so there's
  // nothing to ask.
  const [code, setCode] = useState<string | null>(() => (user.guest ? null : inviteCode()))
  useEffect(() => {
    if (user.guest) forgetInvite()
  }, [user.guest])
  // Over the viewer rather than instead of it.
  const [overlay, setOverlay] = useState(false)
  const [state, setState] = useState<State>(() => (code ? { kind: 'loading' } : { kind: 'none' }))

  useEffect(() => {
    if (!code || status !== 'ready') return
    let cancelled = false
    previewInvite(code).then((preview) => {
      if (cancelled) return
      setState(preview ? { kind: 'ready', preview } : { kind: 'missing' })
    })
    return () => {
      cancelled = true
    }
  }, [code, status, previewInvite])

  const openInvite = useCallback((next: string) => {
    setOverlay(true)
    setCode(next)
    setState({ kind: 'loading' })
  }, [])

  const carryOn = () => {
    forgetInvite()
    setCode(null)
    setOverlay(false)
    setState({ kind: 'none' })
  }

  // The viewer and the overlay always sit in the same two slots, so opening
  // or closing an invite over it never remounts it.
  const withViewer = (over: ReactNode) => (
    <InviteGateContext.Provider value={{ openInvite }}>
      {children}
      {over}
    </InviteGateContext.Provider>
  )
  if (state.kind === 'none') return withViewer(null)

  const shown = (card: ReactNode) =>
    overlay ? (
      withViewer(
        <div className="invite invite--overlay" role="dialog" aria-modal="true" aria-label="Invite">
          {card}
        </div>
      )
    ) : (
      <div className="invite">{card}</div>
    )

  const alone = overlay ? 'Carry on as I was' : 'Open the slide on my own'

  if (state.kind === 'loading') return shown(<p className="invite-note">Opening the invite…</p>)

  if (state.kind === 'missing') {
    return shown(
      <div className="invite-card">
        <span className="invite-eyebrow">Invite</span>
        <h1 className="invite-title">{overlay ? "That code doesn't work" : "This link doesn't work"}</h1>
        <p className="invite-note">Check it was copied in full, or ask whoever sent it for a new one.</p>
        <button type="button" className="invite-button" onClick={carryOn}>
          {alone}
        </button>
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
    return shown(
      <div className="invite-card">
        <span className="invite-eyebrow">Invite</span>
        <h1 className="invite-title">This invite has run out</h1>
        <p className="invite-note">
          {STATUS_TEXT[preview.status]}. Ask {preview.hostName || 'the host'} for a new one - you can still work on
          your own.
        </p>
        <button type="button" className="invite-button" onClick={carryOn}>
          {alone}
        </button>
      </div>
    )
  }

  // The viewer shows one slide - a session on another can't be opened here.
  const otherSlide = preview.slideId !== source.slideId

  return shown(
    <div className="invite-card">
      <span className="invite-eyebrow">Invite</span>
      <h1 className="invite-title">
        {preview.hostName || 'Someone'} invited you to {preview.collectionName}
      </h1>
      <dl className="invite-facts">
        <dt>Slide</dt>
        <dd>{preview.slideId}</dd>
        <dt>You'll be able to</dt>
        <dd>{ROLE_TEXT[preview.joinsAs]}</dd>
        <dt>In it now</dt>
        <dd>{preview.people.length > 0 ? preview.people.join(', ') : 'Nobody else yet'}</dd>
      </dl>
      {preview.alreadyMember && <p className="invite-note">You're already in this session.</p>}
      {preview.joinsAs !== preview.role && (
        <p className="invite-note">
          This session has as many editors as it lets in, so you'll join view only. The host can still let you
          edit.
        </p>
      )}
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
          {overlay ? 'Not now' : 'Work on my own'}
        </button>
      </div>
      <p className="invite-signed-in">
        Signed in as {user.name} ·{' '}
        <button type="button" className="invite-link" onClick={switchUser}>
          not you?
        </button>
      </p>
    </div>
  )
}

function useInviteGate(): InviteGateContextValue {
  const context = useContext(InviteGateContext)
  if (!context) {
    throw new Error('useInviteGate must be used within an InviteGate')
  }
  return context
}

export default InviteGate
export { useInviteGate }
