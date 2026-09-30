import { describe, expect, it } from 'vitest'
import { findDoubleCounts, savedDots, tallyByContributor } from './sharedCount'
import type { SharedCount, SharedDot } from '../../realtime/realtime'

let next = 0
const dot = (connectionId: string, x: number, y: number): SharedDot => ({
  id: `dot-${next++}`,
  x,
  y,
  colour: '#fff614',
  connectionId,
})

describe('findDoubleCounts', () => {
  it('flags two people’s dots within the radius', () => {
    const a = dot('a', 0, 0)
    const b = dot('b', 3, 4)
    expect(findDoubleCounts([a, b], 5)).toEqual(new Set([a.id, b.id]))
  })

  it('leaves dots further apart than the radius alone', () => {
    expect(findDoubleCounts([dot('a', 0, 0), dot('b', 6, 0)], 5).size).toBe(0)
  })

  it('never flags the same person against themselves', () => {
    expect(findDoubleCounts([dot('a', 0, 0), dot('a', 1, 0)], 5).size).toBe(0)
  })

  it('finds pairs that straddle a grid line, including negative coordinates', () => {
    const a = dot('a', -0.5, -100.2)
    const b = dot('b', 0.5, -99.8)
    const far = dot('c', 50, 50)
    expect(findDoubleCounts([a, b, far], 5)).toEqual(new Set([a.id, b.id]))
  })

  it('copes with thousands of dots', () => {
    const dots = Array.from({ length: 5000 }, (_, i) => dot(i % 2 ? 'a' : 'b', (i % 100) * 20, Math.floor(i / 100) * 20))
    const started = performance.now()
    expect(findDoubleCounts(dots, 5).size).toBe(0)
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe('savedDots', () => {
  it('swaps the connection for who placed it, and drops anyone it can’t name', () => {
    const count: SharedCount = {
      id: 'count',
      hostConnectionId: 'conn-a',
      settings: { roiGeoJson: null, dotSize: 6, matchRadius: 5 },
      started: '',
      contributors: [
        { connectionId: 'conn-a', userId: 'user-a', displayName: 'Guest a', colour: '#f00', state: 'joined' },
        { connectionId: 'conn-b', userId: 'user-b', displayName: 'Guest b', colour: '#0f0', state: 'left' },
      ],
      dots: [
        { id: '1', x: 1, y: 2, colour: '#fff', connectionId: 'conn-a' },
        { id: '2', x: 3, y: 4, colour: '#000', connectionId: 'conn-b' },
        { id: '3', x: 5, y: 6, colour: '#000', connectionId: 'conn-gone' },
      ],
    }
    expect(savedDots(count)).toEqual([
      { x: 1, y: 2, colour: '#fff', placedBy: { userId: 'user-a', name: 'Guest a' } },
      { x: 3, y: 4, colour: '#000', placedBy: { userId: 'user-b', name: 'Guest b' } },
      { x: 5, y: 6, colour: '#000' },
    ])
  })

  it('is empty with no count', () => {
    expect(savedDots(null)).toEqual([])
  })
})

describe('tallyByContributor', () => {
  it('counts dots per person', () => {
    const tally = tallyByContributor([dot('a', 0, 0), dot('b', 1, 1), dot('a', 2, 2)])
    expect(Object.fromEntries(tally)).toEqual({ a: 2, b: 1 })
  })
})
