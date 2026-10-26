import Feature from 'ol/Feature'
import type Map from 'ol/Map'
import LineString from 'ol/geom/LineString'
import Point from 'ol/geom/Point'
import Polygon from 'ol/geom/Polygon'
import type Geometry from 'ol/geom/Geometry'
import VectorSource from 'ol/source/Vector'
import { describe, expect, it } from 'vitest'
import { FullDetailBelow, LessDetail, detailLevel, pointCount, simplified, toleranceFor } from './LessDetail'

// A freehand trace like seed_stress.py's - 120 points round a wobbly circle.
function trace(cx: number, cy: number, radius: number, points = 120): Polygon {
  const ring = Array.from({ length: points }, (_, i) => {
    const angle = (i / points) * 2 * Math.PI
    const r = radius * (1 + 0.1 * Math.sin(angle * 7))
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
  })
  return new Polygon([[...ring, ring[0]]])
}

function distanceToSegment([px, py]: number[], [ax, ay]: number[], [bx, by]: number[]): number {
  const dx = bx - ax
  const dy = by - ay
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// Furthest any of the original points ends up from the simplified outline.
function furthest(original: number[][], simpler: number[][]): number {
  return Math.max(
    ...original.map((p) => Math.min(...simpler.slice(1).map((b, i) => distanceToSegment(p, simpler[i], b))))
  )
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))

function fakeMap(resolution: { value: number }) {
  const listeners: (() => void)[] = []
  const map = {
    getView: () => ({ getResolution: () => resolution.value }),
    on: (_type: string, listener: () => void) => {
      listeners.push(listener)
      return { target: map, type: 'moveend', listener }
    },
  }
  return { map: map as unknown as Map, moveEnd: () => listeners.forEach((l) => l()) }
}

describe('detailLevel', () => {
  it('is full detail zoomed in, then one level per 4x zoom out', () => {
    expect(detailLevel(0.25)).toBe(0)
    expect(detailLevel(FullDetailBelow - 0.01)).toBe(0)
    expect(detailLevel(FullDetailBelow)).toBe(1)
    expect(detailLevel(7.99)).toBe(1)
    expect(detailLevel(8)).toBe(2)
    expect(detailLevel(32)).toBe(3)
    expect(detailLevel(100)).toBe(3)
    expect(detailLevel(128)).toBe(4)
  })

  it('is full detail before the view has a resolution', () => {
    expect(detailLevel(Number.NaN)).toBe(0)
    expect(detailLevel(0)).toBe(0)
  })

  it('never moves a point more than half a screen pixel at any zoom', () => {
    for (let resolution = 0.1; resolution < 2000; resolution *= 1.07) {
      expect(toleranceFor(detailLevel(resolution)) / resolution).toBeLessThanOrEqual(0.5)
    }
  })
})

describe('simplified', () => {
  it('keeps a shape as saved at full detail', () => {
    const shape = trace(0, 0, 500)
    expect(simplified(shape, 0)).toBe(shape)
  })

  it('draws a freehand trace with far fewer points at the fitted view, within the tolerance', () => {
    const shape = trace(50_000, 30_000, 400)
    const level = detailLevel(64)
    const simpler = simplified(shape, level) as Polygon

    expect(pointCount(simpler)).toBeLessThan(pointCount(shape) / 3)
    expect(furthest(shape.getCoordinates()[0], simpler.getCoordinates()[0])).toBeLessThanOrEqual(toleranceFor(level))
  })

  it('leaves a shape alone when every point is needed', () => {
    const box = new Polygon([[[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]]])
    expect(pointCount(simplified(box, 3))).toBe(5)
  })

  it('keeps a line its ends, whatever the zoom', () => {
    const line = new LineString(Array.from({ length: 120 }, (_, i) => [i * 3, Math.sin(i / 5) * 4]))
    const simpler = simplified(line, 5) as LineString
    expect(simpler.getFirstCoordinate()).toEqual([0, 0])
    expect(simpler.getLastCoordinate()).toEqual(line.getLastCoordinate())
    expect(pointCount(simpler)).toBeGreaterThanOrEqual(2)
  })

  it('draws a shape under a pixel across as a box, rather than nothing', () => {
    const tiny = trace(1000, 1000, 3)
    const simpler = simplified(tiny, detailLevel(64)) as Polygon
    expect(pointCount(simpler)).toBe(5)
    expect(simpler.getExtent()).toEqual(tiny.getExtent())
  })

  it("keeps a thin shape that's long enough to see as saved, rather than turn it into a box", () => {
    const sliver = new Polygon([[[0, 0], [5000, 3], [5000, 4], [0, 1], [0, 0]]])
    expect(simplified(sliver, detailLevel(64))).toBe(sliver)
  })

  it('leaves points alone', () => {
    const point = new Point([5, 5])
    expect(simplified(point, 4)).toBe(point)
  })
})

