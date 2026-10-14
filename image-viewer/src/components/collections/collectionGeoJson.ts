import type { Annotation } from '../../interfaces/Annotation'
import type { CellCount, CellCountDot, DotPlacer } from '../../interfaces/CellCount'
import { DefaultColour, LineThicknessOptions, ShapeTools, type LineStyleName, type ShapeTool } from '../annotation/Tools'
import { parseCellCountDots } from '../cell-count/CellCountDots'
import { newId } from '../../newId'

// GeoJSON in and out of a collection. Files use the slide's own pixels with
// y going down from the top left - what QuPath and most slide tools use.
// The map has y going up (see OpenLayers.ts getExtent), so y flips both ways.

type Position = number[]

type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'MultiPoint'; coordinates: Position[] }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] }

interface GeoFeature {
  type: 'Feature'
  id?: string
  geometry: Geometry | null
  properties: Record<string, unknown> | null
}

interface GeoFeatureCollection {
  type: 'FeatureCollection'
  name?: string
  slideId?: string
  exported?: string
  // The collection's groups, for their notes - which annotation is in which
  // is on each feature, as properties.group.
  groups?: { name: string; notes: string }[]
  features: GeoFeature[]
}

// GET /collections/{id}/export - its annotations and cell counts, dots included.
interface FullCollection {
  collectionId: string
  slideId: string
  collectionName: string
  annotations: Annotation[]
  cellCounts: CellCount[]
  groups?: { id: string; name: string; notes?: string }[]
}

// What came out of a file, ready to send to POST /collections/{id}/import.
interface ParsedImport {
  annotations: Annotation[]
  cellCounts: CellCount[]
  // Annotations that were in a group, by its name - annotation-store puts
  // them in the collection's group of that name, making it if need be.
  groups: { name: string; annotationIds: string[]; notes?: string }[]
  // Features that couldn't be used, and why - for the preview.
  skipped: { index: number; reason: string }[]
}

const flipPosition = ([x, y]: Position): Position => [x, y === 0 ? 0 : -y]

function flipGeometry(geometry: Geometry): Geometry {
  switch (geometry.type) {
    case 'Point':
      return { type: 'Point', coordinates: flipPosition(geometry.coordinates) }
    case 'MultiPoint':
    case 'LineString':
      return { type: geometry.type, coordinates: geometry.coordinates.map(flipPosition) }
    case 'MultiLineString':
    case 'Polygon':
      return { type: geometry.type, coordinates: geometry.coordinates.map((part) => part.map(flipPosition)) }
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(flipPosition))),
      }
  }
}

function storedGeometry(geoJson: string): Geometry | null {
  try {
    const parsed = JSON.parse(geoJson) as { type?: string; geometry?: Geometry }
    return parsed.type === 'Feature' ? (parsed.geometry ?? null) : (parsed as Geometry)
  } catch {
    return null
  }
}

// As the map saves it - see open-layers/GeoJSON's featureToGeoJson.
const toStored = (geometry: Geometry) => JSON.stringify({ type: 'Feature', geometry, properties: null })

function annotationFeature(annotation: Annotation, groupNames: Map<string, string>): GeoFeature {
  const geometry = storedGeometry(annotation.geoJson)
  return {
    type: 'Feature',
    id: annotation.id,
    geometry: geometry && flipGeometry(geometry),
    properties: {
      objectType: 'annotation',
      // name is what QuPath shows.
      name: annotation.label,
      label: annotation.label,
      notes: annotation.notes,
      colour: annotation.colour,
      shape: annotation.shape,
      lineStyle: annotation.lineStyle,
      lineThickness: annotation.lineThickness,
      group: (annotation.groupId && groupNames.get(annotation.groupId)) || null,
      created: annotation.created,
      createdBy: annotation.createdByName ?? null,
    },
  }
}

