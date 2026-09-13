import { describe, expect, it } from 'vitest'
import { computePopupPosition } from './popupPosition'

const viewport = { width: 1000, height: 800 }
const popupSize = { width: 224, height: 200 }

describe('computePopupPosition', () => {
  it('opens directly below the anchor when there is room', () => {
    const anchor = { top: 100, bottom: 120, left: 50 }
    expect(computePopupPosition(anchor, popupSize, viewport)).toEqual({ top: 128, left: 50 })
  })

  it('flips above the anchor when there is no room below (anchor near the bottom of the screen)', () => {
    const anchor = { top: 700, bottom: 720, left: 50 }
    expect(computePopupPosition(anchor, popupSize, viewport)).toEqual({ top: 492, left: 50 })
  })

  it('clamps left so the popup never runs off the right edge', () => {
    const anchor = { top: 100, bottom: 120, left: 950 }
    const result = computePopupPosition(anchor, popupSize, viewport)
    expect(result.left).toBe(1000 - 224 - 8)
  })

  it('clamps left so the popup never runs off the left edge', () => {
    const anchor = { top: 100, bottom: 120, left: -50 }
    const result = computePopupPosition(anchor, popupSize, viewport)
    expect(result.left).toBe(8)
  })

  it('never places the flipped popup above the top of the viewport', () => {
    const anchor = { top: 50, bottom: 720, left: 50 }
    const result = computePopupPosition(anchor, { width: 224, height: 1000 }, viewport)
    expect(result.top).toBe(8)
  })
})
