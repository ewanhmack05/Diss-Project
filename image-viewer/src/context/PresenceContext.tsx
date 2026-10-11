import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { HubConnectionBuilder, LogLevel, type HubConnection } from '@microsoft/signalr'
import {
  applyOffline,
  applyOnline,
  applySnapshot,
  listUsers,
  onlineUsers,
  type DirectoryUser,
  type ListedUser,
  type UserInvite,
  type OnlineSnapshot,
  type OnlineUser,
  type PresenceState,
  type PresenceWhere,
  type UserOffline,
} from '../components/users/presence'
import { useInviteGate } from '../components/realtime/InviteGate'
import { useAuthContext } from './AuthContext'
import { useCollectionContext } from './CollectionContext'
import { useDialogContext } from './DialogContext'
import { useEmitEvent } from './EventContext'
import { useImageViewerContext } from './ImageViewerContext'

// off - no hub URL given, so there's nobody to see.
type PresenceStatus = 'off' | 'connecting' | 'connected' | 'offline'

interface PresenceContextValue {
  status: PresenceStatus
  // Everyone else with an account - online first, then the rest.
  users: ListedUser[]
  onlineCount: number
  // False if Keycloak's list couldn't be had, so users is only who's online.
  everyoneLoaded: boolean
  // Sends them your session's invite code - it comes up for them to look
  // at and say yes or no to. Rejects with the hub's reason.
  inviteUser: (userId: string, code: string) => Promise<void>
}

const PresenceContext = createContext<PresenceContextValue | null>(null)

const RETRY_MIN_MS = 2000
const RETRY_MAX_MS = 30000

// Who's online, and everyone else with an account, for the Users tab. Its
// own connection to the hub, open the whole time the viewer is, in a
// session or not - RealtimeContext's only exists inside a session.
function PresenceContextProvider({ hubUrl, children }: { hubUrl?: string; children: ReactNode }) {
  const emit = useEmitEvent()
  const { getAccessToken, user } = useAuthContext()
  const { source } = useImageViewerContext()
  const { roomId, session } = useCollectionContext()
  const { showDialog } = useDialogContext()
  const { openInvite } = useInviteGate()

  const [status, setStatus] = useState<Exclude<PresenceStatus, 'off'>>('connecting')
  const [state, setState] = useState<PresenceState>({})
  const [directory, setDirectory] = useState<DirectoryUser[] | null>(null)
  const connectionRef = useRef<HubConnection | null>(null)
  const connectedRef = useRef(false)

  const where: PresenceWhere = {
    slideId: source.slideId,
    sessionId: roomId,
    hosting: !!roomId && session?.myRole === 'owner',
  }
  const whereRef = useRef(where)
  const whereKey = JSON.stringify(where)
  useEffect(() => {
    whereRef.current = JSON.parse(whereKey)
  }, [whereKey])

  // Read from the connection's handlers, which shouldn't reconnect when these change.
  const handlersRef = useRef({ showDialog, openInvite, emit })
  useEffect(() => {
    handlersRef.current = { showDialog, openInvite, emit }
  })

  useEffect(() => {
    if (!hubUrl) return

    const connection = new HubConnectionBuilder()
      .withUrl(`${hubUrl}/hubs/presence`, { accessTokenFactory: getAccessToken })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.None)
      .build()
    connectionRef.current = connection

    let stopped = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retryMs = RETRY_MIN_MS

    // Versions are only comparable within one connection's life on the hub,
    // so a new connection starts from nothing. Everyone's fetched again on
    // each connect - it's what picks up accounts made since. Keycloak being
    // away only costs the offline part of the list.
    const hello = async () => {
      setState({})
      await connection.invoke('SetWhere', whereRef.current)
      const snapshot = await connection.invoke<OnlineSnapshot>('Online')
      if (stopped) return
      setState((current) => applySnapshot(current, snapshot))
      connectedRef.current = true
      setStatus('connected')
      retryMs = RETRY_MIN_MS
      connection
        .invoke<DirectoryUser[]>('Users')
        .then((everyone) => {
          if (!stopped) setDirectory(everyone)
        })
        .catch(() => {})
    }

    const start = async () => {
      setStatus('connecting')
      try {
        await connection.start()
        await hello()
      } catch {
        if (stopped) return
        // Quietly - RealtimeContext already toasts when the hub can't be reached.
        setStatus('offline')
        retryTimer = setTimeout(start, retryMs)
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS)
      }
    }

    connection.on('UserOnline', (online: OnlineUser) => setState((current) => applyOnline(current, online)))
    connection.on('UserOffline', (offline: UserOffline) => setState((current) => applyOffline(current, offline)))
    connection.on('InviteReceived', (invite: UserInvite) => {
      const { showDialog, openInvite, emit } = handlersRef.current
      emit('user:invite-received', { from: invite.fromUserId })
      showDialog({
        title: `${invite.fromName} invited you to their session`,
        message: "Have a look at what it is before you join - you'll only go in if you say so.",
        actions: [{ label: 'Have a look', variant: 'accent', onClick: () => openInvite(invite.code) }, { label: 'Not now' }],
      })
    })

    connection.onreconnecting(() => {
      connectedRef.current = false
      setStatus('connecting')
    })
    connection.onreconnected(() => {
      hello().catch(() => connection.stop())
    })
    connection.onclose(() => {
      connectedRef.current = false
      if (stopped) return
      setStatus('offline')
      retryTimer = setTimeout(start, retryMs)
    })

    start()

    return () => {
      stopped = true
      connectedRef.current = false
      clearTimeout(retryTimer)
      connectionRef.current = null
      setState({})
      connection.stop()
    }
  }, [hubUrl, getAccessToken])

  // Tell everyone when you move - another session, hosting, back on your own.
  useEffect(() => {
    if (!connectedRef.current) return
    connectionRef.current?.invoke('SetWhere', JSON.parse(whereKey)).catch(() => {})
  }, [whereKey, status])

  const inviteUser = useCallback(async (userId: string, code: string) => {
    const connection = connectionRef.current
    if (!connection || !connectedRef.current) throw new Error("Can't reach the real-time hub")
    await connection.invoke('InviteUser', userId, code)
  }, [])

  return (
    <PresenceContext.Provider
      value={{
        status: hubUrl ? status : 'off',
        users: listUsers(directory, state, user.id),
        onlineCount: onlineUsers(state, user.id).length,
        everyoneLoaded: directory !== null,
        inviteUser,
      }}
    >
      {children}
    </PresenceContext.Provider>
  )
}

function usePresenceContext(): PresenceContextValue {
  const context = useContext(PresenceContext)
  if (!context) {
    throw new Error('usePresenceContext must be used within a PresenceContextProvider')
  }
  return context
}

export { PresenceContextProvider, usePresenceContext }