// The dots as one MultiPoint, with each one's colour (and who placed it,
// for a shared count) alongside in the same order. A count made without
// dots has no geometry, just its count.
function cellCountFeature(cellCount: CellCount): GeoFeature {
  const dots = parseCellCountDots(cellCount.dots)
  const roi = cellCount.regionOfInterest ? storedGeometry(cellCount.regionOfInterest.geoJson) : null
  return {
    type: 'Feature',
    id: cellCount.id,
    geometry: dots.length > 0 ? flipGeometry({ type: 'MultiPoint', coordinates: dots.map((d) => [d.x, d.y]) }) : null,
    properties: {
      objectType: 'cellCount',
      name: cellCount.label,
      label: cellCount.label,
      notes: cellCount.notes,
      count: cellCount.count,
      dotSize: cellCount.dotSize,
      dotColours: dots.map((d) => d.colour),
      dotPlacedBy: dots.some((d) => d.placedBy) ? dots.map((d) => d.placedBy ?? null) : undefined,
      location:
        cellCount.locationX !== null && cellCount.locationY !== null
          ? flipPosition([cellCount.locationX, cellCount.locationY])
          : null,
      regionOfInterest: roi && flipGeometry(roi),
      created: cellCount.created,
      createdBy: cellCount.createdByName ?? null,
    },
  }
}

function collectionToGeoJson(collection: FullCollection, now = new Date()): GeoFeatureCollection {
  const groupNames = new Map((collection.groups ?? []).map((g) => [g.id, g.name]))
  return {
    type: 'FeatureCollection',
    name: collection.collectionName,
    slideId: collection.slideId,
    exported: now.toISOString(),
    groups: (collection.groups ?? []).map((g) => ({ name: g.name, notes: g.notes ?? '' })),
    features: [
      ...collection.annotations.map((a) => annotationFeature(a, groupNames)),
      ...collection.cellCounts.map(cellCountFeature),
    ],
  }
}

// Something safe to save as, e.g. "Alice's collection - 003.geojson".
function exportFileName(collection: Pick<FullCollection, 'collectionName' | 'slideId'>): string {
  const clean = (text: string) => text.replace(/[\\/:*?"<>|]+/g, '').trim()
  return `${clean(collection.collectionName) || 'collection'} - ${clean(collection.slideId)}.geojson`
}

// Import

const isPosition = (value: unknown): value is Position =>
  Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])

const isPositions = (value: unknown, min: number): value is Position[] =>
  Array.isArray(value) && value.length >= min && value.every(isPosition)

const isRings = (value: unknown): value is Position[][] =>
  Array.isArray(value) && value.length > 0 && value.every((ring) => isPositions(ring, 4))

// Null if it's not a geometry this can use, or its coordinates are broken.
function validGeometry(value: unknown): Geometry | null {
  if (!value || typeof value !== 'object') return null
  const { type, coordinates } = value as { type?: unknown; coordinates?: unknown }
  switch (type) {
    case 'Point':
      return isPosition(coordinates) ? { type, coordinates } : null
    case 'MultiPoint':
      return isPositions(coordinates, 1) ? { type, coordinates } : null
    case 'LineString':
      return isPositions(coordinates, 2) ? { type, coordinates } : null
    case 'MultiLineString':
      return Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every((l) => isPositions(l, 2))
        ? { type, coordinates }
        : null
    case 'Polygon':
      return isRings(coordinates) ? { type, coordinates } : null
    case 'MultiPolygon':
      return Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(isRings)
        ? { type, coordinates }
        : null
    default:
      return null
  }
}

function allPositions(geometry: Geometry): Position[] {
  switch (geometry.type) {
    case 'Point':
      return [geometry.coordinates]
    case 'MultiPoint':
    case 'LineString':
      return geometry.coordinates
    case 'MultiLineString':
    case 'Polygon':
      return geometry.coordinates.flat()
    case 'MultiPolygon':
      return geometry.coordinates.flat(2)
  }
}

const HEX = /^#[0-9a-f]{6}$/i

function hexColour(value: unknown): string | null {
  if (typeof value === 'string' && HEX.test(value)) return value
  // QuPath's classification colour is [r, g, b].
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every((n) => Number.isInteger(n) && n >= 0 && n <= 255))
    return `#${value
      .slice(0, 3)
      .map((n: number) => n.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()}`
  return null
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

