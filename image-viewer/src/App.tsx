import { createRef, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
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
import { CollectionContextProvider } from './context/CollectionContext'
import { AnnotationStoreContextProvider } from './context/AnnotationStoreContext'
import { CellCountStoreContextProvider } from './context/CellCountStoreContext'
import { CellCountDrawContextProvider } from './context/CellCountDrawContext'
import { DrawContextProvider } from './context/DrawContext'
import { RotationContextProvider } from './context/RotationContext'
import { RulerContextProvider } from './context/RulerContext'
import { AdjustmentsContextProvider } from './context/AdjustmentsContext'
import { ToastContextProvider } from './context/ToastContext'
import { EventContextProvider } from './context/EventContext'
import MapNode from './components/MapNode'
import AnnotationsPanel from './components/annotation/AnnotationsPanel'
import CellCountPanel from './components/cell-count/CellCountPanel'
import RotationPanel from './components/rotation/RotationPanel'
import RulerPanel from './components/ruler/RulerPanel'
import AdjustmentsPanel from './components/adjustments/AdjustmentsPanel'
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
import ToastStack from './components/toast/ToastStack'
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
  options?: AppOptions
  on?: (event: string, payload: unknown) => void
}

function App({ source, tilerServiceUrl, annotationStoreUrl, options, on }: AppProps) {
  const imageSource: ImageSource = { tilerUrl: tilerServiceUrl, slideId: source }

  return (
    <ToastContextProvider>
      <EventContextProvider on={on}>
        <ImageViewerContextProvider source={imageSource}>
          <CollectionContextProvider baseUrl={annotationStoreUrl}>
            <AnnotationStoreContextProvider baseUrl={annotationStoreUrl}>
              <CellCountStoreContextProvider baseUrl={annotationStoreUrl}>
                <CellCountDrawContextProvider>
                  <DrawContextProvider>
                    <RotationContextProvider>
                      <RulerContextProvider>
                        <AdjustmentsContextProvider baseUrl={annotationStoreUrl}>
                          <ToolbarContextProvider>
                            <ViewerShell fontSize={options?.fontSize} tools={options?.tools} />
                          </ToolbarContextProvider>
                        </AdjustmentsContextProvider>
                      </RulerContextProvider>
                    </RotationContextProvider>
                  </DrawContextProvider>
                </CellCountDrawContextProvider>
              </CellCountStoreContextProvider>
            </AnnotationStoreContextProvider>
          </CollectionContextProvider>
        </ImageViewerContextProvider>
      </EventContextProvider>
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

const INITIAL_POSITIONS: Record<string, Position> = {
  'annotations-panel': { x: 256, y: 32 },
  'cellcount-panel': { x: 256, y: 290 },
  'rotation-panel': { x: 256, y: 520 },
  'ruler-panel': { x: 256, y: 750 },
  'adjustments-panel': { x: 256, y: 980 },
}

interface ViewerShellProps {
  fontSize?: string
  tools?: ToolName[]
}

function ViewerShell({ fontSize, tools }: ViewerShellProps) {
  const { activeTools, toggleTool } = useToolbarContext()
  const [positions, setPositions] = useState<Record<string, Position>>(INITIAL_POSITIONS)
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
    setPositions((prev) => ({
      ...prev,
      [id]: { x: prev[id].x + event.delta.x, y: prev[id].y + event.delta.y },
    }))
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
    <div className="app" style={shellStyle}>
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
            x={positions[panel.id].x}
            y={positions[panel.id].y}
            zIndex={PANEL_Z_BASE + stackIndex(focusOrder, panel.id)}
            panelRef={panelRefs[panel.id]}
            onActivate={() => handleActivate(panel.id)}
            onClose={() => toggleTool(panel.tool)}
            dragging={activeDragId === panel.id}
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
                x={positions[panel.id].x}
                y={positions[panel.id].y}
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
      <ToastStack />
    </div>
  )
}

export default App
