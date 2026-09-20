import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { BotControlState, BotRegion } from '../components/connectome/types'
import { parseControlState } from './botControl'
import { useImageViewerContext } from './ImageViewerContext'

type Status = 'loading' | 'ready' | 'error'

// Which single PATCH is currently in flight, if any - lets the panel disable
// just the one control being changed (and show a "saving" state on it)
// rather than freezing the whole panel for the round trip.
type PendingAction = 'annotations' | 'cellCount' | 'region' | null

interface BotControlContextValue {
  status: Status
  annotationsEnabled: boolean
  cellCountEnabled: boolean
  region: BotRegion | null
  pendingAction: PendingAction
  // Set the moment a PATCH fails to round-trip (bot not running, a network
  // blip) and cleared the moment a later one succeeds - purely informational,
  // since the three values above only ever change from a response the
  // server actually confirmed, never a locally-guessed flip.
  lastActionError: string | null
  // True while the user is mid-drag on the main map drawing a new working
  // area (see MapNode) - toggled from the panel's own button, read by
  // MapNode to know whether to attach its Draw interaction.
  drawingWorkingArea: boolean
  // Whichever slide the bot's /control last confirmed it's writing into -
  // reported by this tab's own slideId-reporting effect below, so under
  // normal operation this always equals the slide actually open here. Only
  // out of sync (visible to ConnectomeControls as a mismatch) if another
  // tab open on a different slide reported in more recently, or the report
  // below hasn't round-tripped yet.
  botSlideId: string | null
  setAnnotationsEnabled: (enabled: boolean) => void
  setCellCountEnabled: (enabled: boolean) => void
  setRegion: (region: BotRegion | null) => void
  startDrawingWorkingArea: () => void
  stopDrawingWorkingArea: () => void
  // Re-runs the initial GET after it failed (see status 'error') - there's
  // no poll to eventually recover on its own, so this is the only way back
  // to 'ready' short of reloading the page.
  retryLoad: () => void
}

const BotControlContext = createContext<BotControlContextValue | null>(null)

interface BotControlContextProviderProps {
  liveServerUrl: string
  children: ReactNode
}

function BotControlContextProvider({ liveServerUrl, children }: BotControlContextProviderProps) {
  const { source } = useImageViewerContext()
  const { slideId: viewerSlideId } = source

  const [status, setStatus] = useState<Status>('loading')
  const [annotationsEnabled, setAnnotationsEnabledState] = useState(false)
  const [cellCountEnabled, setCellCountEnabledState] = useState(false)
  const [region, setRegionState] = useState<BotRegion | null>(null)
  const [botSlideId, setBotSlideIdState] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [lastActionError, setLastActionError] = useState<string | null>(null)
  const [drawingWorkingArea, setDrawingWorkingArea] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Reads whatever the bot is actually doing right now - never assumes both
  // toggles start on, and never assumes there's no region already set from
  // an earlier session.
  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    fetch(`${liveServerUrl}/control`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json()
      })
      .then((data) => {
        if (cancelled) return
        const parsed = parseControlState(data)
        if (!parsed) throw new Error('malformed control state')
        setAnnotationsEnabledState(parsed.annotationsEnabled)
        setCellCountEnabledState(parsed.cellCountEnabled)
        setRegionState(parsed.region)
        setBotSlideIdState(parsed.slideId)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [liveServerUrl, reloadKey])

  // Reports this tab's own slide to the bot on load and on every slide
  // change - without this, the bot keeps writing into whatever slide it
  // last had (its own BOT_SLIDE_ID default, or another tab's), and this
  // tab's annotation/cell-count panels poll a collection it never gets
  // anything from (see flywire-bot's ensureCurrentSlide in bot.ts, which is
  // what actually reacts to this patch). Best-effort: a failed report just
  // leaves botSlideId showing whatever the bot last confirmed, which
  // ConnectomeControls can surface as a mismatch.
  useEffect(() => {
    let cancelled = false

    fetch(`${liveServerUrl}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideId: viewerSlideId }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json()
      })
      .then((data) => {
        if (cancelled) return
        const parsed = parseControlState(data)
        if (!parsed) return
        setAnnotationsEnabledState(parsed.annotationsEnabled)
        setCellCountEnabledState(parsed.cellCountEnabled)
        setRegionState(parsed.region)
        setBotSlideIdState(parsed.slideId)
      })
      .catch(() => {
        // The initial GET/retryLoad flow above already surfaces an
        // unreachable bot - this just skips the sync for this tick.
      })

    return () => {
      cancelled = true
    }
  }, [liveServerUrl, viewerSlideId])

  // Shared by all three setters below - sends only the one field that
  // changed (the server leaves everything else exactly as it was), and only
  // ever applies the response it gets back, never the value it optimistically
  // hoped for. A failed request leaves every displayed value exactly where
  // it was before the attempt.
  //
  // Wrapped in useCallback (as are the five action functions built from it)
  // so MapNode's own effects - which list setRegion/stopDrawingWorkingArea
  // as dependencies to call them from a Draw interaction's drawend handler -
  // don't see a new function identity, and so tear down and rebuild that
  // interaction, on every unrelated re-render of this provider (e.g. a
  // toggle's own pendingAction flipping while a working-area drag is still
  // in progress would otherwise silently cancel it).
  const sendPatch = useCallback(
    (action: Exclude<PendingAction, null>, patch: Partial<BotControlState>) => {
      setPendingAction(action)
      fetch(`${liveServerUrl}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status))
          return response.json()
        })
        .then((data) => {
          const parsed = parseControlState(data)
          if (!parsed) throw new Error('malformed control state')
          setAnnotationsEnabledState(parsed.annotationsEnabled)
          setCellCountEnabledState(parsed.cellCountEnabled)
          setRegionState(parsed.region)
          setBotSlideIdState(parsed.slideId)
          setLastActionError(null)
        })
        .catch(() => {
          setLastActionError("Couldn't reach the bot control service - change not saved.")
        })
        .finally(() => {
          setPendingAction((current) => (current === action ? null : current))
        })
    },
    [liveServerUrl]
  )

  const setAnnotationsEnabled = useCallback(
    (enabled: boolean) => sendPatch('annotations', { annotationsEnabled: enabled }),
    [sendPatch]
  )
  const setCellCountEnabled = useCallback(
    (enabled: boolean) => sendPatch('cellCount', { cellCountEnabled: enabled }),
    [sendPatch]
  )
  const setRegion = useCallback(
    (nextRegion: BotRegion | null) => sendPatch('region', { region: nextRegion }),
    [sendPatch]
  )

  const startDrawingWorkingArea = useCallback(() => setDrawingWorkingArea(true), [])
  const stopDrawingWorkingArea = useCallback(() => setDrawingWorkingArea(false), [])
  const retryLoad = useCallback(() => setReloadKey((key) => key + 1), [])

  return (
    <BotControlContext.Provider
      value={{
        status,
        annotationsEnabled,
        cellCountEnabled,
        region,
        pendingAction,
        lastActionError,
        drawingWorkingArea,
        botSlideId,
        setAnnotationsEnabled,
        setCellCountEnabled,
        setRegion,
        startDrawingWorkingArea,
        stopDrawingWorkingArea,
        retryLoad,
      }}
    >
      {children}
    </BotControlContext.Provider>
  )
}

function useBotControlContext(): BotControlContextValue {
  const context = useContext(BotControlContext)
  if (!context) {
    throw new Error('useBotControlContext must be used within a BotControlContextProvider')
  }
  return context
}

export { BotControlContextProvider, useBotControlContext }
