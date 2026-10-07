import { createRef, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import 'ol/ol.css'
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'
import { ImageViewerContextProvider } from './context/ImageViewerContext'
import { ToolbarContextProvider, useToolbarContext, type ToolId } from './context/ToolbarContext'
import { NavigationContextProvider } from './context/NavigationContext'
import { CollectionContextProvider } from './context/CollectionContext'
import { RealtimeContextProvider } from './context/RealtimeContext'
import { AnnotationStoreContextProvider } from './context/AnnotationStoreContext'
import { CellCountStoreContextProvider } from './context/CellCountStoreContext'
import { CellCountDrawContextProvider } from './context/CellCountDrawContext'
import { DrawContextProvider } from './context/DrawContext'
import { RotationContextProvider } from './context/RotationContext'
import { RulerContextProvider } from './context/RulerContext'
import { AdjustmentsContextProvider } from './context/AdjustmentsContext'
import { ToastContextProvider } from './context/ToastContext'
import { DialogContextProvider } from './context/DialogContext'
import { ComparisonContextProvider } from './context/ComparisonContext'
import { SharedCountContextProvider } from './context/SharedCountContext'
import { EventContextProvider } from './context/EventContext'
import { AuthContextProvider, type AuthOptions } from './context/AuthContext'
import MapNode from './components/MapNode'
import AnnotationsPanel from './components/annotation/AnnotationsPanel'
import CellCountPanel from './components/cell-count/CellCountPanel'
import RotationPanel from './components/rotation/RotationPanel'
import RulerPanel from './components/ruler/RulerPanel'
import AdjustmentsPanel from './components/adjustments/AdjustmentsPanel'
import RealTimePanel from './components/realtime/RealTimePanel'
import InviteGate from './components/realtime/InviteGate'
import Toolbar, { type ToolName } from './components/toolbar/Toolbar'
import DraggablePanel from './components/toolbar/DraggablePanel'
import DockZones from './components/toolbar/DockZone'
import DockEdge from './components/toolbar/DockEdge'
import DockPreview from './components/toolbar/DockPreview'
import {
  DOCK_SIDES,
  dockZoneId,
  emptyDockAssignments,
  dockPanel,
  undockPanel,
  sideOfPanel,
  resolvesToStart,
  computePreviewRect,
  type DockAssignments,
  type DockRect,
  type DockSide,
} from './components/toolbar/dock'
import { bringToFront, stackIndex } from './components/toolbar/focusOrder'
import { clampToBounds, placeInColumns, type Bounds, type Rect } from './components/toolbar/panelPlacement'
import ToastStack from './components/toast/ToastStack'
import DialogHost from './components/dialog/DialogHost'
import PresenceList from './components/presence/PresenceList'
import type { ImageSource } from './interfaces/ImageSource'
import './App.css'

// Fixed height of a top/bottom DockEdge (see DockEdge.css) - used to inset
// the left/right edges when top or bottom is occupied, so they stop where
// that panel starts instead of running underneath it. Must match
// DockEdge.css's .dock-edge--top/--bottom height.
const EDGE_CROSS_SIZE = '21em'

// A floating panel's fixed width (see DraggablePanel.css's .draggable-panel)
// - used to work out where to place a panel the instant it's pulled off a
// dock (see handleDragStart), since undocking can shrink its width a lot
// (a top/bottom dock spans the full viewport) before it settles into this.
const FLOATING_PANEL_WIDTH_EM = 20

// event.activatorEvent is typed as a plain Event, but dnd-kit's actual
// sensors (Pointer/Mouse/Touch) always fire from ones that carry
// clientX/clientY - this narrows without assuming a specific class, so it
// still works whichever sensor triggered the drag.
function clientPointOf(event: Event): { x: number; y: number } | null {
  if ('clientX' in event && 'clientY' in event) {
    const pointerish = event as MouseEvent
    return { x: pointerish.clientX, y: pointerish.clientY }
  }
  return null
}

// Floor for a panel's/edge's z-index - see focusOrder.ts's stackIndex,
// added on top of this so the most recently clicked one renders in front.
const PANEL_Z_BASE = 15

// The stacking unit a docked edge counts as - clicking either half of a
// split edge should bring the whole edge forward together, not just the
// one panel that happened to be clicked (see DockEdge's onActivate).
function dockEdgeStackKey(side: DockSide): string {
  return `dock-${side}`
}

interface AppOptions {
  fontSize?: string
  tools?: ToolName[]
}

interface AppProps {
  source: string
  tilerServiceUrl: string
  annotationStoreUrl: string
  // Optional - without it the viewer works on its own, just not live.
  realtimeHubUrl?: string
  // Keycloak - everything needs a signed-in user (see AuthContext).
  auth: AuthOptions
  options?: AppOptions
  on?: (event: string, payload: unknown) => void
}

function App({ source, tilerServiceUrl, annotationStoreUrl, realtimeHubUrl, auth, options, on }: AppProps) {
  const imageSource: ImageSource = { tilerUrl: tilerServiceUrl, slideId: source }

  return (
    <ToastContextProvider>
      <DialogContextProvider>
      <EventContextProvider on={on}>
        <AuthContextProvider auth={auth}>
        <ImageViewerContextProvider source={imageSource}>
          {/* Collections decide which session you're in, and so which
              realtime room - working alone there's no room at all. An
              invite link is dealt with before the viewer opens. */}
          <CollectionContextProvider baseUrl={annotationStoreUrl}>
            <InviteGate>
            <RealtimeContextProvider hubUrl={realtimeHubUrl}>
              <AnnotationStoreContextProvider baseUrl={annotationStoreUrl}>
                <CellCountStoreContextProvider baseUrl={annotationStoreUrl}>
                  <CellCountDrawContextProvider>
                    <DrawContextProvider>
                      <RotationContextProvider>
                        <RulerContextProvider>
                          <AdjustmentsContextProvider baseUrl={annotationStoreUrl}>
                            <ToolbarContextProvider>
                              <NavigationContextProvider>
                              <ComparisonContextProvider>
                                <SharedCountContextProvider>
                                  <ViewerShell fontSize={options?.fontSize} tools={options?.tools} />
                                </SharedCountContextProvider>
                              </ComparisonContextProvider>
                              </NavigationContextProvider>
                            </ToolbarContextProvider>
                          </AdjustmentsContextProvider>
                        </RulerContextProvider>
                      </RotationContextProvider>
                    </DrawContextProvider>
                  </CellCountDrawContextProvider>
                </CellCountStoreContextProvider>
              </AnnotationStoreContextProvider>
            </RealtimeContextProvider>
            </InviteGate>
          </CollectionContextProvider>
        </ImageViewerContextProvider>
        </AuthContextProvider>
      </EventContextProvider>
      </DialogContextProvider>
    </ToastContextProvider>
  )
}

interface Position {
  x: number
  y: number
}

interface PanelDef {
  id: string
  title: string
  tool: ToolId
  content: ReactNode
}

// Where the first floating panel opens - the rest flow down and across
// from here (see panelPlacement.ts's placeInColumns).
const PANEL_ORIGIN: Position = { x: 256, y: 32 }

// Minimum space kept between a floating panel and the screen edges/toolbar.
const PANEL_MARGIN = 8

function samePositions(a: Record<string, Position>, b: Record<string, Position>): boolean {
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => b[key] && a[key].x === b[key].x && a[key].y === b[key].y)
  )
}

