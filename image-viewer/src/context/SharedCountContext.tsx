import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Contributor, SharedCount } from '../components/realtime/realtime'
import type { CellCountDot } from '../interfaces/CellCount'
import { findDoubleCounts, savedDots, tallyByContributor } from '../components/cell-count/shared/sharedCount'
import { useRealtimeContext } from './RealtimeContext'
import { useCollectionContext } from './CollectionContext'
import { useCellCountDrawContext } from './CellCountDrawContext'
import { useToolbarContext } from './ToolbarContext'
import { useEmitEvent } from './EventContext'

// hosting - started, but the hub doesn't know yet (ROI still being placed,
// or the start call hasn't come back)
// counting - in it, adding dots
type SharedCountStage = 'hosting' | 'counting'

interface SharedCountContextValue {
  // Live from the hub, your own dots included straight away.
  sharedCount: SharedCount | null
  myContributor: Contributor | null
  isHost: boolean
  stage: SharedCountStage | null
  // Dot ids from two different people close enough to be the same cell.
  doubleCounts: Set<string>
  // Dots per connection id.
  tally: Map<string, number>
  // Set while a joiner is counting in an ROI, so MapNode puts the box where the host did.
  fixedRoiGeoJson: string | null
  // Every dot at the moment the host finished, with who placed it - MapNode
  // builds the save form from these.
  finishedDots: CellCountDot[] | null
  canHost: boolean
  // Starts it with the counter's current ROI setting. start() is then called
  // by MapNode, once the ROI is confirmed if there is one.
  host: () => void
  start: (roiGeoJson: string | null, matchRadius: number) => void
  join: () => void
  decline: () => void
  // Stops counting. Your dots stay in the count.
  leave: () => void
  finish: () => void
}

const SharedCountContext = createContext<SharedCountContextValue | null>(null)

