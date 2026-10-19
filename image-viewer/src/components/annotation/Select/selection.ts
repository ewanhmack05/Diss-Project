import type Feature from 'ol/Feature'
import type Geometry from 'ol/geom/Geometry'
import type Polygon from 'ol/geom/Polygon'
import SimpleGeometry from 'ol/geom/SimpleGeometry'
import type { Coordinate } from 'ol/coordinate'
import { containsExtent } from 'ol/extent'

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

function isTyping(tagName: string | undefined): boolean {
  return TYPING_TAGS.has(tagName ?? '')
}

// Space moves the map instead of picking, but only with the pointer over
// the map - anywhere else it's left alone, so it still presses a focused
// button or types a space.
function isPanKey(code: string, tagName: string | undefined, overMap: boolean): boolean {
  return code === 'Space' && overMap && !isTyping(tagName)
}

function allCoordinates(geometry: Geometry): Coordinate[] {
  if (!(geometry instanceof SimpleGeometry)) return []
  const flat = geometry.getFlatCoordinates()
  const stride = geometry.getStride()
  const coordinates: Coordinate[] = []
  for (let i = 0; i < flat.length; i += stride) coordinates.push([flat[i], flat[i + 1]])
  return coordinates
}

// Fully inside - every point of the shape is in the area. Its box has to fit
// first, which rules most things out cheaply. A lasso that curls back in
// could still have a shape's edge poke out between two points that are
// both inside - close enough for picking by hand.
function isInside(geometry: Geometry, area: Polygon): boolean {
  if (!containsExtent(area.getExtent(), geometry.getExtent())) return false
  const coordinates = allCoordinates(geometry)
  return coordinates.length > 0 && coordinates.every((c) => area.intersectsCoordinate(c))
}

// The ids of the features fully inside the area.
function idsInside(features: Feature<Geometry>[], area: Polygon): string[] {
  const ids: string[] = []
  for (const feature of features) {
    const geometry = feature.getGeometry()
    if (geometry && isInside(geometry, area)) ids.push(String(feature.getId()))
  }
  return ids
}

// The shape a click is on - inside a polygon, or within tolerance (map
// units) of a line. The smallest wins, so a shape drawn inside a bigger
// one can still be clicked.
function featureAt(features: Feature<Geometry>[], coordinate: Coordinate, tolerance: number): Feature<Geometry> | null {
  let best: Feature<Geometry> | null = null
  let bestSize = Infinity
  for (const feature of features) {
    const geometry = feature.getGeometry()
    if (!geometry) continue
    const [minX, minY, maxX, maxY] = geometry.getExtent()
    if (
      coordinate[0] < minX - tolerance ||
      coordinate[0] > maxX + tolerance ||
      coordinate[1] < minY - tolerance ||
      coordinate[1] > maxY + tolerance
    )
      continue
    const [x, y] = geometry.getClosestPoint(coordinate)
    const near = Math.hypot(x - coordinate[0], y - coordinate[1]) <= tolerance
    if (!near && !geometry.intersectsCoordinate(coordinate)) continue
    const size = (maxX - minX) * (maxY - minY)
    if (size < bestSize) {
      best = feature
      bestSize = size
    }
  }
  return best
}

export { isInside, idsInside, featureAt, isTyping, isPanKey }
