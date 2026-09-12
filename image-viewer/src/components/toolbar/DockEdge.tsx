import type { CSSProperties, ReactNode } from 'react'
import type { DockSide } from './dock'
import './DockEdge.css'

interface DockEdgeProps {
  side: DockSide
  // This, not the individual (position:relative) panels inside it, is what
  // actually competes for stacking order against floating panels and other
  // edges - see App.tsx's stacking-key resolution.
  zIndex?: number
  // Fires on pointerdown anywhere within the edge (bubbles up from
  // whichever panel or control inside it was pressed) - clicking either
  // half of a split edge brings the whole edge forward as one unit.
  onActivate?: () => void
  children: ReactNode
}

// Fixed-position strip along one screen edge, holding every panel docked to
// it. A flex container rather than fixed per-panel sizing: one child fills
// it entirely, two children split it evenly (column for left/right so they
// stack top/bottom, row for top/bottom so they sit side by side) - so
// dragging a second panel in and pulling one back out just changes how many
// flex children there are, no manual half-sizing needed.
function DockEdge({ side, zIndex, onActivate, children }: DockEdgeProps) {
  const style: CSSProperties = { zIndex }
  return (
    <div className={`dock-edge dock-edge--${side}`} style={style} onPointerDown={onActivate}>
      {children}
    </div>
  )
}

export default DockEdge
