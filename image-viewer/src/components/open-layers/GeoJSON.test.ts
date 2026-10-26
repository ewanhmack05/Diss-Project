import Feature from 'ol/Feature'
import { fromExtent } from 'ol/geom/Polygon'
import type Polygon from 'ol/geom/Polygon'
import LineString from 'ol/geom/LineString'
import { describe, expect, it } from 'vitest'
import { featureToGeoJson, geoJsonToFeature } from './GeoJSON'

describe('featureToGeoJson / geoJsonToFeature', () => {
  it('round-trips a polygon feature (the ROI box shape) through GeoJson', () => {
    const original = new Feature<Polygon>({ geometry: fromExtent([0, 0, 100, 50]) })

    const geoJson = featureToGeoJson(original)
    const restored = geoJsonToFeature(geoJson)

    expect(restored.getGeometry()?.getExtent()).toEqual(original.getGeometry()!.getExtent())
  })

  it('saves coordinates to a tenth of a slide pixel, and leaves the feature on the map as it was', () => {
    const line = new LineString([[88734.88763302466, -1234.04999], [88800.25, -1300]])
    const feature = new Feature(line)

    const saved = JSON.parse(featureToGeoJson(feature))

    expect(saved.geometry.coordinates).toEqual([[88734.9, -1234], [88800.3, -1300]])
    expect(line.getFirstCoordinate()).toEqual([88734.88763302466, -1234.04999])
  })
})
