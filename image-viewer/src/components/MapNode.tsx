import { useEffect, useRef, useState } from 'react'
import { Collection, type Map } from 'ol'
import type Feature from 'ol/Feature'
import type Geometry from 'ol/geom/Geometry'
import Draw, { type DrawEvent } from 'ol/interaction/Draw'
import Translate from 'ol/interaction/Translate'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { OpenLayerMap } from './open-layers/OpenLayers'
import { annotationStyle, sketchStyle } from './open-layers/Styles'
import { geoJsonToFeature } from './open-layers/GeoJSON'
import { useImageViewerContext } from '../context/ImageViewerContext'
import { useAnnotationStoreContext } from '../context/AnnotationStoreContext'
import { useDrawContext } from '../context/DrawContext'
import { useToolbarContext } from '../context/ToolbarContext'
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
  const { annotations, selectedAnnotationId, annotationsSource } = useAnnotationStoreContext()
  const { activeTool, colour, lineThickness, lineStyle, setActiveTool, pending, setPending } =
    useDrawContext()
  const { activeTools } = useToolbarContext()
  const annotationsVisible = activeTools.includes('annotations')

  const mapElement = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const drawSourceRef = useRef(new VectorSource())
  const annotationsLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const drawLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    if (!mapElement.current) return

    let cancelled = false

    const slideUrl = `${source.tilerUrl}/slides/${source.slideId}`
    fetch(slideUrl)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<SlideMetadata>
      })
      .then((metadata) => {
        if (cancelled || !mapElement.current) return
        const annotationsLayer = new VectorLayer({
          source: annotationsSource,
          style: annotationStyle,
          visible: annotationsVisible,
        })
        const drawLayer = new VectorLayer({
          source: drawSourceRef.current,
          style: annotationStyle,
          visible: annotationsVisible,
        })
        annotationsLayerRef.current = annotationsLayer
        drawLayerRef.current = drawLayer
        mapRef.current = OpenLayerMap(
          mapElement.current,
          { width: metadata.width, height: metadata.height },
          { baseUrl: `${slideUrl}/`, tileSize: metadata.tileSize },
          metadata.objectivePower,
          [annotationsLayer, drawLayer]
        )
      })
      .catch(() => {
        if (!cancelled) {
          setError(`Couldn't reach the tile server for "${source.slideId}" at ${source.tilerUrl}`)
        }
      })

    return () => {
      cancelled = true
      mapRef.current?.setTarget(undefined)
      mapRef.current = null
    }
  }, [source])

  // Keep the map's annotations layer in sync with the saved-annotations store.
  useEffect(() => {
    annotationsSource.clear()
    annotationsSource.addFeatures(
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
  }, [annotations, annotationsSource])

  // Keep annotation shapes off the image unless the annotations panel is
  // actually open - re-applied on every toggle; the layers' own construction
  // above already picks up whatever this was at map-build time.
  useEffect(() => {
    annotationsLayerRef.current?.setVisible(annotationsVisible)
    drawLayerRef.current?.setVisible(annotationsVisible)
  }, [annotationsVisible])

  // Bring a saved annotation into view when it's selected for editing -
  // reads the already-built feature straight off the annotations source
  // rather than re-parsing geoJson, since the sync effect below keeps it
  // current with the store.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedAnnotationId) return

    const feature = annotationsSource.getFeatureById(selectedAnnotationId)
    const extent = feature?.getGeometry()?.getExtent()
    if (!extent) return

    map.getView().fit(extent, {
      size: map.getSize(),
      padding: [80, 80, 80, 80],
      minResolution: 1,
      duration: 400,
    })
  }, [selectedAnnotationId, annotationsSource])

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
