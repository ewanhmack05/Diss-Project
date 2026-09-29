import { describe, expect, it } from 'vitest'
import LineString from 'ol/geom/LineString'
import Polygon from 'ol/geom/Polygon'
import type { Style } from 'ol/style'
import { annotationSketch, remoteSketchFeatures, type SketchLook } from './sketch'
import { geoJsonToFeature } from '../open-layers/GeoJSON'
import { penPosition, remoteSketchStyle } from '../open-layers/Styles'
import type { Participant } from './realtime'

const look: SketchLook = { shape: 'freehand', colour: '#FB0909', lineThickness: 3, lineStyle: 'dashed' }

function participant(overrides: Partial<Participant>): Participant {
  return {
    connectionId: 'c1',
    slideId: 's',
    userId: 'u1',
    displayName: 'Guest ab12',
    colour: '#e6194b',
    joined: '2026-09-29T00:00:00Z',
    viewport: null,
    sketch: null,
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
      participant({ connectionId: 'a', displayName: 'Guest a', colour: '#111111', sketch }),
      participant({ connectionId: 'b', sketch: null }),
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
    const [feature] = remoteSketchFeatures([participant({ sketch })])
    const styles = remoteSketchStyle(feature, 1) as Style[]
    const tag = styles.find((style) => style.getText())
    expect(tag?.getText()?.getText()).toBe('Guest ab12')
    expect(tag?.getText()?.getBackgroundFill()?.getColor()).toBe('#e6194b')
  })
})
