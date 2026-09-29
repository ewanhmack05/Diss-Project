import Feature from 'ol/Feature'
import type Geometry from 'ol/geom/Geometry'
import { featureToGeoJson, geoJsonToFeature } from '../open-layers/GeoJSON'
import type { LineStyleName, ShapeTool } from '../annotation/Tools'
import type { Participant, Sketch } from './realtime'

interface SketchLook {
  shape: ShapeTool
  colour: string
  lineThickness: number
  lineStyle: LineStyleName
}

// What goes to the hub while you draw. Simplified to half a screen pixel
// first - a long freehand stroke has thousands of points nobody else could
// tell apart, and it goes out ten times a second.
function annotationSketch(geometry: Geometry, look: SketchLook, resolution: number): Sketch {
  const simplified = geometry.simplify(resolution / 2)
  return {
    tool: 'annotation',
    data: { ...look, geoJson: featureToGeoJson(new Feature(simplified)) },
  }
}

// One feature per person mid-drawing, styled like a finished annotation
// (see annotationStyle) plus their name and colour for the tag.
function remoteSketchFeatures(others: Participant[]): Feature<Geometry>[] {
  return others.flatMap((participant) => {
    const sketch = participant.sketch
    if (sketch?.tool !== 'annotation') return []
    const { geoJson, ...look } = sketch.data
    const feature = geoJsonToFeature(geoJson)
    feature.setProperties({ ...look, owner: participant.displayName, ownerColour: participant.colour })
    return [feature]
  })
}

export { annotationSketch, remoteSketchFeatures }
export type { SketchLook }
