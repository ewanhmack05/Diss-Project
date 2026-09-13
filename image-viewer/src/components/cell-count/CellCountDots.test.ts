import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import { describe, expect, it } from 'vitest'
import {
  parseCellCountDots,
  colourBreakdownFromDots,
  colourBreakdownBackground,
  dotsFromHistory,
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