// Glues the hub's shared count to the normal cell counter. Each click still
// goes through MapNode's own undo/redo, it just also goes to the hub, and
// the map draws everyone's dots from here rather than your own layer.
function SharedCountContextProvider({ children }: { children: ReactNode }) {
  const {
    status,
    me,
    others,
    sharedCount,
    startSharedCount,
    joinSharedCount,
    leaveSharedCount,
    finishSharedCount,
  } = useRealtimeContext()
  const {
    counting,
    pending,
    dotSize,
    withRoi,
    setCounting,
    cancelCounting,
    setWithAnnotation,
    setWithRoi,
    setDotSize,
    setRoiConfirmed,
    resetCount,
  } = useCellCountDrawContext()
  const { openTool } = useToolbarContext()
  const emit = useEmitEvent()

  const [hosting, setHosting] = useState(false)
  const [fixedRoiGeoJson, setFixedRoiGeoJson] = useState<string | null>(null)
  const [finishedDots, setFinishedDots] = useState<CellCountDot[] | null>(null)
  // Set when we end our own part, so it isn't toasted as ending on us.
  const leavingRef = useRef(false)
  // The count as last seen while it was running.
  const lastCountRef = useRef<SharedCount | null>(null)
  useEffect(() => {
    if (sharedCount) lastCountRef.current = sharedCount
  }, [sharedCount])

  const myContributor = sharedCount?.contributors.find((c) => c.connectionId === me?.connectionId) ?? null
  const isHost = !!sharedCount && sharedCount.hostConnectionId === me?.connectionId

  let stage: SharedCountStage | null = null
  if (hosting) stage = 'hosting'
  else if (myContributor?.state === 'joined') stage = 'counting'

  const dots = sharedCount?.dots
  const matchRadius = sharedCount?.settings.matchRadius ?? 0
  const doubleCounts = useMemo(() => findDoubleCounts(dots ?? [], matchRadius), [dots, matchRadius])
  const tally = useMemo(() => tallyByContributor(dots ?? []), [dots])

  const invitedId = myContributor?.state === 'invited' ? sharedCount!.id : null
  useEffect(() => {
    if (invitedId) emit('sharedcount:invited', { id: invitedId })
  }, [invitedId, emit])

  // Finished by the host, or you were the last one in. Whatever you counted
  // is in the host's copy, so there's nothing of yours to save.
  const lastStageRef = useRef(stage)
  useEffect(() => {
    const last = lastStageRef.current
    lastStageRef.current = stage
    if (last === 'counting' && stage === null) {
      if (!leavingRef.current) {
        emit('sharedcount:ended')
        if (counting) cancelCounting()
      }
      leavingRef.current = false
    }
    // Only on a stage change - the rest is read fresh from this render.
  }, [stage])

  useEffect(() => {
    if (!counting) {
      setHosting(false)
      setFixedRoiGeoJson(null)
    }
  }, [counting])

  // Once the host's save form is done with, so a later solo count doesn't pick these up.
  useEffect(() => {
    if (!pending && !counting) setFinishedDots(null)
  }, [pending, counting])

  const busy = counting || pending !== null
  // View only can't count, so they can't start one or be asked into one.
  const { canEdit } = useCollectionContext()
  const canHost = status === 'connected' && canEdit && others.some((p) => p.canEdit) && !sharedCount && !busy

  const beginCounting = (roi: boolean, roiConfirmed: boolean) => {
    setFinishedDots(null)
    setWithAnnotation(true)
    setWithRoi(roi)
    resetCount()
    setRoiConfirmed(roiConfirmed)
    setCounting(true)
    openTool('cellcount')
  }

  // Keeps whatever ROI setting the counter already has.
  const host = () => {
    if (!canHost) return
    setHosting(true)
    beginCounting(withRoi, false)
  }

  const start = (roiGeoJson: string | null, radius: number) => {
    if (!hosting) return
    startSharedCount({ roiGeoJson, dotSize, matchRadius: radius })
      .catch(() => emit('sharedcount:start-error'))
      .finally(() => setHosting(false))
  }

  const join = () => {
    if (!sharedCount || myContributor?.state !== 'invited' || busy) return
    const { id, settings } = sharedCount
    joinSharedCount(id)
      .then(() => {
        setDotSize(settings.dotSize)
        setFixedRoiGeoJson(settings.roiGeoJson)
        beginCounting(settings.roiGeoJson !== null, true)
      })
      .catch(() => emit('sharedcount:join-error'))
  }

  const decline = () => {
    if (sharedCount && myContributor?.state === 'invited') leaveSharedCount(sharedCount.id).catch(() => {})
  }

  const leave = () => {
    leavingRef.current = true
    if (sharedCount && myContributor) leaveSharedCount(sharedCount.id).catch(() => {})
    setHosting(false)
    cancelCounting()
  }

  const finish = () => {
    if (!sharedCount || !isHost) return
    leavingRef.current = true
    finishSharedCount(sharedCount.id)
      .then(() => {
        // Same batch, so MapNode sees both when counting flips off.
        setFinishedDots(savedDots(lastCountRef.current))
        setCounting(false)
      })
      .catch(() => {
        leavingRef.current = false
        emit('sharedcount:finish-error')
      })
  }

  return (
    <SharedCountContext.Provider
      value={{
        sharedCount,
        myContributor,
        isHost,
        stage,
        doubleCounts,
        tally,
        fixedRoiGeoJson,
        finishedDots,
        canHost,
        host,
        start,
        join,
        decline,
        leave,
        finish,
      }}
    >
      {children}
    </SharedCountContext.Provider>
  )
}

function useSharedCountContext(): SharedCountContextValue {
  const context = useContext(SharedCountContext)
  if (!context) {
    throw new Error('useSharedCountContext must be used within a SharedCountContextProvider')
  }
  return context
}

export { SharedCountContextProvider, useSharedCountContext }
export type { SharedCountStage }
