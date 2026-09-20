import { describe, expect, it } from 'vitest'
import { clamp01, extentToRegion, regionToExtent } from './workingArea'

// Every division/subtraction below is exact floating-point (halves, tenths,
// quarters of round numbers land on values IEEE754 doubles represent
// losslessly), except where a clamped edge introduces a genuine subtraction
// (e.g. 0.3 - 0.1) - those specific fields use toBeCloseTo instead of toBe,
// same convention as OpenLayers.test.ts's chooseScaleBarLength/
// niceScaleValue tests use for their own computed floats.

describe('clamp01', () => {
  it('passes values already inside [0,1] through unchanged', () => {
    expect(clamp01(0.3)).toBe(0.3)
    expect(clamp01(0)).toBe(0)
    expect(clamp01(1)).toBe(1)
  })

  it('floors below 0', () => {
    expect(clamp01(-0.5)).toBe(0)
  })

  it('ceils above 1', () => {
    expect(clamp01(1.5)).toBe(1)
  })
})

describe('extentToRegion', () => {
  // Hand-checked: slide 1000x2000. Drawn box spans image X [100,300] and
  // image Y [1000,1500] (asymmetric - 200 wide, 500 tall - and not centred
  // on either axis). The map is Y-flipped (see OpenLayers.ts's getExtent:
  // [0, -height, width, 0]), so image Y 1000 (nearer the top) is map Y
  // -1000, and image Y 1500 is map Y -1500 - the box's extent therefore has
  // its *larger* image-Y edge as its *smaller* (more negative) map-Y value.
  it('converts a box extent to a normalized region, un-flipping Y correctly', () => {
    const extent: [number, number, number, number] = [100, -1500, 300, -1000]
    const region = extentToRegion(extent, { width: 1000, height: 2000 })
    expect(region.x).toBe(0.1)
    expect(region.y).toBe(0.5)
    expect(region.width).toBeCloseTo(0.2, 10)
    expect(region.height).toBeCloseTo(0.25, 10)
  })

  // Second hand-checked case, pinned to the slide's top edge specifically -
  // image Y [0,100] on an 800x600 slide, map Y [-100,0]. Catches an
  // off-by-one-sign error that the first case's mid-slide numbers wouldn't:
  // getting the flip backwards here would put the box at the *bottom* of
  // the slide (y=0.833) instead of the top (y=0).
  it('places a box touching the top edge of the slide at y=0, not the bottom', () => {
    const extent: [number, number, number, number] = [50, -100, 750, 0]
    const region = extentToRegion(extent, { width: 800, height: 600 })
    expect(region.y).toBe(0)
    expect(region.height).toBeCloseTo(100 / 600, 10)
    expect(region.x).toBeCloseTo(50 / 800, 10)
    expect(region.width).toBeCloseTo(700 / 800, 10)
  })

  it('clamps a box drawn partly off the slide (view has no extent constraint)', () => {
    // Image X [-200, 500] (runs off the left edge), image Y [200, 800].
    const extent: [number, number, number, number] = [-200, -800, 500, -200]
    const region = extentToRegion(extent, { width: 1000, height: 1000 })
    expect(region.x).toBe(0)
    expect(region.y).toBe(0.2)
    expect(region.width).toBe(0.5)
    expect(region.height).toBeCloseTo(0.6, 10)
  })

  it('clamps a box drawn entirely outside the slide to a degenerate zero-size region at the edge', () => {
    const extent: [number, number, number, number] = [1200, -1800, 1500, -1500]
    const region = extentToRegion(extent, { width: 1000, height: 1000 })
    expect(region).toEqual({ x: 1, y: 1, width: 0, height: 0 })
  })

  it('maps the full slide extent to the full [0,1] region', () => {
    const extent: [number, number, number, number] = [0, -400, 500, 0]
    const region = extentToRegion(extent, { width: 500, height: 400 })
    expect(region).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})

describe('regionToExtent', () => {
  it('is the inverse of extentToRegion for a box fully inside the slide', () => {
    const region = { x: 0.1, y: 0.5, width: 0.2, height: 0.25 }
    const [minX, minY, maxX, maxY] = regionToExtent(region, { width: 1000, height: 2000 })
    expect(minX).toBe(100)
    expect(minY).toBe(-1500)
    expect(maxX).toBeCloseTo(300, 10)
    expect(maxY).toBe(-1000)
  })

  it('maps the full [0,1] region back to the full slide extent', () => {
    const extent = regionToExtent({ x: 0, y: 0, width: 1, height: 1 }, { width: 500, height: 400 })
    expect(extent[0]).toBe(0)
    expect(extent[1]).toBe(-400)
    expect(extent[2]).toBe(500)
    // toBeCloseTo rather than toBe: the top edge comes out as -0 (negating a
    // zero imageTopY), which Object.is-based equality treats as distinct
    // from 0 even though they behave identically everywhere else.
    expect(extent[3]).toBeCloseTo(0, 10)
  })

  it('round-trips extentToRegion -> regionToExtent for an asymmetric, off-centre box', () => {
    const original: [number, number, number, number] = [50, -900, 450, -300]
    const slideSize = { width: 2000, height: 1200 }
    const region = extentToRegion(original, slideSize)
    const roundTripped = regionToExtent(region, slideSize)
    roundTripped.forEach((value, index) => expect(value).toBeCloseTo(original[index], 10))
  })
})
