import { describe, expect, it } from 'vitest'
import { arrowHeadRadius, dashPattern } from './Styles'

// segmentLength here is already normalized to "coarsest-view screen
// pixels" (see Styles.ts's arrowHeadStyle/coarsestResolution) - not raw
// map units, and not the live view's current screen pixels either.
describe('arrowHeadRadius', () => {
  it('caps at the fixed max radius for a long segment', () => {
    // 6 + 2 * 1.5 = 9, reached once segmentLength * (9/40) >= 9 i.e. >= 40
    expect(arrowHeadRadius(2, 1000)).toBe(9)
    expect(arrowHeadRadius(2, 40)).toBe(9)
  })

  it('shrinks proportionally for a short segment', () => {
    expect(arrowHeadRadius(2, 20)).toBeCloseTo(4.5)
    expect(arrowHeadRadius(2, 4)).toBeCloseTo(0.9)
  })

  it('is zero for a zero-length segment', () => {
    expect(arrowHeadRadius(2, 0)).toBe(0)
  })

  it('scales the cap with line thickness, same as before', () => {
    // 6 + 6 * 1.5 = 15
    expect(arrowHeadRadius(6, 1000)).toBe(15)
  })

  it('never exceeds the max radius even for an enormous segment', () => {
    expect(arrowHeadRadius(2, 1_000_000)).toBe(9)
  })
})

// effectiveLength here is the same coarsest-view-normalized quantity as
// arrowHeadRadius's segmentLength above (see Styles.ts's geometryLength).
describe('dashPattern', () => {
  it('is the full [6, 4] pattern once at least 3 cycles fit at full size (length >= 30)', () => {
    expect(dashPattern(2, 1000)).toEqual([6, 4])
    expect(dashPattern(2, 30)).toEqual([6, 4])
  })

  it('shrinks the whole pattern proportionally on a shorter shape, keeping the 3:2 dash:gap ratio', () => {
    expect(dashPattern(2, 15)).toEqual([3, 2])
    expect(dashPattern(2, 3)).toEqual([0.6, 0.4])
  })

  it('is [0, 0] for a zero-length shape', () => {
    expect(dashPattern(2, 0)).toEqual([0, 0])
  })

  it('scales the full-size pattern with line thickness, same as before', () => {
    expect(dashPattern(6, 1000)).toEqual([18, 12])
  })
})
