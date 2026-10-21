import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'
import GuestJoin from '../components/guest/GuestJoin'
import { forgetGuestPass, readGuestPass, storeGuestPass, type GuestPass } from '../components/guest/guestPass'
import '../components/auth/SignIn.css'

interface AuthOptions {
  // Keycloak realm address, e.g. https://localhost:5173/auth/realms/diss
  authority: string
  clientId: string
}

interface AuthUser {
  // Keycloak's id - what collections and realtime key on. A guest's is the
  // hub's random guest-... id instead.
  id: string
  name: string
  username: string
  // Only for a guest - the one session they can look at, and the link they
  // came in on. See docs/guests.md.
  guest?: { sessionId: string; inviteCode: string }
}

interface AuthContextValue {
  user: AuthUser
  // The current access token - read fresh each time, since it's renewed
  // in the background.
  getAccessToken: () => string
  // fetch with the access token added, for annotation-store.
  authFetch: (input: string, init?: RequestInit) => Promise<Response>
  signOut: () => void
  // Signs in again, asking which account - handy for trying two people in
  // two tabs.
  switchUser: () => void
  // Sign in, or make an account (create), coming back to the guest's invite
  // link. For a guest who wants to edit.
  signIn: (create?: boolean) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Coming back from Keycloak, the code in the URL can only be swapped for a
// token once. React runs effects twice in dev, so the first attempt is kept
// and shared.
let callbackInFlight: Promise<User> | null = null

function userFrom(user: User): AuthUser {
  const { sub, name, preferred_username } = user.profile
  return { id: sub, name: name ?? preferred_username ?? sub, username: preferred_username ?? sub }
}

function guestUserFrom(pass: GuestPass): AuthUser {
  return { id: pass.guestId, name: pass.name, username: '', guest: { sessionId: pass.sessionId, inviteCode: pass.inviteCode } }
}

type Status =
  | { kind: 'signing-in' }
  | { kind: 'signed-in'; user: User }
  // An invite link opened without being signed in - sign in, or join as a guest.
  | { kind: 'choosing'; code: string }
  | { kind: 'guest'; pass: GuestPass }
  // left - they chose to. expired - their guest pass ran out.
  | { kind: 'guest-gone'; reason: 'left' | 'expired'; code: string }
  | { kind: 'error'; message: string }

interface AuthContextProviderProps {
  auth: AuthOptions
  // For joining as a guest - annotation-store says what the link is for,
  // the hub hands out the guest pass.
  storeUrl: string
  hubUrl?: string
  children: ReactNode
}

// Everything below this needs a signed-in user or a guest, so nothing renders
// until there is one - with no token it would just be failed requests.
function AuthContextProvider({ auth, storeUrl, hubUrl, children }: AuthContextProviderProps) {
  const manager = useMemo(() => {
    const here = window.location.origin + window.location.pathname
    return new UserManager({
      authority: auth.authority,
      client_id: auth.clientId,
      redirect_uri: here,
      post_logout_redirect_uri: here,
      response_type: 'code',
      scope: 'openid profile email',
      // Renews with the refresh token before the access token runs out.
      automaticSilentRenew: true,
      // Per tab, so two tabs can be two people (see switchUser).
      userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    })
  }, [auth.authority, auth.clientId])

  const [status, setStatus] = useState<Status>({ kind: 'signing-in' })
  const userRef = useRef<User | null>(null)
  const guestRef = useRef<GuestPass | null>(null)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams(window.location.search)

    const start = async (): Promise<Status | null> => {
      if (params.has('code') && params.has('state')) {
        callbackInFlight ??= manager.signinRedirectCallback()
        const user = await callbackInFlight
        // Swap the code for whatever the address had before signing in - an
        // invite link's ?invite= has to survive the trip to Keycloak.
        const returnTo = typeof user.state === 'string' ? user.state : ''
        window.history.replaceState(window.history.state, '', window.location.pathname + returnTo + window.location.hash)
        forgetGuestPass()
        return { kind: 'signed-in', user }
      }
      const user = await manager.getUser()
      if (user && !user.expired) return { kind: 'signed-in', user }
      // A guest reloading the tab.
      const pass = readGuestPass()
      if (pass) return { kind: 'guest', pass }
      const code = params.get('invite')
      if (code) return { kind: 'choosing', code }
      await manager.signinRedirect({ state: window.location.search })
      return null
    }

    start()
      .then((next) => {
        if (cancelled || !next) return
        if (next.kind === 'signed-in') userRef.current = next.user
        if (next.kind === 'guest') guestRef.current = next.pass
        setStatus(next)
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      })

    const onLoaded = (user: User) => {
      userRef.current = user
      guestRef.current = null
      setStatus({ kind: 'signed-in', user })
    }
    // Renewing failed (signed out elsewhere, session ended) - sign in again.
    const onExpired = () => manager.signinRedirect({ state: window.location.search }).catch(() => {})
    manager.events.addUserLoaded(onLoaded)
    manager.events.addAccessTokenExpired(onExpired)
    manager.events.addUserSignedOut(onExpired)

    return () => {
      cancelled = true
      manager.events.removeUserLoaded(onLoaded)
      manager.events.removeAccessTokenExpired(onExpired)
      manager.events.removeUserSignedOut(onExpired)
    }
  }, [manager])

  // The guest pass runs out at a set time - there's no renewing it.
  useEffect(() => {
    if (status.kind !== 'guest') return
    const { pass } = status
    const timer = setTimeout(
      () => {
        forgetGuestPass()
        guestRef.current = null
        setStatus({ kind: 'guest-gone', reason: 'expired', code: pass.inviteCode })
      },
      Math.max(0, Date.parse(pass.expires) - Date.now())
    )
    return () => clearTimeout(timer)
  }, [status])

  const getAccessToken = useCallback(() => guestRef.current?.token ?? userRef.current?.access_token ?? '', [])

  const authFetch = useCallback(
    (input: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${getAccessToken()}`)
      return fetch(input, { ...init, headers })
    },
    [getAccessToken]
  )

  // Back to the invite link once they're through, so they can join with it.
  const signIn = useCallback(
    (create = false) => {
      const code =
        guestRef.current?.inviteCode ?? (status.kind === 'choosing' || status.kind === 'guest-gone' ? status.code : null)
      forgetGuestPass()
      guestRef.current = null
      manager
        .signinRedirect({
          prompt: create ? 'create' : undefined,
          state: code ? `?invite=${encodeURIComponent(code)}` : window.location.search,
        })
        .catch(() => {})
    },
    [manager, status]
  )

  // A guest just goes - there's no Keycloak session to end.
  const signOut = useCallback(() => {
    const pass = guestRef.current
    if (pass) {
      forgetGuestPass()
      guestRef.current = null
      setStatus({ kind: 'guest-gone', reason: 'left', code: pass.inviteCode })
      return
    }
    manager.signoutRedirect().catch(() => {})
  }, [manager])

  const switchUser = useCallback(() => {
    if (guestRef.current) {
      signIn(false)
      return
    }
    manager
      .removeUser()
      .then(() => manager.signinRedirect({ prompt: 'login', state: window.location.search }))
      .catch(() => {})
  }, [manager, signIn])

  const joinAsGuest = useCallback((pass: GuestPass) => {
    storeGuestPass(pass)
    guestRef.current = pass
    setStatus({ kind: 'guest', pass })
  }, [])

  const user = useMemo(
    () => (status.kind === 'signed-in' ? userFrom(status.user) : status.kind === 'guest' ? guestUserFrom(status.pass) : null),
    [status]
  )

  if (status.kind === 'error') {
    return (
      <div className="sign-in">
        <p className="sign-in-title">Couldn't sign in</p>
        <p className="sign-in-detail">{status.message}</p>
        <button type="button" className="sign-in-button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    )
  }

  if (status.kind === 'choosing') {
    return <GuestJoin storeUrl={storeUrl} hubUrl={hubUrl} code={status.code} onJoined={joinAsGuest} onSignIn={signIn} />
  }

  if (status.kind === 'guest-gone') {
    return (
      <div className="sign-in">
        <p className="sign-in-title">{status.reason === 'expired' ? 'Your guest pass has run out' : "You've left the session"}</p>
        <p className="sign-in-detail">
          {status.reason === 'expired'
            ? 'Guest passes last a few hours at most. Open the link again, or ask the host for a new one.'
            : 'Your name went with you - nothing about you was kept.'}
        </p>
        <button type="button" className="sign-in-button" onClick={() => setStatus({ kind: 'choosing', code: status.code })}>
          Open the link again
        </button>
        <button type="button" className="sign-in-button" onClick={() => signIn(true)}>
          Make an account
        </button>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="sign-in">
        <p className="sign-in-title">Signing in…</p>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ user, getAccessToken, authFetch, signOut, switchUser, signIn }}>
      {children}
    </AuthContext.Provider>
  )
}

function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthContextProvider')
  }
  return context
}

export { AuthContextProvider, useAuthContext }
export type { AuthOptions, AuthUser }
