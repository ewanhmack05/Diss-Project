import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { HubConnectionBuilder, LogLevel, type HubConnection } from '@microsoft/signalr'
import {
  docStateFromWire,
  fromBase64,
  throttle,
  toBase64,
  type AnnotationOp,
  type Comparison,
  type ComparisonDot,
  type ComparisonSettings,
  type SharedCount,
  type SharedCountSettings,
  type SharedDot,
  type SharedDotAdded,
  type SharedDotRemoved,
  type DocEditors,
  type DocState,
  type DocStateWire,
  type DocUpdateWire,
  type JoinResult,
  type Participant,
  type Sketch,
  type SketchUpdate,
  type StampedOp,
  type Viewport,
  type ViewportUpdate,
} from '../components/realtime/realtime'
import { useImageViewerContext } from './ImageViewerContext'
import { useEmitEvent } from './EventContext'
import { newId } from '../newId'

// off - no hub URL given, so realtime is switched off entirely.
// offline - couldn't connect, still retrying in the background.
type RealtimeStatus = 'off' | 'connecting' | 'connected' | 'reconnecting' | 'offline'

type OpHandler = (op: StampedOp) => void
type DocUpdateHandler = (docId: string, update: Uint8Array) => void
type DocEditorsHandler = (docId: string, editors: string[]) => void

