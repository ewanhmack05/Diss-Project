interface Rect {
  top: number
  bottom: number
  left: number
}

interface Size {
  width: number
  height: number
}

interface Viewport {
  width: number
  height: number
}

interface Position {
  top: number
  left: number
}

const MARGIN = 8

// Opens below-left of the anchor by default, flipping above it when there
// isn't room below - the anchor is typically near the top of the screen for
// a docked-top panel and near the bottom for a docked-bottom one, so this
// flip is what keeps the popup on-screen in either case. Horizontally
// clamped the same way, so it never runs off the right edge of a narrow
// window either.
function computePopupPosition(anchor: Rect, popupSize: Size, viewport: Viewport): Position {
  const fitsBelow = anchor.bottom + MARGIN + popupSize.height <= viewport.height
  const top = fitsBelow
    ? anchor.bottom + MARGIN
    : Math.max(MARGIN, anchor.top - MARGIN - popupSize.height)

  const left = Math.min(
    Math.max(anchor.left, MARGIN),
    Math.max(MARGIN, viewport.width - popupSize.width - MARGIN)
  )

  return { top, left }
}

export { computePopupPosition }
export type { Rect, Size, Viewport, Position }
