import { describe, expect, it } from 'vitest'
import { computeViewedCellCountExtent, toggleViewedCellCountId, mostRecentCellCount } from './CellCountView'
import type { CellCount } from '../../interfaces/CellCount'

function makeCellCount(id: string, created: string): CellCount {
  return {
    id,
    label: id,
    notes: '',
    dots: '[]',
    withAnnotation: true,
    withRoi: false,
    count: 0,
    dotSize: 6,
    locationX: null,
    locationY: null,
    regionOfInterest: null,
    created,
  }
}

describe('computeViewedCellCountExtent', () => {
  it('prefers the ROI extent when one is present, even with dots and a location', () => {
    const roiExtent = [0, 0, 100, 100]
    const extent = computeViewedCellCountExtent([{ x: 500, y: 500 }], roiExtent, { x: 500, y: 500 })

    // Buffered by 40 in every direction (see FIT_PADDING).
    expect(extent).toEqual([-40, -40, 140, 140])
  })

  it('falls back to a bounding box around the dots when there is no ROI', () => {
    const dots = [
      { x: 10, y: 10 },
      { x: 20, y: 30 },
    ]

    const extent = computeViewedCellCountExtent(dots, null, null)

    expect(extent).toEqual([-30, -30, 60, 70])
  })

  it('falls back to a small pad around the location when there are no dots and no ROI', () => {
    const extent = computeViewedCellCountExtent([], null, { x: 5, y: 5 })

    expect(extent).toEqual([-5, -5, 15, 15])
  })

  it('returns null when there is nothing at all to fit to', () => {
    expect(computeViewedCellCountExtent([], null, null)).toBeNull()
  })
})

describe('toggleViewedCellCountId', () => {
  it('turns off the one already being viewed', () => {
    expect(toggleViewedCellCountId('abc', 'abc')).toBeNull()
  })

  it('switches to the clicked one when a different one (or none) is being viewed', () => {
    expect(toggleViewedCellCountId('abc', 'xyz')).toBe('xyz')
    expect(toggleViewedCellCountId(null, 'xyz')).toBe('xyz')
  })
})

describe('mostRecentCellCount', () => {
  it('picks the one with the latest created timestamp, regardless of array order', () => {
    const oldest = makeCellCount('a', '2024-01-01T00:00:00.000Z')
    const newest = makeCellCount('b', '2024-06-01T00:00:00.000Z')
    const middle = makeCellCount('c', '2024-03-01T00:00:00.000Z')

    expect(mostRecentCellCount([oldest, newest, middle])).toBe(newest)
  })

  it('returns null for an empty store', () => {
    expect(mostRecentCellCount([])).toBeNull()
  })

  it('returns the only entry for a single-item store', () => {
    const only = makeCellCount('a', '2024-01-01T00:00:00.000Z')
    expect(mostRecentCellCount([only])).toBe(only)
  })
})