interface RealtimeContextValue {
  status: RealtimeStatus
  me: Participant | null
  others: Participant[]
  sendOp: (op: AnnotationOp) => void
  sendViewport: (viewport: Viewport) => void
  // Null once you finish or give up drawing.
  sendSketch: (sketch: Sketch | null) => void
  // Returns an unsubscribe, so it drops straight into a useEffect.
  onOp: (handler: OpHandler) => () => void
  // Shared docs (see sharedFields.ts). openDoc resolves null when not
  // connected; the others quietly do nothing then.
  openDoc: (docId: string, seed: Uint8Array) => Promise<DocState | null>
  sendDocUpdate: (docId: string, update: Uint8Array) => void
  closeDoc: (docId: string) => void
  onDocUpdate: (handler: DocUpdateHandler) => () => void
  onDocEditors: (handler: DocEditorsHandler) => () => void
  // The comparison count running on this slide, if any (see
  // ComparisonContext). These reject with the hub's message if the call
  // doesn't fit its current state, or if not connected.
  comparison: Comparison | null
  startComparison: (settings: ComparisonSettings) => Promise<Comparison>
  joinComparison: (id: string) => Promise<void>
  leaveComparison: (id: string) => Promise<void>
  submitComparison: (id: string, dots: ComparisonDot[]) => Promise<void>
  // The shared count running on this slide, if any (see SharedCountContext).
  // Your own dots are added and removed here straight away, rather than
  // waiting on the hub, which doesn't echo them back.
  sharedCount: SharedCount | null
  startSharedCount: (settings: SharedCountSettings) => Promise<SharedCount>
  joinSharedCount: (id: string) => Promise<void>
  leaveSharedCount: (id: string) => Promise<void>
  finishSharedCount: (id: string) => Promise<void>
  addSharedDot: (dot: Omit<SharedDot, 'connectionId'>) => void
  removeSharedDot: (dotId: string) => void
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
      userId = newId()
      sessionStorage.setItem('realtime-user-id', userId)
    }
  } catch {
    userId = newId()
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
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [sharedCount, setSharedCount] = useState<SharedCount | null>(null)
  // Read by the dot sends, which don't want to rebuild on every dot.
  const sharedCountRef = useRef<SharedCount | null>(null)
  const meRef = useRef<Participant | null>(null)
  useEffect(() => {
    sharedCountRef.current = sharedCount
    meRef.current = me
  })

  const identityRef = useRef(guestIdentity())
  const connectionRef = useRef<HubConnection | null>(null)
  const joinedRef = useRef(false)
  const lastViewportRef = useRef<Viewport | null>(null)
  const lastSketchRef = useRef<Sketch | null>(null)
  const opHandlersRef = useRef(new Set<OpHandler>())
  const docUpdateHandlersRef = useRef(new Set<DocUpdateHandler>())
  const docEditorsHandlersRef = useRef(new Set<DocEditorsHandler>())
  // One of each per connection, made in the effect below.
  const throttledViewportRef = useRef<((viewport: Viewport) => void) | null>(null)
  const throttledSketchRef = useRef<ReturnType<typeof throttle<[Sketch]>> | null>(null)

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
    // Same rate as viewports - plenty to watch a line being drawn.
    const throttledSketch = throttle((sketch: Sketch) => {
      if (!joinedRef.current) return
      connection.send('UpdateSketch', sketch).catch(() => {})
    }, VIEWPORT_THROTTLE_MS)
    throttledSketchRef.current = throttledSketch

    let stopped = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retryMs = RETRY_MIN_MS
    let reportedError = false

    const reset = () => {
      joinedRef.current = false
      setMe(null)
      setOthers([])
      setComparison(null)
      setSharedCount(null)
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
      setComparison(result.comparison)
      setSharedCount(result.sharedCount)
      setStatus('connected')
      retryMs = RETRY_MIN_MS
      if (lastViewportRef.current) connection.send('UpdateViewport', lastViewportRef.current).catch(() => {})
      if (lastSketchRef.current) connection.send('UpdateSketch', lastSketchRef.current).catch(() => {})
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
    connection.on('SketchUpdated', ({ connectionId, sketch }: SketchUpdate) =>
      setOthers((current) => current.map((p) => (p.connectionId === connectionId ? { ...p, sketch } : p)))
    )
    connection.on('DocUpdated', ({ docId, update }: DocUpdateWire) => {
      const bytes = fromBase64(update)
      docUpdateHandlersRef.current.forEach((handler) => handler(docId, bytes))
    })
    connection.on('DocEditorsChanged', ({ docId, editors }: DocEditors) =>
      docEditorsHandlersRef.current.forEach((handler) => handler(docId, editors))
    )
    // Comes to the sender too, so this is the only place it's set.
    connection.on('ComparisonChanged', (next: Comparison | null) => setComparison(next))
    connection.on('SharedCountChanged', (next: SharedCount | null) => setSharedCount(next))
    // Ignored if it's for a count we've already moved on from.
    connection.on('SharedDotAdded', ({ sharedCountId, dot }: SharedDotAdded) =>
      setSharedCount((current) =>
        current?.id === sharedCountId && !current.dots.some((d) => d.id === dot.id)
          ? { ...current, dots: [...current.dots, dot] }
          : current
      )
    )
    connection.on('SharedDotRemoved', ({ sharedCountId, dotId }: SharedDotRemoved) =>
      setSharedCount((current) =>
        current?.id === sharedCountId ? { ...current, dots: current.dots.filter((d) => d.id !== dotId) } : current
      )
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
      throttledSketch.cancel()
      throttledSketchRef.current = null
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

  // Finishing goes out straight away rather than waiting on the throttle,
  // so a saved shape and its sketch aren't both on screen for a moment.
  const sendSketch = useCallback((sketch: Sketch | null) => {
    lastSketchRef.current = sketch
    const throttled = throttledSketchRef.current
    if (sketch) {
      throttled?.(sketch)
      return
    }
    throttled?.cancel()
    const connection = connectionRef.current
    if (connection && joinedRef.current) connection.send('UpdateSketch', null).catch(() => {})
  }, [])

  const onOp = useCallback((handler: OpHandler) => {
    opHandlersRef.current.add(handler)
    return () => {
      opHandlersRef.current.delete(handler)
    }
  }, [])

  const openDoc = useCallback(async (docId: string, seed: Uint8Array) => {
    const connection = connectionRef.current
    if (!connection || !joinedRef.current) return null
    const wire = await connection.invoke<DocStateWire>('OpenDoc', docId, toBase64(seed))
    return docStateFromWire(wire)
  }, [])

  const sendDocUpdate = useCallback((docId: string, update: Uint8Array) => {
    const connection = connectionRef.current
    if (!connection || !joinedRef.current) return
    connection.send('SendDocUpdate', docId, toBase64(update)).catch(() => {})
  }, [])

  const closeDoc = useCallback((docId: string) => {
    const connection = connectionRef.current
    if (!connection || !joinedRef.current) return
    connection.send('CloseDoc', docId).catch(() => {})
  }, [])

  const onDocUpdate = useCallback((handler: DocUpdateHandler) => {
    docUpdateHandlersRef.current.add(handler)
    return () => {
      docUpdateHandlersRef.current.delete(handler)
    }
  }, [])

  const onDocEditors = useCallback((handler: DocEditorsHandler) => {
    docEditorsHandlersRef.current.add(handler)
    return () => {
      docEditorsHandlersRef.current.delete(handler)
    }
  }, [])

  // Needs a joined connection, unlike the fire and forget sends above -
  // the caller wants to know if it didn't happen.
  const invokeJoined = useCallback(<T,>(method: string, ...args: unknown[]) => {
    const connection = connectionRef.current
    if (!connection || !joinedRef.current) return Promise.reject(new Error('Not connected'))
    return connection.invoke<T>(method, ...args)
  }, [])

  const startComparison = useCallback(
    (settings: ComparisonSettings) => invokeJoined<Comparison>('StartComparison', settings),
    [invokeJoined]
  )
  const joinComparison = useCallback((id: string) => invokeJoined<void>('JoinComparison', id), [invokeJoined])
  const leaveComparison = useCallback((id: string) => invokeJoined<void>('LeaveComparison', id), [invokeJoined])
  const submitComparison = useCallback(
    (id: string, dots: ComparisonDot[]) => invokeJoined<void>('SubmitComparison', id, dots),
    [invokeJoined]
  )

  const startSharedCount = useCallback(
    (settings: SharedCountSettings) => invokeJoined<SharedCount>('StartSharedCount', settings),
    [invokeJoined]
  )
  const joinSharedCount = useCallback((id: string) => invokeJoined<void>('JoinSharedCount', id), [invokeJoined])
  const leaveSharedCount = useCallback((id: string) => invokeJoined<void>('LeaveSharedCount', id), [invokeJoined])
  const finishSharedCount = useCallback((id: string) => invokeJoined<void>('FinishSharedCount', id), [invokeJoined])

  // Fire and forget like ops - a dot the hub turns down (the count just
  // ended, say) only matters to whoever placed it.
  const addSharedDot = useCallback(
    (dot: Omit<SharedDot, 'connectionId'>) => {
      const current = sharedCountRef.current
      const connectionId = meRef.current?.connectionId
      if (!current || !connectionId) return
      setSharedCount((count) =>
        count?.id === current.id ? { ...count, dots: [...count.dots, { ...dot, connectionId }] } : count
      )
      invokeJoined('AddSharedDot', current.id, dot).catch(() => {})
    },
    [invokeJoined]
  )
  const removeSharedDot = useCallback(
    (dotId: string) => {
      const current = sharedCountRef.current
      if (!current) return
      setSharedCount((count) =>
        count?.id === current.id ? { ...count, dots: count.dots.filter((d) => d.id !== dotId) } : count
      )
      invokeJoined('RemoveSharedDot', current.id, dotId).catch(() => {})
    },
    [invokeJoined]
  )

  return (
    <RealtimeContext.Provider
      value={{
        status: hubUrl ? status : 'off',
        me,
        others,
        sendOp,
        sendViewport,
        sendSketch,
        onOp,
        openDoc,
        sendDocUpdate,
        closeDoc,
        onDocUpdate,
        onDocEditors,
        comparison,
        startComparison,
        joinComparison,
        leaveComparison,
        submitComparison,
        sharedCount,
        startSharedCount,
        joinSharedCount,
        leaveSharedCount,
        finishSharedCount,
        addSharedDot,
        removeSharedDot,
      }}
    >
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
