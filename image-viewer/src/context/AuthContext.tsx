import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'
import '../components/auth/SignIn.css'

interface AuthOptions {
  // Keycloak realm address, e.g. https://localhost:5173/auth/realms/diss
  authority: string
  clientId: string
}

interface AuthUser {
  // Keycloak's id - what collections and realtime key on.
  id: string
  name: string
  username: string
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

type Status = { kind: 'signing-in' } | { kind: 'signed-in'; user: User } | { kind: 'error'; message: string }

// Everything below this needs a signed-in user, so nothing renders until
// there is one - with no token it would just be failed requests.
function AuthContextProvider({ auth, children }: { auth: AuthOptions; children: ReactNode }) {
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

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams(window.location.search)

    const start = async () => {
      if (params.has('code') && params.has('state')) {
        callbackInFlight ??= manager.signinRedirectCallback()
        const user = await callbackInFlight
        // Swap the code for whatever the address had before signing in - an
        // invite link's ?invite= has to survive the trip to Keycloak.
        const returnTo = typeof user.state === 'string' ? user.state : ''
        window.history.replaceState(window.history.state, '', window.location.pathname + returnTo + window.location.hash)
        return user
      }
      const user = await manager.getUser()
      if (user && !user.expired) return user
      await manager.signinRedirect({ state: window.location.search })
      return null
    }

    start()
      .then((user) => {
        if (cancelled || !user) return
        userRef.current = user
        setStatus({ kind: 'signed-in', user })
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      })

    const onLoaded = (user: User) => {
      userRef.current = user
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

  const getAccessToken = useCallback(() => userRef.current?.access_token ?? '', [])

  const authFetch = useCallback((input: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${userRef.current?.access_token ?? ''}`)
    return fetch(input, { ...init, headers })
  }, [])

  const signOut = useCallback(() => {
    manager.signoutRedirect().catch(() => {})
  }, [manager])

  const switchUser = useCallback(() => {
    manager
      .removeUser()
      .then(() => manager.signinRedirect({ prompt: 'login', state: window.location.search }))
      .catch(() => {})
  }, [manager])

  const user = useMemo(() => (status.kind === 'signed-in' ? userFrom(status.user) : null), [status])

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

  if (!user) {
    return (
      <div className="sign-in">
        <p className="sign-in-title">Signing in…</p>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={{ user, getAccessToken, authFetch, signOut, switchUser }}>{children}</AuthContext.Provider>
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
