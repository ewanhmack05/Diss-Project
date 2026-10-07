import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRealtimeContext } from './RealtimeContext'
import { useToolbarContext, TOOL_NAMES, type ToolId } from './ToolbarContext'
import { useToastContext } from './ToastContext'
import { useAdjustmentsContext } from './AdjustmentsContext'
import { useDrawContext } from './DrawContext'
import { useCellCountDrawContext } from './CellCountDrawContext'
import { useAnnotationStoreContext } from './AnnotationStoreContext'
import { useCellCountStoreContext } from './CellCountStoreContext'
import {
  leaderOf,
  panelChanges,
  tabChanges,
  type NavigationMode,
  type Participant,
  type Screen,
  type Viewport,
} from '../components/realtime/realtime'
import { sameAdjustments, type ImageAdjustmentValues } from '../components/adjustments/adjustments'

interface NavigationContextValue {
  mode: NavigationMode
  // Who to follow - null when you're the host, or they're not here.
  leader: Participant | null
  // Whether your view is on the host's right now. In Follow you can move
  // away (see breakAway), in Present you can't.
  following: boolean
  // The host's screen while they present - null otherwise.
  hostScreen: Screen | null
  // You moved the map yourself. Only does anything in Follow.
  breakAway: () => void
  followAgain: () => void
  // Where the host asked you to look, once you said yes. The map goes there
  // once for each new one (see MapNode).
  lookAt: { viewport: Viewport; id: number } | null
}

const NavigationContext = createContext<NavigationContextValue | null>(null)

