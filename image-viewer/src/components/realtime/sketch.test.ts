import { describe, expect, it } from 'vitest'
import LineString from 'ol/geom/LineString'
import Polygon from 'ol/geom/Polygon'
import type { Style } from 'ol/style'
import { annotationSketch, remoteSketchFeatures, rulerSketch, remoteRulerFeatures, cellCountSketch, remoteCellCountFeatures, type SketchLook } from './sketch'
import { featureToGeoJson, geoJsonToFeature } from '../open-layers/GeoJSON'
import { penPosition, remoteCellCountStyle, remoteRulerStyle, remoteSketchStyle } from '../open-layers/Styles'
import type { Participant, Sketch } from './realtime'

// Someone's sketches, keyed by tool the way the hub keeps them.
const sketching = (...sketches: Sketch[]): Participant['sketches'] =>
  Object.fromEntries(sketches.map((sketch) => [sketch.tool, sketch]))

const look: SketchLook = { shape: 'freehand', colour: '#FB0909', lineThickness: 3, lineStyle: 'dashed' }

function participant(overrides: Partial<Participant>): Participant {
  return {
    connectionId: 'c1',
    roomId: 's',
    userId: 'u1',
    displayName: 'Guest ab12',
    colour: '#e6194b',
    joined: '2026-09-29T00:00:00Z',
    viewport: null,
    sketches: null,
    host: false,
    canEdit: true,
    screen: null,
    ...overrides,
  }
}

describe('annotationSketch', () => {
  it('keeps the look and round-trips the shape', () => {
    const sketch = annotationSketch(new LineString([[0, 0], [100, 50]]), look, 1)
    expect(sketch.tool).toBe('annotation')
    expect(sketch.data).toMatchObject(look)
    const geometry = geoJsonToFeature(sketch.data.geoJson).getGeometry() as LineString
    expect(geometry.getCoordinates()).toEqual([[0, 0], [100, 50]])
  })

  it('drops freehand points too close together to see at this zoom', () => {
    // 2000 points along a line with sub-pixel wobble at resolution 4.
    const points = Array.from({ length: 2000 }, (_, i) => [i, i % 2 === 0 ? 0 : 0.5])
    const sketch = annotationSketch(new LineString(points), look, 4)
    const sent = geoJsonToFeature(sketch.data.geoJson).getGeometry() as LineString

    expect(sent.getCoordinates().length).toBeLessThan(10)
    expect(sent.getFirstCoordinate()).toEqual([0, 0])
    expect(sent.getLastCoordinate()).toEqual([1999, 0.5])
    // Well under the hub's per-message limit.
    expect(sketch.data.geoJson.length).toBeLessThan(1000)
  })

  it('keeps a polygon a polygon', () => {
    const square = new Polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]])
    const sketch = annotationSketch(square, { ...look, shape: 'polygon' }, 1)
    expect(geoJsonToFeature(sketch.data.geoJson).getGeometry()).toBeInstanceOf(Polygon)
  })
})

describe('remoteSketchFeatures', () => {
  it('makes one feature per person drawing, tagged with who it is', () => {
    const sketch = annotationSketch(new LineString([[0, 0], [5, 5]]), look, 1)
    const features = remoteSketchFeatures([
      participant({ connectionId: 'a', displayName: 'Guest a', colour: '#111111', sketches: sketching(sketch) }),
      participant({ connectionId: 'b', sketches: null }),
    ])

    expect(features).toHaveLength(1)
    const [feature] = features
    expect(feature.get('owner')).toBe('Guest a')
    expect(feature.get('ownerColour')).toBe('#111111')
    expect(feature.get('colour')).toBe('#FB0909')
    expect(feature.get('lineStyle')).toBe('dashed')
    expect(feature.get('geoJson')).toBeUndefined()
  })
})

describe('penPosition', () => {
  it('is the end of a line', () => {
    expect(penPosition(new LineString([[0, 0], [3, 4], [7, 1]]))).toEqual([7, 1])
  })

  it("is a polygon's last corner before it closes", () => {
    expect(penPosition(new Polygon([[[0, 0], [5, 0], [5, 5], [0, 0]]]))).toEqual([5, 5])
  })

  it('is nothing for no geometry', () => {
    expect(penPosition(undefined)).toBeUndefined()
  })
})

