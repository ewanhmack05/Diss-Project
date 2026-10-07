import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BaseObject from 'ol/Object'
import type OlMap from 'ol/Map'
import View from 'ol/View'
import {
  applyOp,
  followView,
  leaderOf,
  panelChanges,
  tabChanges,
  sameView,
  debounce,
  docStateFromWire,
  fromBase64,
  throttle,
  toBase64,
  viewportFrom,
  viewportRing,
  watchView,
  type Participant,
} from './realtime'

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

describe('base64', () => {
  it('round-trips every byte value', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })

  it('matches what .NET sends for a byte[]', () => {
    // Convert.ToBase64String(new byte[] { 1, 2, 250 })
    expect(toBase64(Uint8Array.from([1, 2, 250]))).toBe('AQL6')
  })
})

describe('docStateFromWire', () => {
  it('decodes the updates and keeps the rest', () => {
    const state = docStateFromWire({
      docId: 'annotation:1',
      instanceId: 'i',
      seeded: false,
      updates: ['AQL6'],
      editors: ['c1', 'c2'],
    })
    expect(state).toEqual({ instanceId: 'i', seeded: false, updates: [Uint8Array.from([1, 2, 250])], editors: ['c1', 'c2'] })
  })
})

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs once after calls stop, with the last args', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced(1)
    vi.advanceTimersByTime(60)
    debounced(2)
    vi.advanceTimersByTime(60)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(40)
    expect(fn).toHaveBeenCalledExactlyOnceWith(2)
  })

  it('flush runs a waiting call now, and only once', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced('x')
    debounced.flush()
    expect(fn).toHaveBeenCalledExactlyOnceWith('x')
    vi.advanceTimersByTime(200)
    debounced.flush()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel drops a waiting call', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced()
    debounced.cancel()
    debounced.flush()
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('throttle flush', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends the waiting call straight away', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 100)
    throttled('a')
    throttled('b')
    throttled.flush()
    expect(fn.mock.calls).toEqual([['a'], ['b']])
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('following the host', () => {
  const someone = (overrides: Partial<Participant>): Participant => ({
    connectionId: 'c',
    roomId: 'r',
    userId: 'u',
    displayName: 'Someone',
    colour: '#000',
    joined: '2026-10-07T00:00:00Z',
    host: false,
    canEdit: true,
    viewport: null,
    sketches: null,
    screen: null,
    ...overrides,
  })
  const hostView = { center: [500, 500] as [number, number], resolution: 2, rotation: 0.5, extent: [0, 100, 1000, 900] as [number, number, number, number] }

  it('follows the host once they have said where they are', () => {
    const host = someone({ connectionId: 'h', host: true, viewport: hostView })
    expect(leaderOf([someone({}), someone({ host: true })])).toBeNull()
    expect(leaderOf([someone({}), host])).toBe(host)
  })

  it('fits the host view onto a different screen', () => {
    // Host sees 1000 x 800 map units. A 500 x 800 screen needs 2 per pixel
    // to fit the width, a 2000 x 400 one needs 2 to fit the height.
    expect(followView(hostView, [500, 800])).toEqual({ center: [500, 500], resolution: 2, rotation: 0.5 })
    expect(followView(hostView, [2000, 400]).resolution).toBe(2)
    expect(followView(hostView, [2000, 1600]).resolution).toBe(0.5)
  })

  it('treats the same place as not having moved', () => {
    const at = { center: [100, 100] as [number, number], resolution: 4, rotation: -0.5 }
    expect(sameView({ ...at, rotation: -0.5 + 2 * Math.PI }, at)).toBe(true)
    expect(sameView({ ...at, center: [101, 100] }, at)).toBe(true)
    expect(sameView({ ...at, center: [110, 100] }, at)).toBe(false)
    expect(sameView({ ...at, resolution: 5 }, at)).toBe(false)
    expect(sameView({ ...at, rotation: 0 }, at)).toBe(false)
  })

  it('copies panel changes, but never the RealTime panel', () => {
    expect(panelChanges([], ['ruler', 'realtime'])).toEqual({ open: ['ruler'], close: [] })
    expect(panelChanges(['ruler', 'annotations'], ['annotations', 'cellcount'])).toEqual({
      open: ['cellcount'],
      close: ['ruler'],
    })
    expect(panelChanges(['realtime'], [])).toEqual({ open: [], close: [] })
  })
})

describe('tabChanges', () => {
  it('gives the tabs the host has moved to, but never the RealTime panel', () => {
    expect(tabChanges({}, { annotations: 'saved' })).toEqual([['annotations', 'saved']])
    expect(tabChanges({ annotations: 'saved', cellcount: 'new' }, { annotations: 'saved', cellcount: 'saved' })).toEqual([
      ['cellcount', 'saved'],
    ])
    expect(tabChanges({}, { realtime: 'x' })).toEqual([])
  })
})
