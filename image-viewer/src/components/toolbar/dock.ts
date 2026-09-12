type DockSide = 'left' | 'right' | 'top' | 'bottom'

const DOCK_SIDES: DockSide[] = ['left', 'right', 'top', 'bottom']

// One droppable id per edge (see DockZone.tsx) - shared with App.tsx's
// handleDragEnd, which maps a drop's `over.id` back to a side this way.
function dockZoneId(side: DockSide): string {
  return `dock-${side}`
}

// Which panel (if any) is docked to each edge, ordered start-to-end - top to
// bottom for left/right, left to right for top/bottom. Rendered inside a
// flex container (see DockEdge.tsx) so one panel alone fills the whole edge
// and two panels split it evenly - the array only needs to track order, not
// size.
type DockAssignments = Record<DockSide, string[]>

function emptyDockAssignments(): DockAssignments {
  return { left: [], right: [], top: [], bottom: [] }
}

function withoutPanel(assignments: DockAssignments, panelId: string): DockAssignments {
  return {
    left: assignments.left.filter((id) => id !== panelId),
    right: assignments.right.filter((id) => id !== panelId),
    top: assignments.top.filter((id) => id !== panelId),
    bottom: assignments.bottom.filter((id) => id !== panelId),
  }
}

// Docks panelId to `side`, at the start (top/left) or end (bottom/right) of
// whatever's already there. Removing it from every side first (rather than
// just its previous one) makes this safe to call from any state, docked or
// not, and idempotent if dropped back where it already was.
function dockPanel(
  assignments: DockAssignments,
  panelId: string,
  side: DockSide,
  insertAtStart: boolean,
): DockAssignments {
  const next = withoutPanel(assignments, panelId)
  next[side] = insertAtStart ? [panelId, ...next[side]] : [...next[side], panelId]
  return next
}

function undockPanel(assignments: DockAssignments, panelId: string): DockAssignments {
  return withoutPanel(assignments, panelId)
}

function sideOfPanel(assignments: DockAssignments, panelId: string): DockSide | null {
  return DOCK_SIDES.find((side) => assignments[side].includes(panelId)) ?? null
}

interface DockRect {
  top: number
  left: number
  width: number
  height: number
}

// Whether a drop lands in the "start" half of a dock zone - top for a
// left/right edge (vertical split), left for a top/bottom edge (horizontal
// split) - purely from the dragged panel's and the zone's rects, so it's
// testable without simulating a real pointer drag.
function resolvesToStart(side: DockSide, activeRect: DockRect, zoneRect: DockRect): boolean {
  if (side === 'left' || side === 'right') {
    const centerY = activeRect.top + activeRect.height / 2
    return centerY < zoneRect.top + zoneRect.height / 2
  }
  const centerX = activeRect.left + activeRect.width / 2
  return centerX < zoneRect.left + zoneRect.width / 2
}

// The exact rect the dragged panel will occupy if dropped right now - the
// whole docked-panel-sized edge if it's empty (or only holds the panel
// being dragged), or the half `resolvesToStart` picks out if something else
// is already docked there. Drives the live drop preview (see
// DockPreview.tsx) so what's shown while dragging matches what dockPanel
// will actually produce on drop.
//
// `zoneRect` (the thin hit-test strip along the edge - see DockZone.css) is
// only used to decide which half a drop resolves to; the preview itself is
// sized and positioned from `edgeRect`, the real docked panel's rect (see
// App.tsx's edge probes) - a hit-test strip and a 20em-wide docked panel
// are deliberately different sizes, and the preview should look like the
// panel, not the strip.
function computePreviewRect(
  side: DockSide,
  activeRect: DockRect,
  zoneRect: DockRect,
  edgeRect: DockRect,
  hasOccupant: boolean,
): DockRect {
  if (!hasOccupant) return edgeRect

  const insertAtStart = resolvesToStart(side, activeRect, zoneRect)
  if (side === 'left' || side === 'right') {
    const height = edgeRect.height / 2
    return {
      left: edgeRect.left,
      width: edgeRect.width,
      height,
      top: insertAtStart ? edgeRect.top : edgeRect.top + height,
    }
  }
  const width = edgeRect.width / 2
  return {
    top: edgeRect.top,
    height: edgeRect.height,
    width,
    left: insertAtStart ? edgeRect.left : edgeRect.left + width,
  }
}

export {
  DOCK_SIDES,
  dockZoneId,
  emptyDockAssignments,
  dockPanel,
  undockPanel,
  sideOfPanel,
  resolvesToStart,
  computePreviewRect,
}
export type { DockSide, DockAssignments, DockRect }