function labelOf(properties: Record<string, unknown>, fallback: string): string {
  const classification = properties.classification as { name?: unknown } | undefined
  return (text(properties.label) || text(properties.name) || text(classification?.name) || fallback).trim().slice(0, 200)
}

function colourOf(properties: Record<string, unknown>): string {
  const classification = properties.classification as { color?: unknown; colour?: unknown } | undefined
  return (
    hexColour(properties.colour) ??
    hexColour(properties.color) ??
    hexColour(classification?.colour) ??
    hexColour(classification?.color) ??
    DefaultColour
  )
}

const POLYGON_SHAPES: ShapeTool[] = ['polygon', 'rectangle', 'circle']
const LINE_SHAPES: ShapeTool[] = ['line', 'arrow', 'freehand']

// Keeps a shape that came out of here, as long as it fits the geometry.
function shapeOf(properties: Record<string, unknown>, geometry: Geometry): ShapeTool {
  const named = properties.shape as ShapeTool
  if (geometry.type === 'Polygon') return POLYGON_SHAPES.includes(named) ? named : 'polygon'
  if (LINE_SHAPES.includes(named) && (named === 'freehand' || geometry.coordinates.length === 2)) return named
  return geometry.coordinates.length === 2 ? 'line' : 'freehand'
}

function annotationFrom(properties: Record<string, unknown>, geometry: Geometry & { type: 'LineString' | 'Polygon' }, now: string): Annotation {
  const shape = shapeOf(properties, geometry)
  const thickness = Number(properties.lineThickness)
  return {
    id: newId(),
    label: labelOf(properties, `Imported ${ShapeTools[shape].label.toLowerCase()}`),
    notes: text(properties.notes),
    colour: colourOf(properties),
    shape,
    lineStyle: (properties.lineStyle === 'dashed' ? 'dashed' : 'solid') as LineStyleName,
    lineThickness: LineThicknessOptions.includes(thickness) ? thickness : 2,
    geoJson: toStored(geometry),
    created: now,
  }
}

function cellCountFrom(
  properties: Record<string, unknown>,
  points: Position[],
  now: string,
  toMap: (geometry: Geometry) => Geometry
): CellCount {
  const colours = Array.isArray(properties.dotColours) ? properties.dotColours : []
  const placedBy = Array.isArray(properties.dotPlacedBy) ? (properties.dotPlacedBy as (DotPlacer | null)[]) : []
  const fallbackColour = colourOf(properties)
  const dots: CellCountDot[] = points.map(([x, y], i) => {
    const dot: CellCountDot = { x, y, colour: hexColour(colours[i]) ?? fallbackColour }
    const placer = placedBy[i]
    if (placer && typeof placer.userId === 'string' && typeof placer.name === 'string')
      dot.placedBy = { userId: placer.userId, name: placer.name }
    return dot
  })
  const roi = validGeometry(properties.regionOfInterest)
  const location = isPosition(properties.location)
    ? (toMap({ type: 'Point', coordinates: properties.location }).coordinates as Position)
    : null
  const count = Number(properties.count)
  const dotSize = Number(properties.dotSize)
  return {
    id: newId(),
    label: labelOf(properties, 'Imported count'),
    notes: text(properties.notes),
    dots: JSON.stringify(dots),
    withAnnotation: dots.length > 0,
    withRoi: roi?.type === 'Polygon',
    count: Number.isInteger(count) && count >= dots.length ? count : dots.length,
    dotSize: Number.isInteger(dotSize) && dotSize > 0 ? dotSize : 6,
    locationX: location?.[0] ?? null,
    locationY: location?.[1] ?? null,
    regionOfInterest:
      roi?.type === 'Polygon' ? { id: newId(), geoJson: toStored(toMap(roi)), created: now } : null,
    created: now,
  }
}

function featuresOf(json: unknown): unknown[] | null {
  if (!json || typeof json !== 'object') return null
  const { type, features } = json as { type?: unknown; features?: unknown }
  if (type === 'FeatureCollection' && Array.isArray(features)) return features
  if (type === 'Feature') return [json]
  return null
}

