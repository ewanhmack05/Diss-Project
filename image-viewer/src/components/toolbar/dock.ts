type DockSide = 'left' | 'right' | 'top' | 'bottom'

const DOCK_SIDES: DockSide[] = ['left', 'right', 'top', 'bottom']

// One droppable id per edge (see DockZone.tsx) - shared with App.tsx's
// handleDragEnd, which maps a drop's `over.id` back to a side this way.
function dockZoneId(side: DockSide): string {
  return `dock-${side}`
}

export { DOCK_SIDES, dockZoneId }
export type { DockSide }
