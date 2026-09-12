import type { DockRect } from './dock'
import './DockPreview.css'

interface DockPreviewProps {
  rect: DockRect | null
}

// Solid highlight over the exact slot the dragged panel will land in -
// the whole edge if it's empty, or just the half it'll split off if
// something's already docked there (see dock.ts's computePreviewRect).
// Distinct from DockZone's dashed border, which only says "this edge takes
// drops" - this says "here, specifically".
function DockPreview({ rect }: DockPreviewProps) {
  if (!rect) return null

  return (
    <div
      className="dock-preview"
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      aria-hidden="true"
    />
  )
}

export default DockPreview
