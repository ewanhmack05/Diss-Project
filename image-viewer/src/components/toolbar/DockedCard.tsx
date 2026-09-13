import type { ReactNode } from 'react'
import './DockedCard.css'

interface DockedCardProps {
  // Only needed for a group with no label of its own (Colour, Options, the
  // shapes grid) - a field that already renders its own visible label
  // (Thickness, Label, Notes) uses that as the card's heading instead of
  // duplicating it here.
  title?: string
  className?: string
  // Optional - a card reserved for later (see CellCounterToolPicker's spare
  // card) has neither a title nor any content yet.
  children?: ReactNode
}

// A grouped, titled box for the docked-top/bottom toolbars (see
// DockedCard.css) - invisible in floating/left/right mode, where these
// panels already read fine as a plain stacked column and don't need it.
function DockedCard({ title, className, children }: DockedCardProps) {
  return (
    <div className={`docked-card${className ? ` ${className}` : ''}`}>
      {title && <div className="docked-card-title">{title}</div>}
      {children}
    </div>
  )
}

export default DockedCard
