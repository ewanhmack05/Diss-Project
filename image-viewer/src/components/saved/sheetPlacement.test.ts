import { describe, expect, it } from 'vitest'
import { placeSheet, type Box } from './sheetPlacement'

function box(left: number, top: number, width: number, height: number): Box {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

const viewport = { width: 1400, height: 900 }
const toggle = box(380, 120, 60, 24)

describe('placeSheet', () => {
  it("sits against the panel's right edge, as wide and at least as tall as it", () => {
    const placed = placeSheet(box(220, 60, 220, 240), toggle, viewport)
    expect(placed).toEqual({ side: 'right', left: 440, top: 60, width: 220, minHeight: 240, maxHeight: 832 })
  })

  it('goes on the left when the panel is against the right of the screen', () => {
    const placed = placeSheet(box(1170, 60, 220, 240), box(1330, 120, 60, 24), viewport)
    expect(placed.side).toBe('left')
    expect(placed.left).toBe(950)
  })

  it('drops down from the button under a panel docked across the top', () => {
    const placed = placeSheet(box(0, 0, 1400, 90), box(1300, 40, 60, 24), viewport)
    expect(placed).toEqual({ side: 'below', left: 1060, top: 72, width: 300, minHeight: null, maxHeight: 820 })
  })

  it('stays on screen when the panel starts above the top', () => {
    const placed = placeSheet(box(220, -20, 220, 240), toggle, viewport)
    expect(placed.top).toBe(8)
    expect(placed.minHeight).toBe(212)
  })
})
