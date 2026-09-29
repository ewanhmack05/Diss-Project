import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { HubConnectionBuilder, LogLevel, type HubConnection } from '@microsoft/signalr'
import {
  throttle,
  type AnnotationOp,
  type JoinResult,
  type Participant,
  type StampedOp,
  type Viewport,
  type ViewportUpdate,
} from '../components/realtime/realtime'
import { useImageViewerContext } from './ImageViewerContext'
import { useEmitEvent } from './EventContext'

// off - no hub URL given, so realtime is switched off entirely.
// offline - couldn't connect, still retrying in the background.
type RealtimeStatus = 'off' | 'connecting' | 'connected' | 'reconnecting' | 'offline'

type OpHandler = (op: StampedOp) => void

interface RealtimeContextValue {
  status: RealtimeStatus
  me: Participant | null
  others: Participant[]
  sendOp: (op: AnnotationOp) => void
  sendViewport: (viewport: Viewport) => void
  // Returns an unsubscribe, so it drops straight into a useEffect.
  onOp: (handler: OpHandler) => () => void
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null)

// ~10/sec, per docs/thought-process.md.
const VIEWPORT_THROTTLE_MS = 100
const RETRY_MIN_MS = 2000
const RETRY_MAX_MS = 30000

// No auth yet, so each tab makes up a guest. Kept per tab (sessionStorage)
// so a reload is the same person but two tabs are two people.
function guestIdentity(): { userId: string; displayName: string } {
  let userId: string | null = null
  try {
    userId = sessionStorage.getItem('realtime-user-id')
    if (!userId) {
      userId = crypto.randomUUID()
      sessionStorage.setItem('realtime-user-id', userId)
    }
  } catch {
    userId = crypto.randomUUID()
  }
  return { userId, displayName: `Guest ${userId.slice(0, 4)}` }
}

interface RealtimeContextProviderProps {
  // Leave out to run the viewer without the hub.
  hubUrl?: string
  children: ReactNode
}

function RealtimeContextProvider({ hubUrl, children }: RealtimeContextProviderProps) {
  const { source } = useImageViewerContext()
  const { slideId } = source
  const emit = useEmitEvent()

  const [status, setStatus] = useState<Exclude<RealtimeStatus, 'off'>>('connecting')
  const [me, setMe] = useState<Participant | null>(null)
  const [others, setOthers] = useState<Participant[]>([])

  const identityRef = useRef(guestIdentity())
  const connectionRef = useRef<HubConnection | null>(null)
  const joinedRef = useRef(false)
  const lastViewportRef = useRef<Viewport | null>(null)
  const opHandlersRef = useRef(new Set<OpHandler>())
  // One per connection, made in the effect below.
  const throttledViewportRef = useRef<((viewport: Viewport) => void) | null>(null)

  useEffect(() => {
    if (!hubUrl) return

    const connection = new HubConnectionBuilder()
      .withUrl(`${hubUrl}/hubs/slides`)
      .withAutomaticReconnect()
      .configureLogging(LogLevel.None)
      .build()
    connectionRef.current = connection
    const throttledViewport = throttle((viewport: Viewport) => {
      if (!joinedRef.current) return
      connection.send('UpdateViewport', viewport).catch(() => {})
    }, VIEWPORT_THROTTLE_MS)
    throttledViewportRef.current = throttledViewport

    let stopped = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retryMs = RETRY_MIN_MS
    let reportedError = false

    const reset = () => {
      joinedRef.current = false
      setMe(null)
      setOthers([])
    }

    // Also used after a reconnect - that's a new connection id as far as
    // the hub is concerned, so it has to join again.
    const join = async () => {
      const { userId, displayName } = identityRef.current
      const result = await connection.invoke<JoinResult>('JoinSlide', slideId, userId, displayName)
      if (stopped) return
      joinedRef.current = true
      setMe(result.me)
      setOthers(result.others)
      setStatus('connected')
      retryMs = RETRY_MIN_MS
      if (lastViewportRef.current) connection.send('UpdateViewport', lastViewportRef.current).catch(() => {})
    }

    const start = async () => {
      setStatus('connecting')
      try {
        await connection.start()
        await join()
      } catch {
        if (stopped) return
        setStatus('offline')
        // Only toast the first failure - it keeps retrying quietly after.
        if (!reportedError) {
          reportedError = true
          emit('realtime:connect-error', { hubUrl })
        }
        retryTimer = setTimeout(start, retryMs)
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS)
      }
    }

    connection.on('UserJoined', (participant: Participant) =>
      setOthers((current) => [...current.filter((p) => p.connectionId !== participant.connectionId), participant])
    )
    connection.on('UserLeft', (connectionId: string) =>
      setOthers((current) => current.filter((p) => p.connectionId !== connectionId))
    )
    connection.on('ViewportUpdated', ({ connectionId, viewport }: ViewportUpdate) =>
      setOthers((current) => current.map((p) => (p.connectionId === connectionId ? { ...p, viewport } : p)))
    )
    connection.on('AnnotationOp', (op: StampedOp) => {
      opHandlersRef.current.forEach((handler) => handler(op))
      emit('realtime:op', op)
    })

    connection.onreconnecting(() => {
      reset()
      setStatus('reconnecting')
    })
    connection.onreconnected(() => {
      join().catch(() => connection.stop())
    })
    // Automatic reconnect gave up (or the hub went away mid-join) - fall
    // back to the same retry loop as the first connect.
    connection.onclose(() => {
      if (stopped) return
      reset()
      setStatus('offline')
      retryTimer = setTimeout(start, retryMs)
    })

    start()

    return () => {
      stopped = true
      clearTimeout(retryTimer)
      reset()
      throttledViewport.cancel()
      throttledViewportRef.current = null
      connectionRef.current = null
      connection.stop()
    }
  }, [hubUrl, slideId, emit])

  const sendOp = useCallback((op: AnnotationOp) => {
    const connection = connectionRef.current
    if (!connection || !joinedRef.current) return
    // Fire and forget - a dropped op just means others see it on their
    // next load instead, since the change itself is saved separately.
    connection.invoke('SendAnnotationOp', op).catch(() => {})
  }, [])

  const sendViewport = useCallback((viewport: Viewport) => {
    lastViewportRef.current = viewport
    throttledViewportRef.current?.(viewport)
  }, [])

  const onOp = useCallback((handler: OpHandler) => {
    opHandlersRef.current.add(handler)
    return () => {
      opHandlersRef.current.delete(handler)
    }
  }, [])

  return (
    <RealtimeContext.Provider value={{ status: hubUrl ? status : 'off', me, others, sendOp, sendViewport, onOp }}>
      {children}
    </RealtimeContext.Provider>
  )
}

function useRealtimeContext(): RealtimeContextValue {
  const context = useContext(RealtimeContext)
  if (!context) {
    throw new Error('useRealtimeContext must be used within a RealtimeContextProvider')
  }
  return context
}

export { RealtimeContextProvider, useRealtimeContext }