describe('remoteSketchStyle', () => {
  it("adds the owner's name tag on top of the annotation's own style", () => {
    const sketch = annotationSketch(new LineString([[0, 0], [5, 5]]), look, 1)
    const [feature] = remoteSketchFeatures([participant({ sketches: sketching(sketch) })])
    const styles = remoteSketchStyle(feature, 1) as Style[]
    const tag = styles.find((style) => style.getText())
    expect(tag?.getText()?.getText()).toBe('Guest ab12')
    expect(tag?.getText()?.getBackgroundFill()?.getColor()).toBe('#e6194b')
  })
})

describe('rulerSketch', () => {
  it('sends the two ends and whether it is done', () => {
    expect(rulerSketch([[1, 2], [30, 40]], false)).toEqual({ tool: 'ruler', data: { from: [1, 2], to: [30, 40], done: false } })
    expect(rulerSketch([[1, 2], [5, 5], [30, 40]], true)?.data).toMatchObject({ from: [1, 2], to: [30, 40], done: true })
  })

  it('sends nothing before there are two points', () => {
    expect(rulerSketch([[1, 2]], false)).toBeNull()
  })
})

describe('remoteRulerFeatures', () => {
  it('makes a line for each person measuring, and skips annotation sketches', () => {
    const ruler = rulerSketch([[0, 0], [10, 0]], true)!
    const features = remoteRulerFeatures([
      participant({ displayName: 'Bob', sketches: sketching(ruler) }),
      participant({ connectionId: 'c2', sketches: sketching(annotationSketch(new LineString([[0, 0], [1, 1]]), look, 1)) }),
      participant({ connectionId: 'c3' }),
    ])
    expect(features).toHaveLength(1)
    expect(features[0].getGeometry()!.getCoordinates()).toEqual([[0, 0], [10, 0]])
    expect(features[0].get('owner')).toBe('Bob')
    expect(features[0].get('done')).toBe(true)
  })

  it('labels the distance and the person', () => {
    const [feature] = remoteRulerFeatures([participant({ displayName: 'Bob', sketches: sketching(rulerSketch([[0, 0], [3, 4]], false)!) })])
    const styles = remoteRulerStyle(null, null)(feature) as Style[]
    expect(styles[0].getText()?.getText()).toBe('5 px')
    expect(styles[0].getStroke()?.getLineDash()).toEqual([6, 4])
    expect(styles[1].getText()?.getText()).toBe('Bob')
  })
})

describe('remoteCellCountFeatures', () => {
  const roi = geoJsonToFeature(JSON.stringify({ type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] }))

  it('draws the host count dots and labels their box', () => {
    const sketch = cellCountSketch(
      [{ x: 1, y: 2, colour: '#ff0000', placedBy: { userId: 'u', name: 'U' } }, { x: 3, y: 4, colour: '#00ff00' }],
      5,
      7,
      featureToGeoJson(roi),
    )
    expect(sketch.data).toEqual({
      dots: [{ x: 1, y: 2, colour: '#ff0000' }, { x: 3, y: 4, colour: '#00ff00' }],
      dotSize: 5,
      count: 7,
      roiGeoJson: featureToGeoJson(roi),
    })

    const features = remoteCellCountFeatures([participant({ displayName: 'Carol', sketches: sketching(sketch) })])
    expect(features.map((f) => f.get('kind'))).toEqual(['dot', 'dot', 'roi'])
    expect(features[0].get('colour')).toBe('#ff0000')
    expect(features[0].get('dotSize')).toBe(5)
    const label = (remoteCellCountStyle(features[2]) as Style[])[1].getText()?.getText()
    expect(label).toBe('Carol · 7')
  })

  it('has no box without an ROI, and skips other sketches', () => {
    const features = remoteCellCountFeatures([
      participant({ sketches: sketching(cellCountSketch([{ x: 1, y: 1, colour: '#fff' }], 6, 1, null)) }),
      participant({ connectionId: 'c2', sketches: sketching(rulerSketch([[0, 0], [1, 1]], true)!) }),
    ])
    expect(features.map((f) => f.get('kind'))).toEqual(['dot'])
  })
})

describe('one sketch per tool', () => {
  it('keeps someone measuring, counting and drawing all at once', () => {
    const someone = participant({
      sketches: sketching(
        annotationSketch(new LineString([[0, 0], [5, 5]]), look, 1),
        rulerSketch([[0, 0], [10, 0]], true)!,
        cellCountSketch([{ x: 1, y: 1, colour: '#fff' }], 6, 1, null),
      ),
    })
    expect(remoteSketchFeatures([someone])).toHaveLength(1)
    expect(remoteRulerFeatures([someone])).toHaveLength(1)
    expect(remoteCellCountFeatures([someone])).toHaveLength(1)
  })
})
