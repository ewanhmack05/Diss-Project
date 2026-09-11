import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import type { DockSide } from './dock'
import './DraggablePanel.css'

interface DraggablePanelProps {
  id: string
  title: string
  x: number
  y: number
  dockedSide?: DockSide | null
  // Lets the caller measure the panel's real on-screen position directly
  // (see App.tsx's handleDragStart) rather than trusting dnd-kit's own
  // cached rect for it, which doesn't get remeasured just because our own
  // CSS repositioned the node (e.g. by docking it).
  panelRef?: RefObject<HTMLDivElement | null>
  onClose: () => void
  children: ReactNode
}

function DraggablePanel({
  id,
  title,
  x,
  y,
  dockedSide = null,
  panelRef,
  onClose,
  children,
}: DraggablePanelProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id })

  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node)
    if (panelRef) panelRef.current = node
  }

  // Docked position comes from CSS (see .draggable-panel--docked-*), not x/y
  // - but the drag transform still applies on top of it, so grabbing the
  // header and pulling away from the dock tracks the cursor immediately
  // rather than waiting for the drop to take effect.
  const style: CSSProperties = {
    left: dockedSide ? undefined : x,
    top: dockedSide ? undefined : y,
    transform: transform ? CSS.Translate.toString(transform) : undefined,
  }

  const dockedClasses = dockedSide
    ? ` draggable-panel--docked draggable-panel--docked-${dockedSide}`
    : ''

  return (
    <div ref={setRefs} className={`draggable-panel${dockedClasses}`} style={style}>
      <div className="draggable-panel-header">
        <div className="draggable-panel-handle" {...listeners} {...attributes}>
          <span className="draggable-panel-title">{title}</span>
        </div>
        <button
          type="button"
          className="draggable-panel-close"
          onClick={onClose}
          aria-label={`Close ${title}`}
        >
          ×
        </button>
      </div>
      <div className="draggable-panel-body">{children}</div>
    </div>
  )
}

export default DraggablePanel
