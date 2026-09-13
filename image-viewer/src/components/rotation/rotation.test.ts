import { describe, expect, it } from 'vitest'
import {
  normalizeDegrees,
  degreesToRadians,
  radiansToDegrees,
  stepRotation,
  shortestRotationDelta,
} from './rotation'

describe('normalizeDegrees', () => {
  it('wraps a negative input into [0, 360)', () => {
    expect(normalizeDegrees(-90)).toBe(270)
  })

  it('wraps an input greater than 360', () => {
    expect(normalizeDegrees(450)).toBe(90)
  })

  it('leaves exact 0 unchanged', () => {
    expect(normalizeDegrees(0)).toBe(0)
  })

  it('wraps exact 360 down to 0', () => {
    expect(normalizeDegrees(360)).toBe(0)
  })

  it('wraps a tiny negative float to just under 360', () => {
    expect(normalizeDegrees(-0.0001)).toBeCloseTo(359.9999, 4)
  })

  it('leaves a non-multiple-of-90 float already in range unchanged', () => {
    expect(normalizeDegrees(137.5)).toBeCloseTo(137.5, 10)
  })

  it('wraps a large negative multi-turn input', () => {
    expect(normalizeDegrees(-810)).toBe(270)
  })
})

describe('degreesToRadians', () => {
  it('converts 180 degrees to pi radians', () => {
    expect(degreesToRadians(180)).toBeCloseTo(Math.PI, 10)
  })

  it('converts 0 degrees to 0 radians', () => {
    expect(degreesToRadians(0)).toBe(0)
  })
})

describe('radiansToDegrees', () => {
  it('converts pi radians to 180 degrees', () => {
    expect(radiansToDegrees(Math.PI)).toBeCloseTo(180, 10)
  })

  it('normalizes a negative radians input into [0, 360)', () => {
    expect(radiansToDegrees(-Math.PI / 2)).toBeCloseTo(270, 10)
  })
})

describe('degrees -> radians -> degrees round trip', () => {
  it('stays within a small epsilon for a range of values', () => {
    const epsilon = 1e-9
    for (const deg of [0, 15, 90, 137.5, 180, 269.999, 359]) {
      const roundTripped = radiansToDegrees(degreesToRadians(deg))
      expect(Math.abs(roundTripped - deg)).toBeLessThan(epsilon)
    }
  })
})

describe('stepRotation', () => {
  it('adds a positive step and normalizes past 360', () => {
    expect(stepRotation(350, 15)).toBe(5)
  })

  it('subtracts a negative step and normalizes below 0', () => {
    expect(stepRotation(10, -15)).toBe(355)
  })

  it('applies a +90 step', () => {
    expect(stepRotation(0, 90)).toBe(90)
  })
})

describe('shortestRotationDelta', () => {
  it('takes the short way across the 0/360 boundary', () => {
    expect(shortestRotationDelta(350, 5)).toBe(15)
  })

  it('takes the short way in the other direction', () => {
    expect(shortestRotationDelta(5, 350)).toBe(-15)
  })

  it('is zero from a value to itself', () => {
    expect(shortestRotationDelta(42, 42)).toBe(0)
  })

  it('resets from near-360 back to 0 via the short positive arc', () => {
    expect(shortestRotationDelta(358, 0)).toBe(2)
  })
})