// Follow me and Present (see RealTimePanel). The map does the moving (see
// MapNode) - this works out whether to. While following, either way, you
// get the host's image adjustments too. Present copies the rest of their
// screen as well: panels and the tab each is on.
function NavigationContextProvider({ children }: { children: ReactNode }) {
  const { me, others, navigation: mode, sendScreen, onRequest } = useRealtimeContext()
  const { addToast } = useToastContext()
  const [lookAt, setLookAt] = useState<{ viewport: Viewport; id: number } | null>(null)
  const { activeTools, openTool, closeTool, panelTabs, setPanelTab } = useToolbarContext()
  const { values: adjustments, setValues: setAdjustments } = useAdjustmentsContext()
  const { pending: drawing } = useDrawContext()
  const { pending: counting } = useCellCountDrawContext()
  const { selectedAnnotationId, setSelectedAnnotationId } = useAnnotationStoreContext()
  const { selectedCellCountId, viewedCellCountId, setSelectedCellCountId, setViewedCellCountId } =
    useCellCountStoreContext()
  const [brokeAway, setBrokeAway] = useState(false)
  // A new mode starts everyone on the host again.
  const [modeBefore, setModeBefore] = useState(mode)
  if (mode !== modeBefore) {
    setModeBefore(mode)
    setBrokeAway(false)
  }

  const leader = me?.host ? null : leaderOf(others)
  const following = mode !== 'free' && !!leader && (mode === 'present' || !brokeAway)

  // Everyone says what's on their screen - it only goes when it changes.
  useEffect(() => {
    sendScreen({
      panels: activeTools,
      tabs: panelTabs,
      adjustments,
      viewedCellCountId,
      editingAnnotationId: selectedAnnotationId,
      editingCellCountId: selectedCellCountId,
    })
  }, [activeTools, panelTabs, adjustments, viewedCellCountId, selectedAnnotationId, selectedCellCountId, sendScreen])

  // In Present, open and close what the host does. Only changes are copied,
  // so you can still open something else yourself in between.
  // Present ending, or the host going, leaves everything as it is.
  const presenting = mode === 'present' && !!leader
  const hostScreen = presenting ? (leader?.screen ?? null) : null
  const hostPanelsKey = (hostScreen?.panels ?? []).join(',')
  const lastHostPanelsRef = useRef<string[]>([])
  useEffect(() => {
    if (!presenting) {
      lastHostPanelsRef.current = []
      return
    }
    const now = hostPanelsKey ? hostPanelsKey.split(',') : []
    const { open, close } = panelChanges(lastHostPanelsRef.current, now)
    lastHostPanelsRef.current = now
    open.forEach((panel) => openTool(panel as ToolId))
    close.forEach((panel) => closeTool(panel as ToolId))
  }, [presenting, hostPanelsKey, openTool, closeTool])

  // Same for the tab inside each panel. Left alone while you're part way
  // through drawing or counting there, so that isn't thrown away - it
  // catches up once you're done. Leaving Saved drops what was open in it,
  // same as clicking the tab does.
  const hostTabsKey = JSON.stringify(hostScreen?.tabs ?? {})
  const lastHostTabsRef = useRef<Record<string, string>>({})
  useEffect(() => {
    if (!presenting) {
      lastHostTabsRef.current = {}
      return
    }
    const now = JSON.parse(hostTabsKey) as Record<string, string>
    const busy: Partial<Record<string, boolean>> = { annotations: !!drawing, cellcount: !!counting }
    const last = lastHostTabsRef.current
    const changes = tabChanges(last, now).filter(([panel]) => !busy[panel])
    changes.forEach(([panel, tab]) => {
      if (panel === 'annotations' && tab !== 'saved') setSelectedAnnotationId(null)
      if (panel === 'cellcount' && tab !== 'saved') {
        setSelectedCellCountId(null)
        setViewedCellCountId(null)
      }
      setPanelTab(panel as ToolId, tab)
    })
    // Remember the host's tabs as they are now - one they've closed has gone
    // from the list - apart from any held back above, so those still count
    // as changes later.
    const next = { ...now }
    for (const panel of Object.keys(busy)) {
      if (!busy[panel]) continue
      if (panel in last) next[panel] = last[panel]
      else delete next[panel]
    }
    lastHostTabsRef.current = next
  }, [presenting, hostTabsKey, drawing, counting, setPanelTab, setSelectedAnnotationId, setSelectedCellCountId, setViewedCellCountId])

  // A saved count the host shows on the map shows on yours. Only changes,
  // like the panels.
  const hostViewedCount = hostScreen?.viewedCellCountId ?? null
  const lastHostViewedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!presenting) {
      lastHostViewedRef.current = null
      return
    }
    if (hostViewedCount === lastHostViewedRef.current) return
    lastHostViewedRef.current = hostViewedCount
    setViewedCellCountId(hostViewedCount)
  }, [presenting, hostViewedCount, setViewedCellCountId])

  // And the host's image adjustments, like their rotation - while you're
  // following them, in Follow me or Present. Yours come back once you stop.
  const hostAdjustments = following ? (leader?.screen?.adjustments ?? null) : null
  const hostAdjustmentsKey = hostAdjustments ? JSON.stringify(hostAdjustments) : ''
  // What you had before following, and what was last put on from the host.
  const ownAdjustmentsRef = useRef<ImageAdjustmentValues | null>(null)
  const appliedAdjustmentsRef = useRef<ImageAdjustmentValues | null>(null)
  const adjustmentsRef = useRef(adjustments)
  useEffect(() => {
    adjustmentsRef.current = adjustments
  })
  useEffect(() => {
    if (!hostAdjustmentsKey) return
    const host = JSON.parse(hostAdjustmentsKey) as ImageAdjustmentValues
    if (!ownAdjustmentsRef.current) ownAdjustmentsRef.current = adjustmentsRef.current
    appliedAdjustmentsRef.current = host
    setAdjustments(host)
  }, [hostAdjustmentsKey, setAdjustments])
  useEffect(() => {
    if (following) return
    appliedAdjustmentsRef.current = null
    if (!ownAdjustmentsRef.current) return
    setAdjustments(ownAdjustmentsRef.current)
    ownAdjustmentsRef.current = null
  }, [following, setAdjustments])
  // Moving a slider yourself in Follow me is moving away, like panning - and
  // you keep what you just set rather than going back to your own. In
  // Present the host's next change just puts theirs back.
  useEffect(() => {
    const applied = appliedAdjustmentsRef.current
    if (!applied || mode !== 'follow' || sameAdjustments(adjustments, applied)) return
    ownAdjustmentsRef.current = null
    appliedAdjustmentsRef.current = null
    setBrokeAway(true)
  }, [adjustments, mode])

  // The host asking you to look somewhere or open a panel - a toast you can
  // say yes or no to. Nobody's asked to look while they're following, since
  // they're already there.
  const followingRef = useRef(following)
  useEffect(() => {
    followingRef.current = following
  })
  useEffect(
    () =>
      onRequest((request) => {
        if (request.kind === 'look') {
          if (followingRef.current) return
          addToast(`${request.fromName} wants you to look at something`, 'info', {
            actions: [
              { label: 'Go', primary: true, onClick: () => setLookAt((current) => ({ viewport: request.data, id: (current?.id ?? 0) + 1 })) },
              { label: 'Not now' },
            ],
          })
        } else if (request.kind === 'adjustments') {
          // Following already gets you theirs.
          if (followingRef.current) return
          const offered = request.data
          addToast(`${request.fromName} wants to share their image settings`, 'info', {
            actions: [{ label: 'Apply', primary: true, onClick: () => setAdjustments(offered) }, { label: 'Not now' }],
          })
        } else if (request.kind === 'openPanel') {
          const panel = request.data.panel as ToolId
          const name = TOOL_NAMES[panel]
          if (!name) return
          addToast(`${request.fromName} asks you to open ${name}`, 'info', {
            actions: [{ label: 'Open', primary: true, onClick: () => openTool(panel) }, { label: 'Not now' }],
          })
        }
      }),
    [onRequest, addToast, openTool, setAdjustments]
  )

  const breakAway = useCallback(() => {
    if (mode === 'follow') setBrokeAway(true)
  }, [mode])

  const followAgain = useCallback(() => setBrokeAway(false), [])

  return (
    <NavigationContext.Provider value={{ mode, leader, following, hostScreen, breakAway, followAgain, lookAt }}>
      {children}
    </NavigationContext.Provider>
  )
}

function useNavigationContext(): NavigationContextValue {
  const context = useContext(NavigationContext)
  if (!context) {
    throw new Error('useNavigationContext must be used within a NavigationContextProvider')
  }
  return context
}

export { NavigationContextProvider, useNavigationContext }
