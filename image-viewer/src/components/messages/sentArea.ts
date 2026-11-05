import Feature from 'ol/Feature'
import type { Geometry } from 'ol/geom'
import Point from 'ol/geom/Point'
import Polygon from 'ol/geom/Polygon'
import { parseCellCountDots } from '../cell-count/CellCountDots'
import { geoJsonToFeature } from '../open-layers/GeoJSON'
import { viewportRing, type Viewport } from '../realtime/realtime'
import { DefaultColour } from '../annotation/Tools'
import type { SentRows } from './messages'

// Something sent, being looked at on the map. Nothing's saved - it's gone when
// you stop showing it.
interface ShownArea {
  messageId: string
  viewport: Viewport
  // An area keeps the turn it was sent with, since that's how it was seen. Rows
  // weren't seen any particular way, so they leave yours alone.
  keepRotation: boolean
  features: Feature<Geometry>[]
}

// How each feature is drawn - see sentAreaStyle and AreaPreview. Annotations have
// none: they're drawn as annotations are.
type SentPart = 'area' | 'region' | 'dot'

const REGION_COLOUR = '#00e0ff'

// From someone else's viewer, so these are checked before anything draws with them.
function safeColour(colour: unknown): string {
  return typeof colour === 'string' && /^#[0-9a-f]{3,8}$/i.test(colour) ? colour : DefaultColour
}

function safeNumber(value: unknown, min: number, max: number, otherwise: number): number {
  return isNumber(value) ? Math.min(Math.max(value, min), max) : otherwise
}

// A box this much bigger round what's sent, so it isn't jammed against the edges.
const PADDING = 0.15
// Round a single dot, in slide pixels, which has no size of its own.
const SMALLEST_SIDE = 200

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// It comes from someone else's viewer through a service that doesn't read it,
// so it's checked before the map is pointed at it.
function readArea(payload: unknown): Viewport | null {
  const area = payload as Partial<Viewport> | null
  if (!area || typeof area !== 'object') return null
  const { center, resolution, rotation, extent } = area
  if (!Array.isArray(center) || center.length !== 2 || !center.every(isNumber)) return null
  if (!Array.isArray(extent) || extent.length !== 4 || !extent.every(isNumber)) return null
  if (!isNumber(resolution) || resolution <= 0 || !isNumber(rotation)) return null
  if (extent[2] <= extent[0] || extent[3] <= extent[1]) return null
  return { center: [center[0], center[1]], resolution, rotation, extent: [extent[0], extent[1], extent[2], extent[3]] }
}

function readRows(payload: unknown): SentRows | null {
  const rows = payload as Partial<SentRows> | null
  if (!rows || typeof rows !== 'object') return null
  return {
    annotations: Array.isArray(rows.annotations) ? rows.annotations : [],
    cellCounts: Array.isArray(rows.cellCounts) ? rows.cellCounts : [],
    groups: Array.isArray(rows.groups) ? rows.groups : [],
    cellCountGroups: Array.isArray(rows.cellCountGroups) ? rows.cellCountGroups : [],
  }
}

// One that can't be read is left out rather than losing the rest.
function featureFrom(geoJson: string | undefined | null): Feature<Geometry> | null {
  if (!geoJson) return null
  try {
    return geoJsonToFeature(geoJson)
  } catch {
    return null
  }
}

// The shapes to draw: annotations, and each count's box and dots.
function featuresOf(rows: SentRows): Feature<Geometry>[] {
  const features: Feature<Geometry>[] = []
  for (const annotation of rows.annotations) {
    const feature = featureFrom(annotation.geoJson)
    if (!feature) continue
    feature.setProperties({
      colour: safeColour(annotation.colour),
      lineThickness: safeNumber(annotation.lineThickness, 1, 6, 2),
      lineStyle: annotation.lineStyle === 'dashed' ? 'dashed' : 'solid',
      shape: annotation.shape,
    })
    features.push(feature)
  }
  for (const count of rows.cellCounts) {
    const region = featureFrom(count.regionOfInterest?.geoJson)
    if (region) {
      region.setProperties({ part: 'region' satisfies SentPart, colour: REGION_COLOUR, lineStyle: 'dashed', lineThickness: 2 })
      features.push(region)
    }
    const dotSize = safeNumber(count.dotSize, 1, 20, 6)
    for (const dot of parseCellCountDots(count.dots)) {
      if (isNumber(dot.x) && isNumber(dot.y)) {
        features.push(new Feature({ geometry: new Point([dot.x, dot.y]), part: 'dot' satisfies SentPart, colour: safeColour(dot.colour), dotSize }))
      }
    }
  }
  return features
}

// Everything in a box round the lot, with some room. Resolution is left for the
// map to work out from its own size - see followView.
function viewportRound(features: Feature<Geometry>[]): Viewport | null {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const feature of features) {
    const extent = feature.getGeometry()?.getExtent()
    if (!extent) continue
    minX = Math.min(minX, extent[0])
    minY = Math.min(minY, extent[1])
    maxX = Math.max(maxX, extent[2])
    maxY = Math.max(maxY, extent[3])
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null
  const center: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2]
  const halfWidth = (Math.max(maxX - minX, SMALLEST_SIDE) * (1 + PADDING)) / 2
  const halfHeight = (Math.max(maxY - minY, SMALLEST_SIDE) * (1 + PADDING)) / 2
  return { center, resolution: 1, rotation: 0, extent: [center[0] - halfWidth, center[1] - halfHeight, center[0] + halfWidth, center[1] + halfHeight] }
}

// What a sent area shows: its box.
function shownFromArea(messageId: string, payload: unknown): ShownArea | null {
  const viewport = readArea(payload)
  if (!viewport) return null
  return { messageId, viewport, keepRotation: true, features: [new Feature({ geometry: new Polygon([viewportRing(viewport)]), part: 'area' satisfies SentPart })] }
}

// What sent rows show: the rows themselves, without adding them to anything.
function shownFromRows(messageId: string, payload: unknown): ShownArea | null {
  const rows = readRows(payload)
  if (!rows) return null
  const features = featuresOf(rows)
  const viewport = viewportRound(features)
  return viewport ? { messageId, viewport, keepRotation: false, features } : null
}

export { readArea, readRows, shownFromArea, shownFromRows }
export type { SentPart, ShownArea }
