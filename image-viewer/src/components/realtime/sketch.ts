import Feature from 'ol/Feature'
import type Geometry from 'ol/geom/Geometry'
import LineString from 'ol/geom/LineString'
import { featureToGeoJson, geoJsonToFeature } from '../open-layers/GeoJSON'
import type { LineStyleName, ShapeTool } from '../annotation/Tools'
import Point from 'ol/geom/Point'
import type { CellCountDot } from '../../interfaces/CellCount'
import { sketchFor, type Participant, type Sketch } from './realtime'

interface SketchLook {
  shape: ShapeTool
  colour: string
  lineThickness: number
  lineStyle: LineStyleName
}

// What goes to the hub while you draw. Simplified to half a screen pixel
// first - a long freehand stroke has thousands of points nobody else could
// tell apart, and it goes out ten times a second.
function annotationSketch(geometry: Geometry, look: SketchLook, resolution: number): Extract<Sketch, { tool: 'annotation' }> {
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
    const sketch = sketchFor(participant, 'annotation')
    if (!sketch) return []
    const { geoJson, ...look } = sketch.data
    const feature = geoJsonToFeature(geoJson)
    feature.setProperties({ ...look, owner: participant.displayName, ownerColour: participant.colour })
    return [feature]
  })
}

function rulerSketch(coordinates: number[][], done: boolean): Sketch | null {
  if (coordinates.length < 2) return null
  const [x1, y1] = coordinates[0]
  const [x2, y2] = coordinates[coordinates.length - 1]
  return { tool: 'ruler', data: { from: [x1, y1], to: [x2, y2], done } }
}

// Everyone else's measuring lines, with their name and colour for the style.
function remoteRulerFeatures(others: Participant[]): Feature<LineString>[] {
  return others.flatMap((participant) => {
    const sketch = sketchFor(participant, 'ruler')
    if (!sketch) return []
    const feature = new Feature(new LineString([sketch.data.from, sketch.data.to]))
    feature.setProperties({ done: sketch.data.done, owner: participant.displayName, ownerColour: participant.colour })
    return [feature]
  })
}

function cellCountSketch(dots: CellCountDot[], dotSize: number, count: number, roiGeoJson: string | null): Sketch {
  return {
    tool: 'cellCount',
    data: { dots: dots.map(({ x, y, colour }) => ({ x, y, colour })), dotSize, count, roiGeoJson },
  }
}

// Everyone else's counts as they go - a dot each, plus the ROI box
// labelled with who's counting and how many.
function remoteCellCountFeatures(others: Participant[]): Feature<Geometry>[] {
  return others.flatMap((participant) => {
    const sketch = sketchFor(participant, 'cellCount')
    if (!sketch) return []
    const { dots, dotSize, count, roiGeoJson } = sketch.data
    const features: Feature<Geometry>[] = dots.map((dot) => {
      const feature = new Feature<Geometry>(new Point([dot.x, dot.y]))
      feature.setProperties({ kind: 'dot', colour: dot.colour, dotSize })
      return feature
    })
    if (roiGeoJson) {
      const roi = geoJsonToFeature(roiGeoJson)
      roi.setProperties({ kind: 'roi', label: `${participant.displayName} · ${count}`, ownerColour: participant.colour })
      features.push(roi)
    }
    return features
  })
}

export { annotationSketch, remoteSketchFeatures, rulerSketch, remoteRulerFeatures, cellCountSketch, remoteCellCountFeatures }
export type { SketchLook }
