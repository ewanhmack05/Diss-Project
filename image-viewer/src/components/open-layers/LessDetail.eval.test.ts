import type Geometry from 'ol/geom/Geometry'
import LineString from 'ol/geom/LineString'
import Polygon, { fromExtent } from 'ol/geom/Polygon'
import { describe, expect, it } from 'vitest'
import { detailLevel, pointCount, simplified, toleranceFor } from './LessDetail'

// What LessDetail saves on seed_stress.py's mix of shapes, the one
// docs/rendering.md was measured with - so the numbers here line up with
// map_bench.js's. Slide 003 is 101,832 x 219,976; fitted to 1600x900 that's
// about 244 slide pixels a screen pixel.
const Width = 101_832
const Height = 219_976
const Fitted = Math.max(Width / 1600, Height / 900)

// seed_stress.py's SHAPES and SHAPE_WEIGHTS.
const Shapes = ['rectangle', 'circle', 'polygon', 'line', 'arrow', 'freehand'] as const
const Weights = [2, 2, 2, 1, 1, 4]

// Same numbers every run.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shapes(count: number): Geometry[] {
  const next = random(3)
  const between = (a: number, b: number) => a + next() * (b - a)
  const total = Weights.reduce((a, b) => a + b)
  return Array.from({ length: count }, () => {
    const cx = between(0.1 * Width, 0.9 * Width)
    const cy = between(-0.93 * Height, -0.07 * Height)
    const size = between(400, 4000)
    let pick = next() * total
    const kind = Shapes[Weights.findIndex((w) => (pick -= w) < 0)]
    if (kind === 'rectangle') {
      const h = size * between(0.4, 1.6)
      return new Polygon([[[cx, cy], [cx + size, cy], [cx + size, cy + h], [cx, cy + h], [cx, cy]]])
    }
    if (kind === 'circle' || kind === 'polygon') {
      const n = kind === 'circle' ? 50 : Math.floor(between(6, 21))
      const ring = Array.from({ length: n }, (_, i) => {
        const r = kind === 'circle' ? size : size * between(0.5, 1)
        return [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]
      })
      return new Polygon([[...ring, ring[0]]])
    }
    if (kind === 'line' || kind === 'arrow') {
      const angle = between(0, 2 * Math.PI)
      return new LineString([[cx, cy], [cx + size * Math.cos(angle), cy + size * Math.sin(angle)]])
    }
    const points: number[][] = []
    let [x, y, angle] = [cx, cy, between(0, 2 * Math.PI)]
    for (let i = 0; i < 120; i++) {
      angle += between(-0.35, 0.35)
      x += (Math.cos(angle) * size) / 40
      y += (Math.sin(angle) * size) / 40
      points.push([x, y])
    }
    return new LineString(points)
  })
}

function outlines(geometry: Geometry): number[][][] {
  if (geometry instanceof Polygon) return geometry.getCoordinates()
  if (geometry instanceof LineString) return [geometry.getCoordinates()]
  return []
}

function distanceToSegment([px, py]: number[], [ax, ay]: number[], [bx, by]: number[]): number {
  const dx = bx - ax
  const dy = by - ay
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// Furthest a saved point ends up from what's drawn, in screen pixels. A
// shape drawn as its bounding box counts as its size, which is under a
// pixel or it wouldn't have been.
function worstError(original: Geometry, drawn: Geometry, resolution: number): number {
  if (drawn !== original && drawn instanceof Polygon && pointCount(drawn) === 5) {
    const box = fromExtent(original.getExtent()).getCoordinates()
    if (JSON.stringify(drawn.getCoordinates()) === JSON.stringify(box)) {
      const [x0, y0, x1, y1] = original.getExtent()
      return Math.max(x1 - x0, y1 - y0) / 2 / resolution
    }
  }
  const drawnLines = outlines(drawn)
  let worst = 0
  outlines(original).forEach((line, i) => {
    const target = drawnLines[i]
    for (const p of line) {
      const d = Math.min(...target.slice(1).map((b, j) => distanceToSegment(p, target[j], b)))
      worst = Math.max(worst, d / resolution)
    }
  })
  return worst
}

const mix = shapes(2000)
const saved = mix.reduce((sum, g) => sum + pointCount(g), 0)

describe("less detail on seed_stress.py's mix", () => {
  const zooms = [1, 4, 16, 64, Fitted]
  const rows = zooms.map((resolution) => {
    const level = detailLevel(resolution)
    const drawn = mix.map((g) => simplified(g, level))
    return {
      resolution,
      level,
      points: drawn.reduce((sum, g) => sum + pointCount(g), 0),
      worst: Math.max(...mix.map((g, i) => worstError(g, drawn[i], resolution))),
    }
  })

  it('prints what the GPU gets at each zoom', () => {
    console.log(`2,000 shapes, ${saved} points as saved (${(saved / 2000).toFixed(1)} a shape)`)
    console.table(
      rows.map((r) => ({
        'slide px per screen px': r.resolution.toFixed(0),
        level: r.level,
        points: r.points,
        'of saved': `${((r.points / saved) * 100).toFixed(0)}%`,
        'worst error (screen px)': r.worst.toFixed(2),
      }))
    )
  })

  it('draws everything as saved zoomed right in', () => {
    expect(rows[0].points).toBe(saved)
  })

  it('draws under a fifth of the points at the fitted view', () => {
    expect(rows.at(-1)!.points / saved).toBeLessThan(0.2)
  })

  it('draws fewer points the further out you go', () => {
    rows.slice(1).forEach((row, i) => expect(row.points).toBeLessThanOrEqual(rows[i].points))
  })

  it('never puts a line more than half a screen pixel from where it was saved', () => {
    rows.forEach((row) => expect(row.worst).toBeLessThanOrEqual(0.5))
  })

  it('is half a pixel at most, by construction', () => {
    zooms.forEach((resolution) => expect(toleranceFor(detailLevel(resolution)) / resolution).toBeLessThanOrEqual(0.5))
  })
})
