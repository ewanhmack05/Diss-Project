import Feature from 'ol/Feature'
import { fromExtent } from 'ol/geom/Polygon'
import type Polygon from 'ol/geom/Polygon'
import { describe, expect, it } from 'vitest'
import { featureToGeoJson, geoJsonToFeature } from './GeoJSON'

describe('featureToGeoJson / geoJsonToFeature', () => {
  it('round-trips a polygon feature (the ROI box shape) through GeoJson', () => {
    const original = new Feature<Polygon>({ geometry: fromExtent([0, 0, 100, 50]) })

    const geoJson = featureToGeoJson(original)
    const restored = geoJsonToFeature(geoJson)

    expect(restored.getGeometry()?.getExtent()).toEqual(original.getGeometry()!.getExtent())
  })
})
