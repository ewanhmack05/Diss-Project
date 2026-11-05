import type Feature from 'ol/Feature'
import type { Geometry } from 'ol/geom'
import { DefaultColour } from '../annotation/Tools'
import { viewportRing, type Viewport } from '../realtime/realtime'

// What's needed to draw a small picture of part of a slide from its tiles, on a
// canvas. The tiler has no way to render a region, and tiles are already cached.

interface SlideInfo {
  width: number
  height: number
  tileSize: number
}

interface Tier {
  z: number
  cols: number
  rows: number
  // Slide pixels to one tile pixel.
  downsample: number
}

interface PreviewTile {
  z: number
  x: number
  y: number
  // Where it goes, in slide pixels.
  left: number
  top: number
  downsample: number
}

// Slide pixels, y going down, the way tiles are numbered.
interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

// A picture this small never needs more, and it could otherwise be hundreds.
const MAX_TILES = 16
// Drawn at most, so a whole collection doesn't stall the panel for a thumbnail.
const MAX_PATHS = 2000
const MAX_DOTS = 5000

// The same ladder as the tiler's ZoomifyTiling.ComputeTiers, coarsest first.
function tiersOf({ width, height, tileSize }: SlideInfo): Tier[] {
  const sizes: { cols: number; rows: number }[] = []
  let w = width
  let h = height
  while (w > tileSize || h > tileSize) {
    sizes.push({ cols: Math.ceil(w / tileSize), rows: Math.ceil(h / tileSize) })
    w = Math.floor(w / 2)
    h = Math.floor(h / 2)
  }
  sizes.push({ cols: 1, rows: 1 })
  sizes.reverse()
  return sizes.map((size, z) => ({ z, ...size, downsample: 2 ** (sizes.length - 1 - z) }))
}

// What's on screen at that view, turned, as the box round it.
function boundsOf(viewport: Viewport): Bounds {
  const ring = viewportRing(viewport)
  const xs = ring.map(([x]) => x)
  const ys = ring.map(([, y]) => -y)
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
}

function tilesAt(tier: Tier, tileSize: number, bounds: Bounds): PreviewTile[] {
  const footprint = tileSize * tier.downsample
  const firstX = Math.max(0, Math.floor(bounds.left / footprint))
  const firstY = Math.max(0, Math.floor(bounds.top / footprint))
  const lastX = Math.min(tier.cols - 1, Math.floor(bounds.right / footprint))
  const lastY = Math.min(tier.rows - 1, Math.floor(bounds.bottom / footprint))
  const tiles: PreviewTile[] = []
  for (let y = firstY; y <= lastY; y++) {
    for (let x = firstX; x <= lastX; x++) {
      tiles.push({ z: tier.z, x, y, left: x * footprint, top: y * footprint, downsample: tier.downsample })
    }
  }
  return tiles
}

// The coarsest tier that's still sharp at this size, or coarser if that's too
// many tiles. Empty when the area's off the slide altogether.
function previewTiles(slide: SlideInfo, bounds: Bounds, pixelsWide: number): PreviewTile[] {
  const tiers = tiersOf(slide)
  const span = Math.max(bounds.right - bounds.left, 1)
  const sharp = tiers.findIndex((tier) => span / tier.downsample >= pixelsWide)
  let index = sharp === -1 ? tiers.length - 1 : sharp
  let tiles = tilesAt(tiers[index], slide.tileSize, bounds)
  while (tiles.length > MAX_TILES && index > 0) {
    index--
    tiles = tilesAt(tiers[index], slide.tileSize, bounds)
  }
  return tiles
}

function tileUrl(tilerUrl: string, slideId: string, tile: Pick<PreviewTile, 'z' | 'x' | 'y'>): string {
  // The group number's only for static Zoomify files, and the tiler ignores it.
  return `${tilerUrl}/slides/${encodeURIComponent(slideId)}/TileGroup0/${tile.z}-${tile.x}-${tile.y}.jpg`
}

// Keeps the shape of what's being shown, within limits that fit a panel.
function previewSize(viewport: Viewport, pixelsWide: number): { width: number; height: number } {
  const [minX, minY, maxX, maxY] = viewport.extent
  const shape = (maxY - minY) / Math.max(maxX - minX, 1)
  return { width: pixelsWide, height: Math.round(pixelsWide * Math.min(Math.max(shape, 0.5), 1)) }
}

// How much to scale slide pixels by so the whole area fits.
function previewScale(viewport: Viewport, size: { width: number; height: number }): number {
  const [minX, minY, maxX, maxY] = viewport.extent
  return Math.min(size.width / Math.max(maxX - minX, 1), size.height / Math.max(maxY - minY, 1))
}

interface PreviewShapes {
  // In slide pixels, y going down.
  paths: { points: [number, number][]; closed: boolean; colour: string; width: number; dashed: boolean }[]
  dots: { x: number; y: number; colour: string }[]
}

// Anything that isn't a line, an area or a point is left out.
function shapesOf(features: Feature<Geometry>[]): PreviewShapes {
  const shapes: PreviewShapes = { paths: [], dots: [] }
  const flip = (coordinate: number[]): [number, number] => [coordinate[0], -coordinate[1]]
  for (const feature of features) {
    const colour = (feature.get('colour') as string | undefined) ?? DefaultColour
    const addPath = (coordinates: number[][], closed: boolean) => {
      if (shapes.paths.length >= MAX_PATHS) return
      shapes.paths.push({
        points: coordinates.map(flip),
        closed,
        colour,
        width: (feature.get('lineThickness') as number | undefined) ?? 2,
        dashed: feature.get('lineStyle') === 'dashed',
      })
    }
    const addDot = (coordinate: number[]) => {
      if (shapes.dots.length >= MAX_DOTS) return
      const [x, y] = flip(coordinate)
      shapes.dots.push({ x, y, colour })
    }
    const geometry = feature.getGeometry() as (Geometry & { getCoordinates?: () => unknown }) | undefined
    const coordinates = geometry?.getCoordinates?.()
    switch (geometry?.getType()) {
      case 'Point':
        addDot(coordinates as number[])
        break
      case 'MultiPoint':
        ;(coordinates as number[][]).forEach(addDot)
        break
      case 'LineString':
        addPath(coordinates as number[][], false)
        break
      case 'MultiLineString':
        ;(coordinates as number[][][]).forEach((line) => addPath(line, false))
        break
      case 'Polygon':
        ;(coordinates as number[][][]).forEach((ring) => addPath(ring, true))
        break
      case 'MultiPolygon':
        ;(coordinates as number[][][][]).forEach((polygon) => polygon.forEach((ring) => addPath(ring, true)))
        break
    }
  }
  return shapes
}

export { boundsOf, previewScale, previewSize, previewTiles, shapesOf, tiersOf, tileUrl }
export type { Bounds, PreviewShapes, PreviewTile, SlideInfo }
