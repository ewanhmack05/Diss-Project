import { useDroppable } from '@dnd-kit/core'
import { DOCK_SIDES, dockZoneId, type DockSide } from './dock'
import './DockZone.css'

interface DockZoneProps {
  side: DockSide
}

// A drop target along one edge - only shown while something is actually
// being dragged (dnd-kit's `active`, not specific to this droppable), so it
// doesn't clutter the view the rest of the time. Highlights further while
// the dragged panel is directly over it.
function DockZone({ side }: DockZoneProps) {
  const { setNodeRef, isOver, active } = useDroppable({ id: dockZoneId(side) })

  if (!active) return null

  return (
    <div
      ref={setNodeRef}
      className={`dock-zone dock-zone--${side}${isOver ? ' dock-zone--over' : ''}`}
      aria-hidden="true"
    />
  )
}

// One droppable per edge - rendered together since a panel can dock to any
// of them.
function DockZones() {
  return (
    <>
      {DOCK_SIDES.map((side) => (
        <DockZone key={side} side={side} />
      ))}
    </>
  )
}

export default DockZones
