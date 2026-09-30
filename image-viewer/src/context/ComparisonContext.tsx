import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Comparison, Counter } from '../components/realtime/realtime'
import { useRealtimeContext } from './RealtimeContext'
import { useCellCountDrawContext } from './CellCountDrawContext'
import { useToolbarContext } from './ToolbarContext'
import { useEmitEvent } from './EventContext'

// Where you are in a comparison count:
// hosting - placing the ROI, before the hub knows about it
// counting - counting your own copy of the ROI
// waiting - handed in, waiting on everyone else
// results - it's been revealed and you haven't closed it yet
type ComparisonStage = 'hosting' | 'counting' | 'waiting' | 'results'

interface ComparisonContextValue {
  // Live from the hub - dots are hidden until it's revealed.
  comparison: Comparison | null
  myCounter: Counter | null
  stage: ComparisonStage | null
  // The revealed comparison you took part in, kept as it was at the reveal
  // until you close it, so people leaving after doesn't change your results.
  results: Comparison | null
  // Set while a joiner is counting, so MapNode puts the box where the host did.
  fixedRoiGeoJson: string | null
  canHost: boolean
  // Starts ROI placement. start() is then called by MapNode once it's confirmed.
  host: () => void
  start: (roiGeoJson: string, matchRadius: number) => void
  join: () => void
  decline: () => void
  submit: () => void
  // Gives up part way through, throwing the count away.
  quit: () => void
  // keep leaves your own count waiting on the save form.
  closeResults: (keep: boolean) => void
}

const ComparisonContext = createContext<ComparisonContextValue | null>(null)

// Glues the hub's comparison state to the normal cell counter. A
// comparison count is just a normal count with annotation and ROI forced
// on - the difference is what happens when you stop.
function ComparisonContextProvider({ children }: { children: ReactNode }) {
  const {
    status,
    me,
    others,
    comparison,
    startComparison,
    joinComparison,
    leaveComparison,
    submitComparison,
  } = useRealtimeContext()
  const {
    counting,
    pending,
    dotSize,
    dotHistory,
    setCounting,
    setWithAnnotation,
    setWithRoi,
    setDotSize,
    setRoiConfirmed,
    setPending,
    resetCount,
  } = useCellCountDrawContext()
  const { openTool } = useToolbarContext()
  const emit = useEmitEvent()

  const [hosting, setHosting] = useState(false)
  const [snapshot, setSnapshot] = useState<Comparison | null>(null)
  // Closed results, so the same reveal doesn't pop straight back up.
  const [closedIds, setClosedIds] = useState<string[]>([])
  const [fixedRoiGeoJson, setFixedRoiGeoJson] = useState<string | null>(null)
  const quittingRef = useRef(false)

  const myCounter = comparison?.counters.find((c) => c.connectionId === me?.connectionId) ?? null
  const liveReveal = comparison?.revealed && myCounter && !closedIds.includes(comparison.id) ? comparison : null
  // The live one until the snapshot below catches up.
  const results = snapshot ?? liveReveal

  let stage: ComparisonStage | null = null
  if (results) stage = 'results'
  else if (hosting) stage = 'hosting'
  else if (myCounter?.state === 'counting') stage = 'counting'
  // Not once it's revealed - that's results, or results you've just closed.
  else if (myCounter?.state === 'submitted' && !comparison?.revealed) stage = 'waiting'

  useEffect(() => {
    if (!liveReveal || snapshot?.id === liveReveal.id) return
    setSnapshot(liveReveal)
    emit('comparison:revealed', { id: liveReveal.id })
  }, [liveReveal, snapshot, emit])

  // Toast the invite once, when it first shows up.
  const invitedId = myCounter?.state === 'invited' ? comparison!.id : null
  useEffect(() => {
    if (invitedId) emit('comparison:invited', { id: invitedId })
  }, [invitedId, emit])

  // Dropped out from under you - the hub called it off (not enough people)
  // or you lost the connection. Whatever you counted carries on as a
  // normal count.
  const lastStageRef = useRef(stage)
  useEffect(() => {
    const last = lastStageRef.current
    lastStageRef.current = stage
    if ((last === 'counting' || last === 'waiting') && stage === null && !quittingRef.current) {
      emit('comparison:ended')
    }
    quittingRef.current = false
  }, [stage, emit])

  // Backing out of ROI placement ends hosting too.
  useEffect(() => {
    if (!counting) {
      setHosting(false)
      setFixedRoiGeoJson(null)
    }
  }, [counting])

  const busy = counting || pending !== null
  const canHost = status === 'connected' && others.length > 0 && (!comparison || comparison.revealed) && !busy

  // Same set up for host and joiner - comparing needs the dots, and
  // everyone needs to be in the same box.
  const beginCounting = (roiConfirmed: boolean) => {
    setWithAnnotation(true)
    setWithRoi(true)
    resetCount()
    setRoiConfirmed(roiConfirmed)
    setCounting(true)
    openTool('cellcount')
  }

  const host = () => {
    if (!canHost) return
    setHosting(true)
    beginCounting(false)
  }

  const start = (roiGeoJson: string, matchRadius: number) => {
    if (!hosting) return
    startComparison({ roiGeoJson, dotSize, matchRadius })
      .catch(() => emit('comparison:start-error'))
      .finally(() => setHosting(false))
  }

  const join = () => {
    if (!comparison || myCounter?.state !== 'invited' || busy) return
    const { id, settings } = comparison
    joinComparison(id)
      .then(() => {
        setDotSize(settings.dotSize)
        setFixedRoiGeoJson(settings.roiGeoJson)
        beginCounting(true)
      })
      .catch(() => emit('comparison:join-error'))
  }

  const decline = () => {
    if (comparison && myCounter?.state === 'invited') leaveComparison(comparison.id).catch(() => {})
  }

  const submit = () => {
    if (!comparison || myCounter?.state !== 'counting') return
    submitComparison(
      comparison.id,
      dotHistory.map(({ x, y }) => ({ x, y }))
    )
      // MapNode builds pending off this, so your dots stay on the map.
      .then(() => setCounting(false))
      .catch(() => emit('comparison:submit-error'))
  }

  const quit = () => {
    quittingRef.current = true
    if (comparison && myCounter) leaveComparison(comparison.id).catch(() => {})
    setHosting(false)
    if (counting) {
      // MapNode treats a stop with the ROI unconfirmed as throwing it away.
      resetCount()
      setRoiConfirmed(false)
      setCounting(false)
    } else {
      setPending(null)
    }
  }

  const closeResults = (keep: boolean) => {
    if (!results) return
    setClosedIds((current) => [...current, results.id])
    leaveComparison(results.id).catch(() => {})
    setSnapshot(null)
    if (!keep) setPending(null)
  }

  return (
    <ComparisonContext.Provider
      value={{
        comparison,
        myCounter,
        stage,
        results,
        fixedRoiGeoJson,
        canHost,
        host,
        start,
        join,
        decline,
        submit,
        quit,
        closeResults,
      }}
    >
      {children}
    </ComparisonContext.Provider>
  )
}

function useComparisonContext(): ComparisonContextValue {
  const context = useContext(ComparisonContext)
  if (!context) {
    throw new Error('useComparisonContext must be used within a ComparisonContextProvider')
  }
  return context
}

export { ComparisonContextProvider, useComparisonContext }
export type { ComparisonStage }
