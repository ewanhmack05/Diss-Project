import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import { describe, expect, it } from 'vitest'
import {
  parseCellCountDots,
  colourBreakdownFromDots,
  colourBreakdownBackground,
  dotsFromHistory,
  placedByBreakdown,
  countSummary,
} from './CellCountDots'

function dotFeature(x: number, y: number, colour: string): Feature<Point> {
  const feature = new Feature({ geometry: new Point([x, y]) })
  feature.set('colour', colour)
  return feature
}

describe('parseCellCountDots', () => {
  it('parses a JSON-encoded dot array', () => {
    const dots = [{ x: 1, y: 2, colour: '#fff614' }]
    expect(parseCellCountDots(JSON.stringify(dots))).toEqual(dots)
  })

  it('falls back to an empty array for invalid JSON', () => {
    expect(parseCellCountDots('not json')).toEqual([])
  })

  it('falls back to an empty array when the JSON is not an array', () => {
    expect(parseCellCountDots('{}')).toEqual([])
  })
})

describe('colourBreakdownFromDots', () => {
  it('counts dots per colour', () => {
    const dots = [
      { x: 0, y: 0, colour: '#fff614' },
      { x: 1, y: 1, colour: '#fff614' },
      { x: 2, y: 2, colour: '#00ff00' },
    ]
    expect(colourBreakdownFromDots(dots)).toEqual([
      { colour: '#fff614', count: 2 },
      { colour: '#00ff00', count: 1 },
    ])
  })

  it('returns an empty breakdown for no dots', () => {
    expect(colourBreakdownFromDots([])).toEqual([])
  })
})

describe('colourBreakdownBackground', () => {
  it('returns a flat colour for a single-colour breakdown', () => {
    expect(colourBreakdownBackground([{ colour: '#fff614', count: 5 }])).toBe('#fff614')
  })

  it('returns a conic-gradient sized by share for multiple colours', () => {
    const background = colourBreakdownBackground([
      { colour: '#fff614', count: 1 },
      { colour: '#00ff00', count: 1 },
    ])
    expect(background).toBe('conic-gradient(#fff614 0% 50%, #00ff00 50% 100%)')
  })

  it('returns the neutral colour for an empty breakdown', () => {
    expect(colourBreakdownBackground([])).toBe('var(--chrome-text-secondary)')
  })
})

describe('dotsFromHistory', () => {
  it('reads x, y and colour off each dot feature, in order', () => {
    const history = [dotFeature(10, 20, '#fff614'), dotFeature(30, 40, '#00ff00')]
    expect(dotsFromHistory(history)).toEqual([
      { x: 10, y: 20, colour: '#fff614' },
      { x: 30, y: 40, colour: '#00ff00' },
    ])
  })

  it('drops nulls left by withAnnotation-off clicks', () => {
    const history = [null, dotFeature(5, 5, '#fff614'), null]
    expect(dotsFromHistory(history)).toEqual([{ x: 5, y: 5, colour: '#fff614' }])
  })

  it('returns an empty array for an all-null (withAnnotation off) session', () => {
    expect(dotsFromHistory([null, null])).toEqual([])
  })

  it('returns an empty array for an empty history', () => {
    expect(dotsFromHistory([])).toEqual([])
  })

  it('reflects an undo (popped entry) by omitting it', () => {
    const history = [dotFeature(1, 1, '#fff614'), dotFeature(2, 2, '#00ff00')]
    history.pop()
    expect(dotsFromHistory(history)).toEqual([{ x: 1, y: 1, colour: '#fff614' }])
  })
})

describe('placedByBreakdown', () => {
  it('counts dots per person, in the order they first show up', () => {
    const a = { userId: 'a', name: 'Guest a' }
    const b = { userId: 'b', name: 'Guest b' }
    const dots = [
      { x: 0, y: 0, colour: '#fff', placedBy: b },
      { x: 1, y: 1, colour: '#fff', placedBy: a },
      { x: 2, y: 2, colour: '#fff', placedBy: b },
    ]
    expect(placedByBreakdown(dots)).toEqual([
      { ...b, count: 2 },
      { ...a, count: 1 },
    ])
  })

  it('is empty for a count nobody was recorded on', () => {
    expect(placedByBreakdown([{ x: 0, y: 0, colour: '#fff' }])).toEqual([])
  })
})

describe('parseCellCountDots with dots not loaded', () => {
  it('reads null - a count from the list, dots not fetched - as no dots', () => {
    expect(parseCellCountDots(null)).toEqual([])
  })
})

describe('countSummary', () => {
  const dots = JSON.stringify([
    { x: 1, y: 1, colour: '#ff0000', placedBy: { userId: 'u1', name: 'Alice' } },
    { x: 2, y: 2, colour: '#0000ff', placedBy: { userId: 'u2', name: 'Bob' } },
    { x: 3, y: 3, colour: '#ff0000', placedBy: { userId: 'u1', name: 'Alice' } },
  ])

  it("uses the list's summary, without touching the dots", () => {
    const summary = countSummary({
      dots: null,
      colourCounts: [{ colour: '#00ff00', count: 7 }],
      placedByCounts: [{ userId: 'u3', name: 'Carol', count: 7 }],
    })
    expect(summary).toEqual({
      colours: [{ colour: '#00ff00', count: 7 }],
      people: [{ userId: 'u3', name: 'Carol', count: 7 }],
    })
  })

  it('prefers the summary even once the dots have loaded', () => {
    const summary = countSummary({ dots, colourCounts: [{ colour: '#00ff00', count: 7 }], placedByCounts: [] })
    expect(summary.colours).toEqual([{ colour: '#00ff00', count: 7 }])
  })

  it('works it out from the dots for a count with no summary - one just saved', () => {
    expect(countSummary({ dots })).toEqual({
      colours: [{ colour: '#ff0000', count: 2 }, { colour: '#0000ff', count: 1 }],
      people: [{ userId: 'u1', name: 'Alice', count: 2 }, { userId: 'u2', name: 'Bob', count: 1 }],
    })
  })

  it("matches what annotation-store's summary gives for the same dots", () => {
    // Same dots and expected counts as annotation-store's
    // CellCountSummaryTests.FromDots_CountsColoursAndPeople_InTheOrderTheyFirstTurnUp,
    // so the list and a fresh save show the same thing.
    const shared = JSON.stringify([
      { x: 1, y: 1, colour: '#ff0000', placedBy: { userId: 'u1', name: 'Alice' } },
      { x: 2, y: 2, colour: '#0000ff', placedBy: { userId: 'u2', name: 'Bob' } },
      { x: 3, y: 3, colour: '#ff0000', placedBy: { userId: 'u1', name: 'Alice' } },
      { x: 4, y: 4, colour: '#ff0000' },
    ])
    expect(countSummary({ dots: shared })).toEqual({
      colours: [{ colour: '#ff0000', count: 3 }, { colour: '#0000ff', count: 1 }],
      people: [{ userId: 'u1', name: 'Alice', count: 2 }, { userId: 'u2', name: 'Bob', count: 1 }],
    })
  })

  it('is empty with neither summary nor dots', () => {
    expect(countSummary({ dots: null })).toEqual({ colours: [], people: [] })
  })
})
