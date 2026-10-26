import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import type Layer from 'ol/layer/Layer'
import VectorLayer from 'ol/layer/Vector'
import WebGLVectorLayer from 'ol/layer/WebGLVector'
import VectorSource from 'ol/source/Vector'
import { describe, expect, it } from 'vitest'
import { translatePending } from './TranslatePending'

// What Translate uses to pick the layers and features it hit-tests on
// pointerdown - not public, but it's exactly what went wrong.
type Picking = {
  layerFilter_: (layer: Layer) => boolean
  filter_: (feature: Feature, layer: Layer) => boolean
}

describe('translatePending', () => {
  const drawLayer = new VectorLayer({ source: new VectorSource() })
  const annotationsLayer = new WebGLVectorLayer({ source: new VectorSource(), style: {}, disableHitDetection: true })
  const pending = new Feature(new Point([0, 0]))

  it("never hit-tests the saved annotations' WebGL layer, which throws with hit detection off", () => {
    const picking = translatePending(drawLayer, pending) as unknown as Picking
    expect(picking.layerFilter_(annotationsLayer)).toBe(false)
    expect(picking.layerFilter_(drawLayer)).toBe(true)
  })

  it('moves only the shape waiting to be named', () => {
    const picking = translatePending(drawLayer, pending) as unknown as Picking
    expect(picking.filter_(pending, drawLayer)).toBe(true)
    expect(picking.filter_(new Feature(new Point([0, 0])), drawLayer)).toBe(false)
  })

  it('looks at no layers before the map has its draw layer', () => {
    const picking = translatePending(null, pending) as unknown as Picking
    expect(picking.layerFilter_(drawLayer)).toBe(false)
    expect(picking.layerFilter_(annotationsLayer)).toBe(false)
  })
})
