import { describe, expect, it } from 'vitest'
import { pixelDistance, physicalDistanceMicrons, formatDistanceMicrons, formatDistancePixels } from './ruler'

describe('pixelDistance', () => {
  it('computes a 3-4-5 triangle', () => {
    expect(pixelDistance(3, 4)).toBe(5)
  })

  it('is zero for no movement', () => {
    expect(pixelDistance(0, 0)).toBe(0)
  })

  it('handles a purely horizontal drag', () => {
    expect(pixelDistance(12, 0)).toBe(12)
  })
})

describe('physicalDistanceMicrons', () => {
  it('scales a horizontal drag by mppX', () => {
    expect(physicalDistanceMicrons(10, 0, 0.5, 0.5)).toBe(5)
  })

  it('scales a vertical drag by mppY', () => {
    expect(physicalDistanceMicrons(0, 20, 0.25, 0.25)).toBe(5)
  })

  it('combines both axes independently for non-square pixels', () => {
    // dx*mppX = 3, dy*mppY = 4 -> 3-4-5 triangle
    expect(physicalDistanceMicrons(6, 16, 0.5, 0.25)).toBe(5)
  })
})

describe('formatDistanceMicrons', () => {
  it('shows one decimal place below 10 microns', () => {
    expect(formatDistanceMicrons(3.456)).toBe('3.5 µm')
  })

  it('rounds to a whole number at 10 microns and above', () => {
    expect(formatDistanceMicrons(42.7)).toBe('43 µm')
  })

  it('stays in microns just under the 1mm boundary', () => {
    expect(formatDistanceMicrons(999)).toBe('999 µm')
  })

  it('switches to millimetres at exactly 1000 microns', () => {
    expect(formatDistanceMicrons(1000)).toBe('1 mm')
  })

  it('shows a decimal mm value below 10mm', () => {
    expect(formatDistanceMicrons(2500)).toBe('2.5 mm')
  })

  it('rounds mm to a whole number at 10mm and above', () => {
    expect(formatDistanceMicrons(12345)).toBe('12 mm')
  })
})

describe('formatDistancePixels', () => {
  it('rounds to the nearest whole pixel', () => {
    expect(formatDistancePixels(42.6)).toBe('43 px')
  })

  it('formats zero', () => {
    expect(formatDistancePixels(0)).toBe('0 px')
  })
})