interface ViewerShellProps {
  fontSize?: string
  tools?: ToolName[]
}

function ViewerShell({ fontSize, tools }: ViewerShellProps) {
  const { activeTools, toggleTool } = useToolbarContext()
  const [positions, setPositions] = useState<Record<string, Position>>({})
  const [dockAssignments, setDockAssignments] = useState<DockAssignments>(emptyDockAssignments)
  const [previewRect, setPreviewRect] = useState<DockRect | null>(null)
  const [focusOrder, setFocusOrder] = useState<string[]>([])
  const handleActivate = (key: string) => setFocusOrder((prev) => bringToFront(prev, key))
  const panelRefs = useRef<Record<string, RefObject<HTMLDivElement | null>>>({
    'annotations-panel': createRef<HTMLDivElement>(),
    'cellcount-panel': createRef<HTMLDivElement>(),
    'rotation-panel': createRef<HTMLDivElement>(),
    'ruler-panel': createRef<HTMLDivElement>(),
    'adjustments-panel': createRef<HTMLDivElement>(),
    'realtime': createRef<HTMLDivElement>(),
  }).current
  // One hidden, always-mounted probe per edge, sized/positioned exactly
  // like a real DockEdge (see .dock-edge--probe in DockEdge.css) purely so
  // its rect can be measured - gives the drop preview the docked panel's
  // real size instead of DockZone's thin hit-test strip.
  const edgeProbeRefs = useRef<Record<DockSide, RefObject<HTMLDivElement | null>>>({
    left: createRef<HTMLDivElement>(),
    right: createRef<HTMLDivElement>(),
    top: createRef<HTMLDivElement>(),
    bottom: createRef<HTMLDivElement>(),
  }).current
  const panelDefs: PanelDef[] = [
    { id: 'annotations-panel', title: 'Annotations', tool: 'annotations', content: <AnnotationsPanel /> },
    { id: 'cellcount-panel', title: 'Cell Count', tool: 'cellcount', content: <CellCountPanel /> },
    { id: 'rotation-panel', title: 'Rotate', tool: 'rotate', content: <RotationPanel /> },
    { id: 'ruler-panel', title: 'Ruler', tool: 'ruler', content: <RulerPanel /> },
    { id: 'adjustments-panel', title: 'Adjustments', tool: 'adjustments', content: <AdjustmentsPanel /> },
    { id: 'realtime', title: 'RealTime', tool: 'realtime', content: <RealTimePanel /> },
  ]

  // Only set while dragging a panel that started out docked - see
  // DragOverlay below for why: dnd-kit compensates for any change in the
  // *dragged* node's own measured rect since the drag began (a feature for
  // e.g. sortable lists reflowing mid-drag), and undocking is exactly that
  // - a docked panel's width can shrink drastically the instant it
  // floats (a top/bottom dock spans the full viewport; the floating width
  // is a fixed 20em). Without an overlay, that compensation silently
  // cancels out any position we set, stranding the panel wherever it was
  // docked - which also feeds collision detection, so it could even
  // redock somewhere you never dragged it near. A plain floating-panel
  // drag never resizes mid-drag, so it's unaffected either way.
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  // A constant (per-drag) pixel correction applied to the ghost - see
  // handleDragStart for the derivation. dnd-kit's DragOverlay always starts
  // its own wrapper at the *original* node's measured corner (here, the
  // docked panel's, e.g. x=0 for a top/bottom dock) plus raw pointer delta,
  // with no way to tell it to start somewhere else - so the ghost needs its
  // own offset on top to actually track wherever we intend the panel to
  // land, computed once at drag-start since the cursor-dependent part of
  // that gap cancels out algebraically (it's the same "+ raw pointer delta"
  // on both sides), leaving only this fixed remainder.
  const [ghostOffsetX, setGhostOffsetX] = useState(0)

  // Picking up a docked panel undocks it immediately, computing where it
  // should land once dropped - not just on drop - so a plain floating drag
  // (activeDragId unset, no overlay - see above) tracks the cursor
  // immediately rather than waiting for the drop to take effect. Measured
  // straight off the DOM rather than dnd-kit's own cached rect for this
  // draggable: that cache isn't refreshed just because our own CSS moved
  // the node (e.g. by docking it), so after a dock it kept reporting the
  // pre-dock floating position.
  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id)
    const side = sideOfPanel(dockAssignments, id)
    if (!side) return
    setActiveDragId(id)
    const node = panelRefs[id]?.current
    const rect = node?.getBoundingClientRect()
    const pointer = clientPointOf(event.activatorEvent)
    if (rect && node && pointer) {
      // A docked panel's width can be wildly different from its floating
      // width (a top/bottom dock spans the full viewport; left/right
      // already matches floating) - reusing the old rect's corner as-is
      // would strand the panel far from the cursor unless you happened to
      // grab it right at its edge. Preserving *where within the panel* you
      // grabbed it, as a fraction of its width, keeps it under the cursor
      // regardless of how much the width just changed - a no-op for
      // left/right docks, whose width already equals the floating one.
      const floatingWidth = FLOATING_PANEL_WIDTH_EM * parseFloat(getComputedStyle(node).fontSize)
      const grabFraction = (pointer.x - rect.left) / rect.width
      const targetX = pointer.x - grabFraction * floatingWidth
      setPositions((prev) => ({ ...prev, [id]: { x: targetX, y: rect.top } }))
      // dnd-kit's ghost wrapper starts at rect.left (+ raw pointer delta,
      // which cancels out against ours below); this constant shifts it the
      // rest of the way to targetX instead.
      setGhostOffsetX(targetX - rect.left)
    } else if (rect) {
      setPositions((prev) => ({ ...prev, [id]: { x: rect.left, y: rect.top } }))
      setGhostOffsetX(0)
    }
    setDockAssignments((prev) => undockPanel(prev, id))
  }

  // Resolves an in-progress or finishing drag down to "which zone is it
  // over, and what are its and that zone's current rects" - shared by the
  // live preview (onDragMove) and the actual drop (onDragEnd) so they agree
  // on exactly the same geometry.
  function resolveDropTarget(event: DragMoveEvent | DragEndEvent) {
    const side = DOCK_SIDES.find((s) => dockZoneId(s) === event.over?.id)
    const activeRect = event.active.rect.current.translated
    const zoneRect = event.over?.rect
    if (!side || !activeRect || !zoneRect) return null
    return { side, activeRect, zoneRect }
  }

  // Updates the live drop preview as the panel moves - see DockPreview.tsx.
  const handleDragMove = (event: DragMoveEvent) => {
    const target = resolveDropTarget(event)
    const edgeRect = target ? edgeProbeRefs[target.side].current?.getBoundingClientRect() : null
    if (!target || !edgeRect) {
      setPreviewRect(null)
      return
    }
    const id = String(event.active.id)
    const hasOccupant = dockAssignments[target.side].some((panelId) => panelId !== id)
    setPreviewRect(computePreviewRect(target.side, target.activeRect, target.zoneRect, edgeRect, hasOccupant))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setPreviewRect(null)
    setActiveDragId(null)
    const id = String(event.active.id)
    const target = resolveDropTarget(event)
    if (target) {
      // Which half of the zone the panel was dropped in decides where it
      // lands relative to whatever's already docked to that edge - e.g.
      // dropping near the top of the left edge's zone puts this panel above
      // an existing one there, splitting the edge instead of replacing it.
      const insertAtStart = resolvesToStart(target.side, target.activeRect, target.zoneRect)
      setDockAssignments((prev) => dockPanel(prev, id, target.side, insertAtStart))
      return
    }
    setPositions((prev) => {
      const current = prev[id]
      if (!current) return prev
      return { ...prev, [id]: { x: current.x + event.delta.x, y: current.y + event.delta.y } }
    })
  }

  const handleDragCancel = () => {
    setPreviewRect(null)
    setActiveDragId(null)
  }

  const activePanelDefs = panelDefs.filter((panel) => activeTools.includes(panel.tool))
  const floatingPanelDefs = activePanelDefs.filter((panel) => !sideOfPanel(dockAssignments, panel.id))
  const dockedGroups = DOCK_SIDES.map((side) => ({
    side,
    panels: dockAssignments[side]
      .map((id) => activePanelDefs.find((panel) => panel.id === id))
      .filter((panel): panel is PanelDef => Boolean(panel)),
  })).filter((group) => group.panels.length > 0)

  // Floating panels only get a position once they've been measured - the
  // first render of a newly opened one is hidden at PANEL_ORIGIN, then this
  // places it before the browser paints. Runs after every render and only
  // sets state when something moved, so it also covers drops and panels
  // coming off a dock.
  const appRef = useRef<HTMLDivElement>(null)
  const floatingKey = floatingPanelDefs.map((panel) => panel.id).join(',')

  // The viewport minus a margin, and minus the toolbar so a panel never ends
  // up underneath it.
  const panelBounds = (): Bounds => {
    const toolbar = appRef.current?.querySelector('.toolbar')
    const bottom = toolbar ? toolbar.getBoundingClientRect().top : window.innerHeight
    return {
      left: PANEL_MARGIN,
      top: PANEL_MARGIN,
      right: window.innerWidth - PANEL_MARGIN,
      bottom: bottom - PANEL_MARGIN,
    }
  }

  // Clamps panels that already have a spot back on screen and places new
  // ones into the columns around them. Closed panels keep their spot, so
  // reopening one puts it back where it was. The panel mid-drag is left
  // alone - its drop position is already worked out (see handleDragStart).
  const fitPanels = () => {
    const bounds = panelBounds()
    const next: Record<string, Position> = { ...positions }
    // Plain object rather than the DOMRect itself - DOMRect's fields are
    // getters, so spreading one (as placeInColumns does) copies nothing.
    const sizeOf = (id: string) => {
      const rect = panelRefs[id]?.current?.getBoundingClientRect()
      return rect ? { width: rect.width, height: rect.height } : null
    }
    const occupied: Rect[] = []
    const unplaced: string[] = []
    for (const { id } of floatingPanelDefs) {
      const size = sizeOf(id)
      if (!size) continue
      if (!next[id]) {
        unplaced.push(id)
        continue
      }
      if (id !== activeDragId) next[id] = clampToBounds(next[id], size, bounds)
      occupied.push({ ...next[id], width: size.width, height: size.height })
    }
    for (const id of unplaced) {
      const size = sizeOf(id)
      if (!size) continue
      next[id] = placeInColumns(size, occupied, bounds, PANEL_ORIGIN)
      occupied.push({ ...next[id], width: size.width, height: size.height })
    }
    if (!samePositions(positions, next)) setPositions(next)
  }

  const fitPanelsRef = useRef(fitPanels)
  useLayoutEffect(() => {
    fitPanelsRef.current = fitPanels
    fitPanels()
  })

  // Re-fit when the window shrinks, or when a panel grows (e.g. a saved
  // list loading in) enough to push it off the bottom.
  useEffect(() => {
    const refit = () => fitPanelsRef.current()
    window.addEventListener('resize', refit)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit)
    for (const id of floatingKey.split(',')) {
      const node = panelRefs[id]?.current
      if (node) observer?.observe(node)
    }
    return () => {
      window.removeEventListener('resize', refit)
      observer?.disconnect()
    }
  }, [floatingKey, panelRefs])

  // Left/right stop short of whichever of top/bottom is currently occupied
  // (see DockZone.css and DockEdge.css) - top/bottom always own the full
  // width, left/right just get whatever vertical space is left over.
  const shellStyle = {
    ...(fontSize ? { fontSize } : undefined),
    '--dock-top-inset': dockAssignments.top.length > 0 ? EDGE_CROSS_SIZE : '0em',
    '--dock-bottom-inset': dockAssignments.bottom.length > 0 ? EDGE_CROSS_SIZE : '0em',
    // Lets the bottom-right scale bar (see MapNode.css's .ol-scalebar) step
    // out of the way of a right-docked panel, the same way the two insets
    // above already do for left/right and top/bottom.
    '--dock-right-inset': dockAssignments.right.length > 0 ? `${FLOATING_PANEL_WIDTH_EM}em` : '0em',
  } as CSSProperties

  return (
    <div ref={appRef} className="app" style={shellStyle}>
      <MapNode />

      <DndContext
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        modifiers={[restrictToWindowEdges]}
      >
        <DockZones />
        {DOCK_SIDES.map((side) => (
          <div
            key={side}
            ref={edgeProbeRefs[side]}
            className={`dock-edge dock-edge--${side} dock-edge--probe`}
            aria-hidden="true"
          />
        ))}
        <DockPreview rect={previewRect} />

        {floatingPanelDefs.map((panel) => (
          <DraggablePanel
            key={panel.id}
            id={panel.id}
            title={panel.title}
            x={positions[panel.id]?.x ?? PANEL_ORIGIN.x}
            y={positions[panel.id]?.y ?? PANEL_ORIGIN.y}
            zIndex={PANEL_Z_BASE + stackIndex(focusOrder, panel.id)}
            panelRef={panelRefs[panel.id]}
            onActivate={() => handleActivate(panel.id)}
            onClose={() => toggleTool(panel.tool)}
            hidden={activeDragId === panel.id || !positions[panel.id]}
          >
            {panel.content}
          </DraggablePanel>
        ))}
        {dockedGroups.map(({ side, panels }) => (
          <DockEdge
            key={side}
            side={side}
            zIndex={PANEL_Z_BASE + stackIndex(focusOrder, dockEdgeStackKey(side))}
            onActivate={() => handleActivate(dockEdgeStackKey(side))}
          >
            {panels.map((panel) => (
              <DraggablePanel
                key={panel.id}
                id={panel.id}
                title={panel.title}
                x={positions[panel.id]?.x ?? PANEL_ORIGIN.x}
                y={positions[panel.id]?.y ?? PANEL_ORIGIN.y}
                dockedSide={side}
                panelRef={panelRefs[panel.id]}
                onClose={() => toggleTool(panel.tool)}
              >
                {panel.content}
              </DraggablePanel>
            ))}
          </DockEdge>
        ))}

        {/* Stands in for the real panel only while dragging one that
            started out docked (see activeDragId above) - the real panel
            stays mounted underneath (hidden) so nothing about its own
            state or dnd-kit's tracking on it is disturbed, and reappears,
            correctly positioned, the instant this disappears on drop. */}
        <DragOverlay dropAnimation={null}>
          {activeDragId && (
            <div
              className="draggable-panel draggable-panel--ghost"
              style={{ transform: `translateX(${ghostOffsetX}px)` }}
            >
              <div className="draggable-panel-header">
                <div className="draggable-panel-handle">
                  <span className="draggable-panel-title">
                    {panelDefs.find((panel) => panel.id === activeDragId)?.title}
                  </span>
                </div>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <Toolbar tools={tools} />
      <PresenceList />
      <ToastStack />
      <DialogHost />
    </div>
  )
}

export default App
