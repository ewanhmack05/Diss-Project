import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BaseObject from 'ol/Object'
import type OlMap from 'ol/Map'
import View from 'ol/View'
import { applyOp, throttle, viewportFrom, viewportRing, watchView } from './realtime'

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

describe('watchView', () => {
  const setup = () => {
    const view = new View({ center: [0, 0], resolution: 1 })
    // A real Map needs a DOM; it only uses Object's property events here.
    const map = new BaseObject() as unknown as OlMap
    const onMove = vi.fn()
    const stop = watchView(view, map, onMove)
    return { view, map, onMove, stop }
  }

  it('fires on every step of a drag, not just when it ends', () => {
    const { view, onMove } = setup()
    view.beginInteraction()
    onMove.mockClear()
    view.setCenter([10, 0])
    view.setCenter([20, 0])
    view.setCenter([30, 0])
    expect(onMove).toHaveBeenCalledTimes(3)
    view.endInteraction()
  })

  it('fires on zoom, rotate and resize', () => {
    const { view, map, onMove } = setup()
    view.setResolution(4)
    view.setRotation(1)
    map.set('size', [100, 100])
    expect(onMove).toHaveBeenCalledTimes(3)
  })

  it('stops firing once unsubscribed', () => {
    const { view, map, onMove, stop } = setup()
    stop()
    view.setCenter([5, 5])
    view.setResolution(2)
    view.setRotation(0.5)
    map.set('size', [10, 10])
    expect(onMove).not.toHaveBeenCalled()
  })
})
