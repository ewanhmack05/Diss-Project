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
  // Per-panel override of the floating width/max-height (see
  // DraggablePanel.css's .draggable-panel/.draggable-panel-body defaults) -
  // undefined for every panel except the ones that opt in (currently just
  // Connectome, see App.tsx), so this changes nothing for the rest. Ignored
  // once docked, same as x/y above - a DockEdge sizes its own children.
  floatingWidthEm?: number
  floatingMaxHeightEm?: number
  // Only meaningful while floating (see App.tsx) - a docked panel is a
  // plain flex child of its DockEdge, which is the thing that actually
  // competes for stacking order against other fixed-position elements.
  zIndex?: number
  // Lets the caller measure the panel's real on-screen position directly
  // (see App.tsx's handleDragStart) rather than trusting dnd-kit's own
  // cached rect for it, which doesn't get remeasured just because our own
  // CSS repositioned the node (e.g. by docking it).
  panelRef?: RefObject<HTMLDivElement | null>
  // Fires on pointerdown anywhere on the panel (header, body, its
  // controls) - like an OS window, pressing down on it at all is enough to
  // bring it to front, not just grabbing the title bar.
  onActivate?: () => void
  // True only while dragging a panel that started out docked - see
  // App.tsx's DragOverlay/activeDragId for why. Keeps this panel fully
  // mounted (its own state, dnd-kit's tracking on it) but invisible, since
  // a ghost stands in for it visually until the drag ends.
  dragging?: boolean
  onClose: () => void
  children: ReactNode
}

function DraggablePanel({
  id,
  title,
  x,
  y,
  dockedSide = null,
  floatingWidthEm,
  floatingMaxHeightEm,
  zIndex,
  panelRef,
  onActivate,
  dragging = false,
  onClose,
  children,
}: DraggablePanelProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id })

  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node)
    if (panelRef) panelRef.current = node
  }

  // Docked position/size comes from the parent DockEdge's flex layout, not
  // x/y - but the drag transform still applies on top of it, so grabbing the
  // header and pulling away from the dock tracks the cursor immediately
  // rather than waiting for the drop to take effect.
  const style: CSSProperties = {
    left: dockedSide ? undefined : x,
    top: dockedSide ? undefined : y,
    width: dockedSide || floatingWidthEm === undefined ? undefined : `${floatingWidthEm}em`,
    zIndex,
    visibility: dragging ? 'hidden' : undefined,
    transform: transform ? CSS.Translate.toString(transform) : undefined,
  }

  const bodyStyle: CSSProperties | undefined =
    dockedSide || floatingMaxHeightEm === undefined ? undefined : { maxHeight: `${floatingMaxHeightEm}em` }

  const dockedClasses = dockedSide
    ? ` draggable-panel--docked draggable-panel--docked-${dockedSide}`
    : ''

  return (
    <div
      ref={setRefs}
      className={`draggable-panel${dockedClasses}`}
      style={style}
      onPointerDown={onActivate}
    >
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
      <div className="draggable-panel-body themed-scroll" style={bodyStyle}>{children}</div>
    </div>
  )
}

export default DraggablePanel
