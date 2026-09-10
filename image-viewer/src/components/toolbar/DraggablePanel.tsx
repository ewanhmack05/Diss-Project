import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { CSSProperties, ReactNode } from 'react'
import './DraggablePanel.css'

interface DraggablePanelProps {
  id: string
  title: string
  x: number
  y: number
  onClose: () => void
  children: ReactNode
}

function DraggablePanel({ id, title, x, y, onClose, children }: DraggablePanelProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id })

  const style: CSSProperties = {
    left: x,
    top: y,
    transform: transform ? CSS.Translate.toString(transform) : undefined,
  }

  return (
    <div ref={setNodeRef} className="draggable-panel" style={style}>
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
