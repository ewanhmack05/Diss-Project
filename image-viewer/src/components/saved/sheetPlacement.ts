// Where the Saved lists' filter sheet goes. It sits against the panel's
// right edge, top lined up with the panel's, at least as tall as the panel -
// or against its left edge when there's no room on the right. A panel
// docked along the top or bottom runs the width of the screen, leaving no
// room either side, so then it drops down from the Filter button instead.

interface Box {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

interface Viewport {
  width: number
  height: number
}

type Side = 'right' | 'left' | 'below'

interface SheetPlacement {
  side: Side
  left: number
  top: number
  width: number
  // Matches the panel beside it - null when it's under the button instead.
  minHeight: number | null
  maxHeight: number
}

const MARGIN = 8
// Docked along the top or bottom a panel is as wide as the screen, so its
// width alone would make a very wide sheet.
const MAX_WIDTH = 300

function placeSheet(panel: Box, toggle: Box, viewport: Viewport): SheetPlacement {
  const width = Math.min(panel.width, MAX_WIDTH)
  const top = Math.max(MARGIN, panel.top)
  const beside = {
    top,
    width,
    minHeight: panel.bottom - top,
    maxHeight: viewport.height - MARGIN - top,
  }
  if (panel.right + width <= viewport.width - MARGIN) return { side: 'right', left: panel.right, ...beside }
  if (panel.left - width >= MARGIN) return { side: 'left', left: panel.left - width, ...beside }

  const belowTop = toggle.bottom + MARGIN
  return {
    side: 'below',
    left: Math.min(Math.max(MARGIN, toggle.right - width), viewport.width - MARGIN - width),
    top: belowTop,
    width,
    minHeight: null,
    maxHeight: viewport.height - MARGIN - belowTop,
  }
}

function samePlacement(a: SheetPlacement | null, b: SheetPlacement): boolean {
  return (
    a !== null &&
    a.side === b.side &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.minHeight === b.minHeight &&
    a.maxHeight === b.maxHeight
  )
}

export { placeSheet, samePlacement }
export type { Box, SheetPlacement, Side }
