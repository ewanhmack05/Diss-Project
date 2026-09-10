import { useEffect, useRef, useState } from 'react'
import { Collection, type Map } from 'ol'
import type Feature from 'ol/Feature'
import type Geometry from 'ol/geom/Geometry'
import Draw, { type DrawEvent } from 'ol/interaction/Draw'
import Translate from 'ol/interaction/Translate'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { OpenLayerMap, type BaseLayerSpec, type ImageSize } from './open-layers/OpenLayers'
import { annotationStyle, sketchStyle } from './open-layers/Styles'
import { geoJsonToFeature } from './open-layers/GeoJSON'
import { useImageViewerContext } from '../context/ImageViewerContext'
import { useAnnotationStoreContext } from '../context/AnnotationStoreContext'
import { useDrawContext } from '../context/DrawContext'
import { ShapeTools } from './annotation/Tools'
import './MapNode.css'

interface SlideMetadata {
  width: number
  height: number
  tileSize: number
  objectivePower: number | null
}

function MapNode() {
  const { source } = useImageViewerContext()
  const { annotations } = useAnnotationStoreContext()
  const { activeTool, colour, lineThickness, lineStyle, setActiveTool, pending, setPending } =
    useDrawContext()

  const mapElement = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const drawSourceRef = useRef(new VectorSource())
  const annotationsSourceRef = useRef(new VectorSource())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    if (!mapElement.current) return

    let cancelled = false

    const finish = (size: ImageSize, spec: BaseLayerSpec, objectivePower: number | null = null) => {
      if (cancelled || !mapElement.current) return
      const annotationsLayer = new VectorLayer({
        source: annotationsSourceRef.current,
        style: annotationStyle,
      })
      const drawLayer = new VectorLayer({ source: drawSourceRef.current, style: annotationStyle })
      mapRef.current = OpenLayerMap(mapElement.current, size, spec, objectivePower, [
        annotationsLayer,
        drawLayer,
      ])
    }

    if (source.kind === 'static') {
      const probe = new window.Image()
      probe.onload = () => {
        finish(
          { width: probe.naturalWidth, height: probe.naturalHeight },
          { kind: 'static', imagePath: source.imagePath }
        )
      }
      probe.onerror = () => {
        if (!cancelled) setError(`Couldn't load image at ${source.imagePath}`)
      }
      probe.src = source.imagePath
    } else {
      const slideUrl = `${source.tilerUrl}/slides/${source.slideId}`
      fetch(slideUrl)
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status))
          return response.json() as Promise<SlideMetadata>
        })
        .then((metadata) => {
          finish(
            { width: metadata.width, height: metadata.height },
            { kind: 'zoomify', baseUrl: `${slideUrl}/`, tileSize: metadata.tileSize },
            metadata.objectivePower
          )
        })
        .catch(() => {
          if (!cancelled) {
            setError(`Couldn't reach the tile server for "${source.slideId}" at ${source.tilerUrl}`)
          }
        })
    }

    return () => {
      cancelled = true
      mapRef.current?.setTarget(undefined)
      mapRef.current = null
    }
  }, [source])

  // Keep the map's annotations layer in sync with the saved-annotations store.
  useEffect(() => {
    const source = annotationsSourceRef.current
    source.clear()
    source.addFeatures(
      annotations.map((annotation) => {
        const feature = geoJsonToFeature(annotation.geoJson)
        feature.setId(annotation.id)
        feature.set('colour', annotation.colour)
        feature.set('lineThickness', annotation.lineThickness)
        feature.set('lineStyle', annotation.lineStyle)
        feature.set('shape', annotation.shape)
        return feature
      })
    )
  }, [annotations])

  // Once a pending (just-drawn, unsaved) feature is cleared — by saving or
  // discarding — clear it from the scratch draw source too.
  useEffect(() => {
    if (!pending) {
      drawSourceRef.current.clear()
    }
  }, [pending])

  // While the naming form is open, let the user drag the just-drawn shape to
  // reposition it — Translate mutates pending.feature's geometry in place, so
  // the eventual save picks up wherever it was last dropped.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !pending) return

    const translate = new Translate({ features: new Collection([pending.feature]) })
    map.addInteraction(translate)

    return () => {
      map.removeInteraction(translate)
    }
  }, [pending])

  // Wire an OpenLayers Draw interaction to whichever shape tool is selected.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !activeTool) return

    const config = ShapeTools[activeTool]
    const draw = new Draw({
      source: drawSourceRef.current,
      type: config.drawType,
      freehand: config.freehand,
      maxPoints: config.maxPoints,
      geometryFunction: config.geometryFunction,
      style: sketchStyle(activeTool, colour, lineThickness, lineStyle),
    })

    draw.on('drawend', (event: DrawEvent) => {
      const feature = event.feature as Feature<Geometry>
      feature.set('colour', colour)
      feature.set('lineThickness', lineThickness)
      feature.set('lineStyle', lineStyle)
      feature.set('shape', activeTool)
      setPending({ feature, shape: activeTool })
      setActiveTool(null)
    })

    map.addInteraction(draw)

    return () => {
      map.removeInteraction(draw)
    }
  }, [activeTool, colour, lineThickness, lineStyle, setActiveTool, setPending])

  if (error) {
    return (
      <div className="map-node map-node--error">
        <p>{error}</p>
      </div>
    )
  }

  return <div ref={mapElement} className="map-node" />
}

export default MapNode