// Most files have y going down, as exported from here. One where nothing is
// below 0 but something is above it is already in the map's y-up space - a
// raw dump of what the map saves - so it's left alone.
function needsFlip(geometries: Geometry[]): boolean {
  let anyPositive = false
  let anyNegative = false
  for (const geometry of geometries)
    for (const [, y] of allPositions(geometry)) {
      if (y > 0) anyPositive = true
      if (y < 0) anyNegative = true
    }
  return anyPositive || !anyNegative
}

// Annotations from lines and polygons (each part of a Multi- on its own),
// cell counts from points, or anything marked as a cell count. Throws if
// it isn't GeoJSON at all.
function parseImport(fileText: string, now = new Date()): ParsedImport {
  let json: unknown
  try {
    json = JSON.parse(fileText)
  } catch {
    throw new Error("This file isn't valid JSON")
  }
  const features = featuresOf(json)
  if (!features) throw new Error("This file isn't a GeoJSON Feature or FeatureCollection")

  const created = now.toISOString()
  const result: ParsedImport = { annotations: [], cellCounts: [], groups: [], skipped: [] }
  const grouped = new Map<string, string[]>()
  const addAnnotation = (properties: Record<string, unknown>, geometry: Geometry & { type: 'LineString' | 'Polygon' }) => {
    const annotation = annotationFrom(properties, geometry, created)
    result.annotations.push(annotation)
    const group = text(properties.group).trim().slice(0, 64)
    if (group) grouped.set(group, [...(grouped.get(group) ?? []), annotation.id])
  }
  const readable = features.map((feature) => {
    const { geometry, properties } = (feature ?? {}) as { geometry?: unknown; properties?: unknown }
    return {
      geometry: validGeometry(geometry),
      raw: geometry,
      properties: (properties && typeof properties === 'object' ? properties : {}) as Record<string, unknown>,
    }
  })
  const flip = needsFlip(readable.flatMap((f) => (f.geometry ? [f.geometry] : [])))
  const toMap = (geometry: Geometry) => (flip ? flipGeometry(geometry) : geometry)

  readable.forEach(({ geometry, raw, properties }, index) => {
    const isCount = properties.objectType === 'cellCount'
    // A count saved without dots has no geometry, just its number.
    if (isCount && raw === null) {
      result.cellCounts.push(cellCountFrom(properties, [], created, toMap))
      return
    }
    if (!geometry) {
      const type = raw && typeof raw === 'object' ? (raw as { type?: unknown }).type : null
      result.skipped.push({
        index,
        reason: typeof type === 'string' ? `${type} isn't supported, or its coordinates are broken` : 'No geometry',
      })
      return
    }
    const onMap = toMap(geometry)
    if (onMap.type === 'Point' || onMap.type === 'MultiPoint') {
      result.cellCounts.push(cellCountFrom(properties, allPositions(onMap), created, toMap))
    } else if (onMap.type === 'LineString' || onMap.type === 'Polygon') {
      addAnnotation(properties, onMap)
    } else if (onMap.type === 'MultiLineString') {
      for (const coordinates of onMap.coordinates) addAnnotation(properties, { type: 'LineString', coordinates })
    } else {
      for (const coordinates of onMap.coordinates) addAnnotation(properties, { type: 'Polygon', coordinates })
    }
  })
  // Notes come from the file's own list of groups, if it has one.
  const listed = (json as { groups?: unknown }).groups
  const notesByName = new Map<string, string>()
  if (Array.isArray(listed))
    for (const g of listed as { name?: unknown; notes?: unknown }[])
      if (typeof g?.name === 'string' && typeof g.notes === 'string' && g.notes.trim())
        notesByName.set(g.name.trim(), g.notes.slice(0, 10_000))
  result.groups = [...grouped].map(([name, annotationIds]) => ({ name, annotationIds, notes: notesByName.get(name) }))
  return result
}

export { collectionToGeoJson, exportFileName, parseImport }
export type { FullCollection, ParsedImport, GeoFeatureCollection }
