import { describe, expect, it } from 'vitest'
import {
  capResolutionsAtNativeScale,
  clampOverviewBoxSize,
  computeResolutionLadder,
  niceScaleValue,
  chooseScaleBarLength,
  formatScaleLength,
} from './OpenLayers'

describe('computeResolutionLadder', () => {
  it('halves both dimensions until they fit in one tile', () => {
    // 7436x15494, tileSize 256 - matches CMU-1's actual ladder.
    expect(computeResolutionLadder({ width: 7436, height: 15494 }, 256)).toEqual([
      64, 32, 16, 8, 4, 2, 1,
    ])
  })

  it('needs more halvings for a much larger slide', () => {
    // 101832x219976, tileSize 256 - matches slide 003's actual ladder.
    expect(computeResolutionLadder({ width: 101832, height: 219976 }, 256)).toEqual([
      1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1,
    ])
  })

  it('is just [1] when the slide already fits in one tile', () => {
    expect(computeResolutionLadder({ width: 200, height: 100 }, 256)).toEqual([1])
  })
})

describe('capResolutionsAtNativeScale', () => {
  it('returns the ladder unchanged when there is no objectivePower', () => {
    const ladder = [64, 32, 16, 8, 4, 2, 1]
    expect(capResolutionsAtNativeScale(ladder, null)).toEqual(ladder)
  })

  it('trims intermediate tiers coarser than objectivePower but keeps the whole-slide tier', () => {
    // CMU-1: the whole-slide tier (64) sits below x1 (20/64 < 1) - kept
    // anyway per the rule below - while the merely-intermediate 32 (also
    // above objectivePower, but not the whole-slide tier) still gets
    // trimmed, same as before.
    expect(capResolutionsAtNativeScale([64, 32, 16, 8, 4, 2, 1], 20)).toEqual([64, 16, 8, 4, 2, 1])
  })

  it('always keeps the whole-slide tier even when it is far below objectivePower', () => {
    // Regression test: slide 003 (101832x219976, objectivePower 20) - the
    // whole-slide tier (1024) sits at 20/1024 ~= 0.02x, way below x1, but
    // excluding it (the old behaviour) left no way to zoom out far enough
    // to see the whole slide at all.
    const ladder = [1024, 512, 256, 128, 64, 32, 16, 8, 4, 2, 1]
    const capped = capResolutionsAtNativeScale(ladder, 20)
    expect(capped[0]).toBe(1024)
    expect(capped).toEqual([1024, 16, 8, 4, 2, 1])
  })

  it('keeps the whole-slide tier as the sole entry when the rest of the ladder is degenerate', () => {
    expect(capResolutionsAtNativeScale([1024], 20)).toEqual([1024])
  })

  it('is a no-op when the whole-slide tier already sits at or under objectivePower', () => {
    expect(capResolutionsAtNativeScale([16, 8, 4, 2, 1], 20)).toEqual([16, 8, 4, 2, 1])
  })
})

describe('clampOverviewBoxSize', () => {
  it('leaves the box alone when both dimensions already clear the minimum', () => {
    expect(clampOverviewBoxSize(23.13, 14.87, 6)).toEqual({ width: 23.13, height: 14.87 })
  })

  it('floors a dimension that has shrunk below the minimum', () => {
    // Regression test: slide 003 (101832x219976, ~14x CMU-1's linear size)
    // renders a viewport box of ~1.6x1.0px at native zoom - the box was
    // there, just too small to see. Each dimension floors independently.
    expect(clampOverviewBoxSize(1.63, 1.05, 6)).toEqual({ width: 6, height: 6 })
  })

  it('floors only the dimension that needs it', () => {
    expect(clampOverviewBoxSize(2, 40, 6)).toEqual({ width: 6, height: 40 })
  })

  it('floors to the minimum when the box has not been measured yet (NaN)', () => {
    expect(clampOverviewBoxSize(NaN, NaN, 6)).toEqual({ width: 6, height: 6 })
  })
})

describe('niceScaleValue', () => {
  it('picks 5 when the fraction is 5 or above', () => {
    expect(niceScaleValue(73)).toBe(50)
  })

  it('picks 2 when the fraction is between 2 and 5', () => {
    expect(niceScaleValue(38)).toBe(20)
  })

  it('picks 1 when the fraction is between 1 and 2', () => {
    expect(niceScaleValue(14)).toBe(10)
  })

  it('handles a value already exactly on a step', () => {
    expect(niceScaleValue(500)).toBe(500)
  })

  it('handles values below 1', () => {
    expect(niceScaleValue(0.34)).toBeCloseTo(0.2, 10)
  })

  it('is 0 for a non-positive input', () => {
    expect(niceScaleValue(0)).toBe(0)
    expect(niceScaleValue(-5)).toBe(0)
  })
})

describe('chooseScaleBarLength', () => {
  it('picks a round micron length that fits within maxWidthPx', () => {
    // 1 screen px = 2 microns, capped at 80px -> up to 160 microns -> nice value 100
    const result = chooseScaleBarLength(2, 80)
    expect(result.length).toBe(100)
    expect(result.widthPx).toBe(50)
  })

  it('scales down for a coarser resolution', () => {
    // 1 screen px = 50 microns, capped at 80px -> up to 4000 microns -> nice value 2000
    const result = chooseScaleBarLength(50, 80)
    expect(result.length).toBe(2000)
    expect(result.widthPx).toBe(40)
  })

  it('is zero-length when there is nothing sensible to scale (non-positive input)', () => {
    expect(chooseScaleBarLength(0, 80)).toEqual({ length: 0, widthPx: 0 })
    expect(chooseScaleBarLength(-1, 80)).toEqual({ length: 0, widthPx: 0 })
  })

  it('is zero-length for a non-finite input rather than propagating NaN/Infinity', () => {
    expect(chooseScaleBarLength(NaN, 80)).toEqual({ length: 0, widthPx: 0 })
    expect(chooseScaleBarLength(Infinity, 80)).toEqual({ length: 0, widthPx: 0 })
  })
})

describe('formatScaleLength', () => {
  it('formats a pixel length with no unit conversion', () => {
    expect(formatScaleLength(100, 'pixel')).toBe('100 px')
  })

  it('formats a micron length under 1000 as µm', () => {
    expect(formatScaleLength(500, 'micron')).toBe('500 µm')
  })

  it('formats exactly 1000 microns as 1mm with no rounding artefacts', () => {
    expect(formatScaleLength(1000, 'micron')).toBe('1 mm')
  })

  it('formats a larger nice micron value as an exact mm value', () => {
    expect(formatScaleLength(2000, 'micron')).toBe('2 mm')
    expect(formatScaleLength(5000, 'micron')).toBe('5 mm')
  })
})
