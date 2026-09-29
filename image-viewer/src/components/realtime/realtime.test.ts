import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyOp, throttle, viewportFrom, viewportRing } from './realtime'

describe('applyOp', () => {
  const items = [
    { id: 'a', label: 'one' },
    { id: 'b', label: 'two' },
  ]

  it('appends a create', () => {
    const result = applyOp(items, { kind: 'create', entity: 'annotation', id: 'c', data: { id: 'c', label: 'three' } })
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('ignores a create for an id that is already there', () => {
    const result = applyOp(items, { kind: 'create', entity: 'annotation', id: 'a', data: { id: 'a', label: 'dupe' } })
    expect(result).toBe(items)
  })

  it('merges an update into just that item', () => {
    const result = applyOp(items, { kind: 'update', entity: 'annotation', id: 'b', data: { label: 'changed' } })
    expect(result).toEqual([
      { id: 'a', label: 'one' },
      { id: 'b', label: 'changed' },
    ])
  })

  it('removes a delete', () => {
    const result = applyOp(items, { kind: 'delete', entity: 'annotation', id: 'a' })
    expect(result).toEqual([{ id: 'b', label: 'two' }])
  })

  it('leaves the list alone for an update to an unknown id', () => {
    const result = applyOp(items, { kind: 'update', entity: 'annotation', id: 'zzz', data: { label: 'x' } })
    expect(result).toEqual(items)
  })
})

describe('viewportFrom', () => {
  it('builds the unrotated box from centre, resolution and screen size', () => {
    const viewport = viewportFrom([100, -50], 2, 0.3, [200, 100])
    expect(viewport.extent).toEqual([-100, -150, 300, 50])
    expect(viewport.rotation).toBe(0.3)
  })
})

describe('viewportRing', () => {
  it('is just the extent corners when not rotated, starting top-left', () => {
    const ring = viewportRing(viewportFrom([0, 0], 1, 0, [20, 10]))
    expect(ring).toEqual([
      [-10, 5],
      [10, 5],
      [10, -5],
      [-10, -5],
      [-10, 5],
    ])
  })

  it('turns the box round its centre', () => {
    const ring = viewportRing(viewportFrom([5, 5], 1, Math.PI / 2, [20, 10]))
    // A quarter turn swaps width and height round the centre.
    const [topLeft] = ring
    expect(topLeft[0]).toBeCloseTo(0)
    expect(topLeft[1]).toBeCloseTo(-5)
    const xs = ring.map(([x]) => x)
    const ys = ring.map(([, y]) => y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(20)
  })

  it('closes the ring', () => {
    const ring = viewportRing(viewportFrom([3, 4], 2, 1, [10, 10]))
    expect(ring[ring.length - 1]).toEqual(ring[0])
  })
})

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls straight away the first time', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 100)
    throttled(1)
    expect(fn).toHaveBeenCalledWith(1)
  })

  it('squashes a burst down to one trailing call with the latest args', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 100)
    throttled(1)
    throttled(2)
    throttled(3)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith(3)
  })

  it('does nothing after cancel', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 100)
    throttled(1)
    throttled(2)
    throttled.cancel()
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
