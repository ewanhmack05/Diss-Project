import { describe, expect, it } from 'vitest'
import type { Annotation } from '../../interfaces/Annotation'
import type { CellCount } from '../../interfaces/CellCount'
import { collectionToGeoJson, exportFileName, parseImport, type FullCollection } from './collectionGeoJson'

const stored = (geometry: unknown) => JSON.stringify({ type: 'Feature', geometry, properties: null })

const square = [
  [10, -10],
  [20, -10],
  [20, -20],
  [10, -20],
  [10, -10],
]

const annotation: Annotation = {
  id: 'a1',
  label: 'Tumour edge',
  notes: 'check this',
  colour: '#FB0909',
  shape: 'rectangle',
  lineStyle: 'dashed',
  lineThickness: 4,
  geoJson: stored({ type: 'Polygon', coordinates: [square] }),
  groupId: 'g1',
  created: '2026-10-01T00:00:00.000Z',
  createdByName: 'Alice',
}

const cellCount: CellCount = {
  id: 'c1',
  label: 'Mitoses',
  notes: '',
  dots: JSON.stringify([
    { x: 12, y: -14, colour: '#0913FB' },
    { x: 15, y: -16, colour: '#FB0909', placedBy: { userId: 'bob', name: 'Bob' } },
  ]),
  withAnnotation: true,
  withRoi: true,
  count: 2,
  dotSize: 8,
  locationX: 15,
  locationY: -15,
  regionOfInterest: { id: 'r1', geoJson: stored({ type: 'Polygon', coordinates: [square] }), created: '' },
  created: '2026-10-01T00:00:00.000Z',
}

const collection: FullCollection = {
  collectionId: 'col',
  slideId: '003',
  collectionName: "Alice's collection",
  annotations: [annotation],
  cellCounts: [cellCount],
  groups: [{ id: 'g1', name: 'Tumour', notes: 'margins clear' }],
}

describe('collectionToGeoJson', () => {
  it('writes annotations and cell counts with y going down', () => {
    const out = collectionToGeoJson(collection, new Date('2026-10-14T00:00:00Z'))

    expect(out.type).toBe('FeatureCollection')
    expect(out.name).toBe("Alice's collection")
    expect(out.features).toHaveLength(2)
    const [shape, count] = out.features
    expect(shape.geometry).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [10, 10],
          [20, 10],
          [20, 20],
          [10, 20],
          [10, 10],
        ],
      ],
    })
    expect(shape.properties).toMatchObject({ objectType: 'annotation', name: 'Tumour edge', shape: 'rectangle', group: 'Tumour' })
    expect(count.geometry).toEqual({
      type: 'MultiPoint',
      coordinates: [
        [12, 14],
        [15, 16],
      ],
    })
    expect(count.properties).toMatchObject({
      objectType: 'cellCount',
      count: 2,
      dotColours: ['#0913FB', '#FB0909'],
      location: [15, 15],
    })
  })

  it('gives a count without dots no geometry', () => {
    const out = collectionToGeoJson({ ...collection, annotations: [], cellCounts: [{ ...cellCount, dots: '[]', count: 5 }] })
    expect(out.features[0].geometry).toBeNull()
    expect(out.features[0].properties?.count).toBe(5)
  })
})

describe('parseImport', () => {
  it('reads back what it exported', () => {
    const file = JSON.stringify(collectionToGeoJson(collection))
    const parsed = parseImport(file)

    expect(parsed.skipped).toEqual([])
    const [shape] = parsed.annotations
    expect(shape).toMatchObject({
      label: 'Tumour edge',
      notes: 'check this',
      colour: '#FB0909',
      shape: 'rectangle',
      lineStyle: 'dashed',
      lineThickness: 4,
    })
    expect(JSON.parse(shape.geoJson).geometry).toEqual({ type: 'Polygon', coordinates: [square] })
    expect(shape.id).not.toBe('a1')
    expect(parsed.groups).toEqual([{ name: 'Tumour', annotationIds: [shape.id], notes: 'margins clear' }])

    const [count] = parsed.cellCounts
    expect(JSON.parse(count.dots!)).toEqual(JSON.parse(cellCount.dots!))
    expect(count).toMatchObject({ label: 'Mitoses', count: 2, dotSize: 8, withRoi: true, locationX: 15, locationY: -15 })
    expect(JSON.parse(count.regionOfInterest!.geoJson).geometry).toEqual({ type: 'Polygon', coordinates: [square] })
  })

  it('reads a QuPath-style file', () => {
    const file = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[0, 0], [5, 5], [9, 2]] },
          properties: { classification: { name: 'Stroma', color: [22, 131, 4] } },
        },
        {
          type: 'Feature',
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [[[0, 0], [1, 0], [1, 1], [0, 0]]],
              [[[5, 5], [6, 5], [6, 6], [5, 5]]],
            ],
          },
          properties: { name: 'Islands' },
        },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [3, 4] }, properties: {} },
      ],
    })
    const parsed = parseImport(file)

    expect(parsed.annotations).toHaveLength(3)
    expect(parsed.annotations[0]).toMatchObject({ label: 'Stroma', colour: '#168304', shape: 'freehand' })
    expect(JSON.parse(parsed.annotations[0].geoJson).geometry.coordinates).toEqual([
      [0, 0],
      [5, -5],
      [9, -2],
    ])
    expect(parsed.annotations.slice(1).map((a) => a.label)).toEqual(['Islands', 'Islands'])
    expect(parsed.cellCounts).toHaveLength(1)
    expect(JSON.parse(parsed.cellCounts[0].dots!)).toEqual([{ x: 3, y: -4, colour: '#F9E006' }])
  })

  it('leaves a file already in map space alone', () => {
    const file = JSON.stringify({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[1, -1], [2, -2]] }, properties: {} })
    const [line] = parseImport(file).annotations
    expect(line.shape).toBe('line')
    expect(JSON.parse(line.geoJson).geometry.coordinates).toEqual([
      [1, -1],
      [2, -2],
    ])
  })

  it('skips what it cannot use, and says why', () => {
    const file = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'GeometryCollection', geometries: [] }, properties: {} },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[1, 'x']] }, properties: {} },
        { type: 'Feature', geometry: null, properties: {} },
      ],
    })
    const parsed = parseImport(file)
    expect(parsed.annotations).toEqual([])
    expect(parsed.skipped.map((s) => s.index)).toEqual([0, 1, 2])
  })

  it('throws on something that is not GeoJSON', () => {
    expect(() => parseImport('not json')).toThrow()
    expect(() => parseImport('{"type":"Polygon"}')).toThrow()
  })
})

describe('exportFileName', () => {
  it('takes out characters a file name cannot have', () => {
    expect(exportFileName({ collectionName: 'A/B: "x"', slideId: '003' })).toBe('AB x - 003.geojson')
  })
})
