interface Point {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

interface Rect extends Point, Size {}

// The area floating panels are allowed to sit in, in viewport pixels.
interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

// Space between panels stacked in the same column, and between columns.
const PANEL_GAP = 16

// Offset used when nothing fits anywhere - each extra panel shifts down and
// right by this much so their headers are still visible and grabbable.
const CASCADE_STEP = 24

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

// Keeps the whole panel inside bounds. If it's bigger than bounds, the
// top-left wins so the header (the drag handle) stays on screen.
function clampToBounds(position: Point, size: Size, bounds: Bounds): Point {
  return {
    x: Math.max(bounds.left, Math.min(position.x, bounds.right - size.width)),
    y: Math.max(bounds.top, Math.min(position.y, bounds.bottom - size.height)),
  }
}

// Stacks panels down from origin, starting a new column to the right when
// the next one won't fit above the bottom. Picks the first gap that doesn't
// overlap an already open panel, so closing one frees its spot up again.
// Falls back to cascading from origin when the screen is full.
function placeInColumns(size: Size, occupied: Rect[], bounds: Bounds, origin: Point): Point {
  const start = clampToBounds(origin, size, bounds)

  for (let x = start.x; x + size.width <= bounds.right; x += size.width + PANEL_GAP) {
    const inColumn = occupied.filter((rect) => rect.x < x + size.width && x < rect.x + rect.width)
    const candidates = [start.y, ...inColumn.map((rect) => rect.y + rect.height + PANEL_GAP)]
      .filter((y) => y >= start.y)
      .sort((a, b) => a - b)

    for (const y of candidates) {
      if (y + size.height > bounds.bottom) break
      const rect = { x, y, ...size }
      if (!occupied.some((other) => overlaps(rect, other))) return { x, y }
    }
  }

  const step = CASCADE_STEP * occupied.length
  return clampToBounds({ x: start.x + step, y: start.y + step }, size, bounds)
}

export { clampToBounds, placeInColumns, PANEL_GAP, CASCADE_STEP }
export type { Point, Size, Rect, Bounds }