describe('LessDetail', () => {
  function annotation(id: string, geometry: Geometry, colour = '#ff0000') {
    const feature = new Feature({ geometry, colour, strokeColour: colour, outlineLength: 2500 })
    feature.setId(id)
    return feature
  }

  it('copies every saved annotation, once the source has been filled', async () => {
    const full = new VectorSource()
    const less = new LessDetail(full)
    full.addFeatures([annotation('a', trace(0, 0, 400)), annotation('b', trace(5000, 0, 400))])
    expect(less.source.getFeatures()).toHaveLength(0)

    await flush()
    expect(less.source.getFeatures().map((f) => f.getId())).toEqual(['a', 'b'])
    expect(less.source.getFeatureById('a')!.get('outlineLength')).toBe(2500)
  })

  it('draws less zoomed out and leaves the saved shapes as they were', async () => {
    const full = new VectorSource()
    const less = new LessDetail(full)
    full.addFeature(annotation('a', trace(0, 0, 400)))
    const resolution = { value: 0.5 }
    const { map, moveEnd } = fakeMap(resolution)
    less.follow(map)
    await flush()
    expect(pointCount(less.source.getFeatureById('a')!.getGeometry())).toBe(121)

    resolution.value = 64
    moveEnd()
    expect(less.getLevel()).toBe(3)
    expect(pointCount(less.source.getFeatureById('a')!.getGeometry())).toBeLessThan(40)
    expect(pointCount(full.getFeatureById('a')!.getGeometry())).toBe(121)

    resolution.value = 1
    moveEnd()
    expect(less.source.getFeatureById('a')!.getGeometry()).toBe(full.getFeatureById('a')!.getGeometry())
  })

  it('reuses a level it has already worked out', async () => {
    const full = new VectorSource()
    const less = new LessDetail(full)
    full.addFeature(annotation('a', trace(0, 0, 400)))
    less.setLevel(3)
    const first = less.source.getFeatureById('a')!.getGeometry()
    less.setLevel(0)
    less.setLevel(3)
    expect(less.source.getFeatureById('a')!.getGeometry()).toBe(first)
  })

  it('follows a colour picked before it is saved', async () => {
    const full = new VectorSource()
    const less = new LessDetail(full)
    const feature = annotation('a', trace(0, 0, 400))
    full.addFeature(feature)
    await flush()

    feature.set('colour', '#0000ff')
    feature.setProperties({ strokeColour: '#0000ff' }, true)
    await flush()
    expect(less.source.getFeatureById('a')!.get('strokeColour')).toBe('#0000ff')
  })

  it('follows a shape edited in place', async () => {
    const full = new VectorSource()
    const less = new LessDetail(full)
    less.setLevel(3)
    const shape = trace(0, 0, 400)
    full.addFeature(annotation('a', shape))
    await flush()

    shape.translate(10_000, 0)
    await flush()
    expect(less.source.getFeatureById('a')!.getGeometry()!.getExtent()[0]).toBeGreaterThan(9000)
  })

  it('drops one taken out, and starts again when the source is refilled', async () => {
    const full = new VectorSource()
    const less = new LessDetail(full)
    const a = annotation('a', trace(0, 0, 400))
    full.addFeatures([a, annotation('b', trace(5000, 0, 400))])
    await flush()

    full.removeFeature(a)
    await flush()
    expect(less.source.getFeatures().map((f) => f.getId())).toEqual(['b'])

    full.clear()
    full.addFeatures([annotation('c', trace(0, 0, 400))])
    await flush()
    expect(less.source.getFeatures().map((f) => f.getId())).toEqual(['c'])
  })

  it('stops following once disposed', async () => {
    const full = new VectorSource()
    const less = new LessDetail(full)
    less.dispose()
    full.addFeature(annotation('a', trace(0, 0, 400)))
    await flush()
    expect(less.source.getFeatures()).toHaveLength(0)
  })
})
