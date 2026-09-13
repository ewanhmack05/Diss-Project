import { useEffect, useRef, useState } from 'react'
import { Collection, Feature, type Map, type MapBrowserEvent } from 'ol'
import type Geometry from 'ol/geom/Geometry'
import type LineString from 'ol/geom/LineString'
import Point from 'ol/geom/Point'
import { fromExtent } from 'ol/geom/Polygon'
import type Polygon from 'ol/geom/Polygon'
import { containsCoordinate, type Extent } from 'ol/extent'
import type { Coordinate } from 'ol/coordinate'
import Draw, { type DrawEvent } from 'ol/interaction/Draw'
import Translate from 'ol/interaction/Translate'
import VectorLayer from 'ol/layer/Vector'
import type WebGLTileLayer from 'ol/layer/WebGLTile'
import VectorSource from 'ol/source/Vector'
import { OpenLayerMap } from './open-layers/OpenLayers'
import {
  annotationStyle,
  sketchStyle,
  cellCountDotStyle,
  roiBoxStyle,
  rulerStyle,
  rulerSketchStyle,
  setStyleReferenceResolution,
} from './open-layers/Styles'
import { featureToGeoJson, geoJsonToFeature } from './open-layers/GeoJSON'
import { degreesToRadians, radiansToDegrees } from './rotation/rotation'
import { pixelDistance, physicalDistanceMicrons, formatDistanceMicrons, formatDistancePixels } from './ruler/ruler'
import { parseCellCountDots, dotsFromHistory } from './cell-count/CellCountDots'
import { computeViewedCellCountExtent } from './cell-count/CellCountView'
import { useImageViewerContext } from '../context/ImageViewerContext'
import { useAnnotationStoreContext } from '../context/AnnotationStoreContext'
import { useDrawContext } from '../context/DrawContext'
import { useRotationContext } from '../context/RotationContext'
import { useRulerContext } from '../context/RulerContext'
import { useAdjustmentsContext } from '../context/AdjustmentsContext'
import { useCellCountDrawContext } from '../context/CellCountDrawContext'
import { useCellCountStoreContext } from '../context/CellCountStoreContext'
import { useToolbarContext } from '../context/ToolbarContext'
import { useEmitEvent } from '../context/EventContext'
import { ShapeTools } from './annotation/Tools'
import './MapNode.css'

interface SlideMetadata {
  width: number
  height: number
  tileSize: number
  objectivePower: number | null
  mppX: number | null
  mppY: number | null
}

// The box is a fixed size (see RoiBoxSizeOptions) - dragging only ever
// moves it, so this just needs the last pointer position to compute each
// move's delta.
interface RoiDrag {
  last: Coordinate
}

// A rotation round-tripped through radians won't come back bit-for-bit
// equal, so the context<->map sync effects compare against this instead of
// using strict equality.
const ROTATION_EPSILON_DEGREES = 0.01

function MapNode() {
  const { source } = useImageViewerContext()
  const { annotations, selectedAnnotationId, annotationsSource } = useAnnotationStoreContext()
  const { activeTool, colour, lineThickness, lineStyle, setActiveTool, pending, setPending } =
    useDrawContext()
  const { rotationDegrees, setRotationDegrees, resetRotation } = useRotationContext()
  const { setLastMeasurement, clearSignal: rulerClearSignal } = useRulerContext()
  const { values: adjustmentValues, resetValues: resetAdjustments } = useAdjustmentsContext()
  const {
    counting,
    colour: cellCountColour,
    dotSize,
    count: cellCount,
    withAnnotation,
    withRoi,
    boxSizeMicrons,
    roiConfirmed,
    pending: cellCountPending,
    incrementCount,
    decrementCount,
    setPending: setCellCountPending,
    setDotHistory,
    undoSignal,
    redoSignal,
  } = useCellCountDrawContext()
  const { cellCounts, viewedCellCountId } = useCellCountStoreContext()
  const { activeTools } = useToolbarContext()
  const annotationsVisible = activeTools.includes('annotations')
  const cellCountVisible = activeTools.includes('cellcount')
  const rulerVisible = activeTools.includes('ruler')
  const emit = useEmitEvent()

  const mapElement = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Map | null>(null)
  const baseLayerRef = useRef<WebGLTileLayer | null>(null)
  const drawSourceRef = useRef(new VectorSource())
  const cellCountDotsSourceRef = useRef(new VectorSource())
  const roiSourceRef = useRef(new VectorSource())
  // Separate from cellCountDotsSourceRef - "View" redraws a *saved* count's
  // dots, which could otherwise clash with an unrelated live counting
  // session's own dots.
  const viewedDotsSourceRef = useRef(new VectorSource())
  // Same as viewedDotsSourceRef, but for a saved count's ROI box - keeps
  // it separate from any live counting session's own box.
  const viewedRoiSourceRef = useRef(new VectorSource())
  const rulerSourceRef = useRef(new VectorSource())
  const annotationsLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const drawLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const cellCountDotsLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const roiLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const viewedDotsLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const viewedRoiLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const rulerLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const roiFeatureRef = useRef<Feature<Polygon> | null>(null)
  const roiDragRef = useRef<RoiDrag | null>(null)
  const slideMetadataRef = useRef<SlideMetadata | null>(null)
  const wasCountingRef = useRef(false)
  // One entry per tally click this session, in order - the dot Feature it
  // placed, or null if withAnnotation was off at the time. Undo pops one
  // off here (and removes its dot, if any) onto the redo stack; redo does
  // the reverse. A fresh click past the last undo clears the redo stack,
  // same as any standard undo/redo.
  const cellCountHistoryRef = useRef<(Feature<Point> | null)[]>([])
  const cellCountRedoRef = useRef<(Feature<Point> | null)[]>([])
  const lastUndoSignalRef = useRef(undoSignal)
  const lastRedoSignalRef = useRef(redoSignal)
  const lastRulerClearSignalRef = useRef(rulerClearSignal)
  const rotationDegreesRef = useRef(rotationDegrees)
  const [error, setError] = useState<string | null>(null)
  // Bumped right after mapRef.current is (re)built - the map is constructed
  // asynchronously (after the slide-metadata fetch resolves), so nothing
  // about that assignment is visible to React's own effect scheduling.
  // Without this, the map->context rotation listener below would only ever
  // attach the first time rotationDegrees itself changes, which for a slide
  // that opens unrotated may never happen - leaving Alt+Shift+drag silently
  // unsynced until the user first touches the panel.
  const [mapVersion, setMapVersion] = useState(0)

  useEffect(() => {
    setError(null)
    resetRotation()
    setLastMeasurement(null)
    resetAdjustments()
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
        slideMetadataRef.current = metadata
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
        const cellCountDotsLayer = new VectorLayer({
          source: cellCountDotsSourceRef.current,
          style: cellCountDotStyle,
          visible: cellCountVisible,
        })
        const roiLayer = new VectorLayer({
          source: roiSourceRef.current,
          style: roiBoxStyle,
          visible: cellCountVisible,
        })
        const viewedDotsLayer = new VectorLayer({
          source: viewedDotsSourceRef.current,
          style: cellCountDotStyle,
          visible: cellCountVisible,
        })
        const viewedRoiLayer = new VectorLayer({
          source: viewedRoiSourceRef.current,
          style: roiBoxStyle,
          visible: cellCountVisible,
        })
        const rulerLayer = new VectorLayer({
          source: rulerSourceRef.current,
          style: rulerStyle,
          visible: rulerVisible,
        })
        annotationsLayerRef.current = annotationsLayer
        drawLayerRef.current = drawLayer
        cellCountDotsLayerRef.current = cellCountDotsLayer
        roiLayerRef.current = roiLayer
        viewedDotsLayerRef.current = viewedDotsLayer
        viewedRoiLayerRef.current = viewedRoiLayer
        rulerLayerRef.current = rulerLayer
        const { map, baseLayer } = OpenLayerMap(
          mapElement.current,
          { width: metadata.width, height: metadata.height },
          { baseUrl: `${slideUrl}/`, tileSize: metadata.tileSize },
          metadata.objectivePower,
          metadata.mppX,
          [annotationsLayer, drawLayer, cellCountDotsLayer, roiLayer, viewedDotsLayer, viewedRoiLayer, rulerLayer]
        )
        mapRef.current = map
        baseLayerRef.current = baseLayer
        // The view's own coarsest resolution (post native-scale capping,
        // i.e. genuinely as zoomed-out as this slide's view can go) - see
        // Styles.ts's coarsestResolution for why the arrowhead and dash
        // pattern caps are both expressed relative to this rather than the
        // slide's raw pixel dimensions.
        const resolutions = mapRef.current.getView().getResolutions()
        setStyleReferenceResolution(resolutions?.[0] ?? 1)
        setMapVersion((version) => version + 1)
      })
      .catch(() => {
        if (!cancelled) {
          setError(`Couldn't reach the tile server for "${source.slideId}" at ${source.tilerUrl}`)
          emit('slide:load-error', { slideId: source.slideId, tilerUrl: source.tilerUrl })
        }
      })

    return () => {
      cancelled = true
      mapRef.current?.setTarget(undefined)
      mapRef.current = null
      baseLayerRef.current = null
    }
  }, [source, emit])

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

  // Same idea as the annotations layer above, for the cell-count panel.
  useEffect(() => {
    cellCountDotsLayerRef.current?.setVisible(cellCountVisible)
    roiLayerRef.current?.setVisible(cellCountVisible)
    viewedDotsLayerRef.current?.setVisible(cellCountVisible)
    viewedRoiLayerRef.current?.setVisible(cellCountVisible)
  }, [cellCountVisible])

  // Same idea again, for the ruler - and since a measurement is a one-off
  // scratch reading rather than something saved, closing the tool clears it
  // outright rather than just hiding it, so reopening the panel doesn't
  // resurrect a stale distance from a previous session.
  useEffect(() => {
    rulerLayerRef.current?.setVisible(rulerVisible)
    if (!rulerVisible) {
      rulerSourceRef.current.clear()
      setLastMeasurement(null)
    }
  }, [rulerVisible, setLastMeasurement])

  // Explicit "Clear" button in the ruler panel - same signal-counter idiom
  // as undoSignal/redoSignal above, since the panel has no direct handle on
  // the map's vector source to clear it itself.
  useEffect(() => {
    if (rulerClearSignal !== lastRulerClearSignalRef.current) {
      lastRulerClearSignalRef.current = rulerClearSignal
      rulerSourceRef.current.clear()
    }
  }, [rulerClearSignal])

  // Measuring tool: a plain two-point LineString Draw, active only while the
  // ruler panel is open. drawstart clears any previous line first, so only
  // one measurement is ever shown at a time; drawend computes the distance
  // (real, if the slide reports mpp; pixels otherwise) and bakes the
  // formatted label onto the feature for rulerStyle to render. Also backs
  // off while an annotation shape is selected or a cell count is running -
  // both already put their own click handling on the map (see the Draw
  // effect and the tally click listener below), and a click can only mean
  // one thing at a time, same reasoning as FreeFormToolPicker disabling
  // shape tools during counting.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !rulerVisible || activeTool || counting) return

    const metadata = slideMetadataRef.current
    const mppX = metadata?.mppX ?? null
    const mppY = metadata?.mppY ?? null

    const draw = new Draw({
      source: rulerSourceRef.current,
      type: 'LineString',
      maxPoints: 2,
      style: rulerSketchStyle(mppX, mppY),
    })

    draw.on('drawstart', () => {
      rulerSourceRef.current.clear()
    })

    draw.on('drawend', (event: DrawEvent) => {
      const feature = event.feature as Feature<LineString>
      const coords = feature.getGeometry()!.getCoordinates()
      const [x1, y1] = coords[0]
      const [x2, y2] = coords[coords.length - 1]
      const dx = x2 - x1
      const dy = y2 - y1

      const pixelLength = pixelDistance(dx, dy)
      const realDistanceMicrons = mppX !== null && mppY !== null ? physicalDistanceMicrons(dx, dy, mppX, mppY) : null

      feature.set(
        'label',
        realDistanceMicrons !== null ? formatDistanceMicrons(realDistanceMicrons) : formatDistancePixels(pixelLength)
      )
      setLastMeasurement({ pixelDistance: pixelLength, realDistanceMicrons })
    })

    map.addInteraction(draw)

    return () => {
      map.removeInteraction(draw)
    }
  }, [rulerVisible, activeTool, counting, setLastMeasurement])

  useEffect(() => {
    rotationDegreesRef.current = rotationDegrees
  }, [rotationDegrees])

  // Push a context rotation change onto the map. Guarded with an epsilon
  // rather than !== since a value round-tripped through radians won't come
  // back bit-for-bit equal - and skipping the call when it's already close
  // enough is what stops this from fighting the map->context effect below
  // (that one pushes the map's rotation back into context on every change,
  // which would otherwise bounce straight back here and loop forever).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const view = map.getView()
    const currentDegrees = radiansToDegrees(view.getRotation() ?? 0)
    if (Math.abs(currentDegrees - rotationDegrees) > ROTATION_EPSILON_DEGREES) {
      view.setRotation(degreesToRadians(rotationDegrees))
    }
  }, [rotationDegrees])

  // OpenLayers already supports free rotation with no extra config - the map
  // is constructed with no explicit `interactions` option, so it uses
  // ol/interaction/defaults(), which includes DragRotate (Alt+Shift+drag)
  // and PinchRotate (touch). This mirrors the map's own rotation into
  // context whenever it changes that way, so the panel's dial/readout stay
  // in sync with a rotation the user applied directly on the map. Keyed off
  // mapVersion (not rotationDegrees) so it (re)attaches exactly once per map
  // instance rather than on every rotation change - it reads the latest
  // rotationDegrees via a ref instead, so the epsilon check still sees a
  // fresh value without needing to re-bind the listener for it.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const view = map.getView()
    const handleRotationChange = () => {
      const mapDegrees = radiansToDegrees(view.getRotation() ?? 0)
      if (Math.abs(mapDegrees - rotationDegreesRef.current) > ROTATION_EPSILON_DEGREES) {
        setRotationDegrees(mapDegrees)
      }
    }

    view.on('change:rotation', handleRotationChange)
    return () => {
      view.un('change:rotation', handleRotationChange)
    }
  }, [mapVersion, setRotationDegrees])

  // Pushes live slider/preset values onto the base layer's WebGL style
  // variables - cheap, no shader rebuild (see adjustmentsStyle in
  // OpenLayers.ts). mapVersion has to be a dep too, not just
  // adjustmentValues: a slider dragged while the next slide is still
  // loading changes adjustmentValues while baseLayerRef.current is still
  // null, so that call is a no-op - without mapVersion here, the freshly
  // built layer (which always starts at DEFAULT_ADJUSTMENTS, see
  // zoomifyLayer) would never pick up that pending change once it exists.
  useEffect(() => {
    baseLayerRef.current?.updateStyleVariables({
      red: adjustmentValues.red,
      green: adjustmentValues.green,
      blue: adjustmentValues.blue,
      brightness: adjustmentValues.brightness,
      contrast: adjustmentValues.contrast,
      gamma: adjustmentValues.gamma,
    })
  }, [adjustmentValues, mapVersion])

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

  // Same idea for a finished (stopped, unsaved) counting tally: once it's
  // cleared - by saving or recounting - drop the placed dots and the ROI
  // box (if any) too.
  useEffect(() => {
    if (!cellCountPending) {
      cellCountDotsSourceRef.current.clear()
      roiSourceRef.current.clear()
      roiFeatureRef.current = null
    }
  }, [cellCountPending])

  // Builds the ROI box the moment counting starts (if withRoi is on) and
  // zooms in to frame it. withAnnotation/withRoi are locked for the rest of
  // the session (CellCounterToolPicker disables both once counting begins),
  // so this only needs to run on that one false->true transition, not track
  // either value continuously.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !counting || !withRoi || roiFeatureRef.current) return

    const metadata = slideMetadataRef.current
    // Formats that don't report openslide.mpp-x/-y have no way to convert
    // microns to pixels - fall back to 1 micron-per-pixel (i.e. treat the
    // configured size as pixels) rather than blocking the box entirely.
    const mppX = metadata?.mppX ?? 1
    const mppY = metadata?.mppY ?? 1
    const halfWidth = boxSizeMicrons / mppX / 2
    const halfHeight = boxSizeMicrons / mppY / 2
    const center = map.getView().getCenter() ?? [0, 0]
    const initialExtent: Extent = [
      center[0] - halfWidth,
      center[1] - halfHeight,
      center[0] + halfWidth,
      center[1] + halfHeight,
    ]

    const feature = new Feature({ geometry: fromExtent(initialExtent) })
    roiFeatureRef.current = feature
    roiSourceRef.current.addFeature(feature)

    map.getView().fit(initialExtent, {
      size: map.getSize(),
      padding: [80, 80, 80, 80],
      minResolution: 1,
      duration: 400,
    })
  }, [counting, withRoi, boxSizeMicrons])

  // Lets the ROI box be dragged into place before counting starts - only
  // active during that placement phase (not once roiConfirmed), since
  // dragging it around afterward would just be more clicks inside the box
  // (see the click handler below, which is itself gated off during
  // placement for the same reason). No resize - the box is a fixed size
  // (see RoiBoxSizeOptions), so this only ever moves it.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !counting || !withRoi || roiConfirmed) return

    // Typed as `unknown` rather than MapBrowserEvent, and cast inside - see
    // the addEventListener/removeEventListener comment below for why.
    const handlePointerDown = (evt: unknown) => {
      const event = evt as MapBrowserEvent
      const extent = roiFeatureRef.current?.getGeometry()?.getExtent()
      if (!extent || !containsCoordinate(extent, event.coordinate)) return

      roiDragRef.current = { last: event.coordinate }
      event.stopPropagation()
    }

    const handlePointerMove = (event: MapBrowserEvent) => {
      const drag = roiDragRef.current
      const feature = roiFeatureRef.current
      if (!drag || !feature) return

      event.stopPropagation()

      const extent = feature.getGeometry()!.getExtent()
      const dx = event.coordinate[0] - drag.last[0]
      const dy = event.coordinate[1] - drag.last[1]
      feature.setGeometry(
        fromExtent([extent[0] + dx, extent[1] + dy, extent[2] + dx, extent[3] + dy])
      )
      roiDragRef.current = { last: event.coordinate }
    }

    const handlePointerUp = () => {
      roiDragRef.current = null
    }

    // pointerdown/pointerup aren't in Map's typed `on()` event union (only
    // pointermove is) even though the same MapBrowserEvent flows through
    // for them at runtime - addEventListener/removeEventListener are the
    // untyped-by-event-name primitives `on`/`un` wrap, so they still reach
    // it. stopPropagation() on the down/move events (see above) is what
    // stops OL's own DragPan from also panning the map during a drag.
    map.addEventListener('pointerdown', handlePointerDown)
    map.on('pointermove', handlePointerMove)
    map.addEventListener('pointerup', handlePointerUp)

    return () => {
      map.removeEventListener('pointerdown', handlePointerDown)
      map.un('pointermove', handlePointerMove)
      map.removeEventListener('pointerup', handlePointerUp)
      roiDragRef.current = null
    }
  }, [counting, withRoi, roiConfirmed])

  // While actually tallying - counting, and past ROI placement if withRoi
  // is on - each map click ticks the count. No OL Draw interaction here
  // since a cell count isn't a shape, just a running total, so a plain
  // click listener is enough. withAnnotation gates whether the click also
  // drops a visible dot; withRoi confines valid clicks to the ROI box,
  // rejecting (with a toast) anything outside it. Not attaching this
  // listener at all until roiConfirmed is what stops dragging the box into
  // place from also registering as tally clicks.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !counting || (withRoi && !roiConfirmed)) return

    const handleClick = (event: MapBrowserEvent) => {
      if (withRoi) {
        const extent = roiFeatureRef.current?.getGeometry()?.getExtent()
        if (!extent || !containsCoordinate(extent, event.coordinate)) {
          emit('cellcount:click-outside-roi')
          return
        }
      }

      let feature: Feature<Point> | null = null
      if (withAnnotation) {
        feature = new Feature({ geometry: new Point(event.coordinate) })
        feature.set('colour', cellCountColour)
        feature.set('dotSize', dotSize)
        cellCountDotsSourceRef.current.addFeature(feature)
      }

      cellCountHistoryRef.current.push(feature)
      cellCountRedoRef.current = []
      setDotHistory(dotsFromHistory(cellCountHistoryRef.current))
      incrementCount()
    }

    map.on('click', handleClick)

    return () => {
      map.un('click', handleClick)
    }
  }, [counting, withAnnotation, withRoi, roiConfirmed, cellCountColour, dotSize, incrementCount, setDotHistory, emit])

  // Undoes/redoes the last tally click - pops (or re-pushes) a dot feature
  // between the two stacks and removes/re-adds it from the map, alongside
  // the count itself. A no-op outside the tallying window (guarded here,
  // not just at the call sites) since both the Z/Y keydown handler and the
  // signal watchers below can otherwise reach these at any time.
  const undoLastCount = () => {
    if (!counting || (withRoi && !roiConfirmed)) return
    const feature = cellCountHistoryRef.current.pop()
    if (feature === undefined) return
    if (feature) cellCountDotsSourceRef.current.removeFeature(feature)
    cellCountRedoRef.current.push(feature)
    setDotHistory(dotsFromHistory(cellCountHistoryRef.current))
    decrementCount()
  }

  const redoLastCount = () => {
    if (!counting || (withRoi && !roiConfirmed)) return
    const feature = cellCountRedoRef.current.pop()
    if (feature === undefined) return
    if (feature) cellCountDotsSourceRef.current.addFeature(feature)
    cellCountHistoryRef.current.push(feature)
    setDotHistory(dotsFromHistory(cellCountHistoryRef.current))
    incrementCount()
  }

  // Z to undo, Y to redo, active only while actually tallying (same window
  // as the click handler above). Ignored while a form field has focus so
  // it doesn't fight with a browser or field's own undo (there's no text
  // field in this view while tallying, but the annotations panel elsewhere
  // in the app has plenty).
  useEffect(() => {
    if (!counting || (withRoi && !roiConfirmed)) return

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault()
        undoLastCount()
      } else if (event.key === 'y' || event.key === 'Y') {
        event.preventDefault()
        redoLastCount()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [counting, withRoi, roiConfirmed])

  // The button-driven counterpart to the keydown handler above - Undo/Redo
  // in CellCounterDuring live in a different component from the map, so
  // they can't call undoLastCount/redoLastCount directly; each just rings
  // a counter in context instead, and this notices it went up.
  useEffect(() => {
    if (undoSignal !== lastUndoSignalRef.current) {
      lastUndoSignalRef.current = undoSignal
      undoLastCount()
    }
  }, [undoSignal])

  useEffect(() => {
    if (redoSignal !== lastRedoSignalRef.current) {
      lastRedoSignalRef.current = redoSignal
      redoLastCount()
    }
  }, [redoSignal])

  // Resets the undo/redo history the moment a counting session starts.
  useEffect(() => {
    if (counting) {
      cellCountHistoryRef.current = []
      cellCountRedoRef.current = []
      setDotHistory([])
    }
    // Deliberately only depends on `counting` - see comment above.
  }, [counting, setDotHistory])

  // Assembles `pending` the moment counting stops - the counterpart to
  // CellCounterToolPicker's handleStop, which only flips `counting` off.
  // This lives here (not there) because it needs the map, for `location`.
  // A stop that lands while withRoi is still unconfirmed can only be
  // CellCounterToolPicker's "Cancel" (the "Stop counting" button that
  // reaches here otherwise only ever appears once roiConfirmed is true) -
  // treat that as discarding the session rather than finishing it, so
  // backing out of ROI placement never lands on the save screen.
  useEffect(() => {
    const map = mapRef.current
    const justStopped = wasCountingRef.current && !counting
    wasCountingRef.current = counting
    if (!map || !justStopped) return

    if (withRoi && !roiConfirmed) {
      cellCountDotsSourceRef.current.clear()
      roiSourceRef.current.clear()
      roiFeatureRef.current = null
      return
    }

    const roiExtent = withRoi ? roiFeatureRef.current?.getGeometry()?.getExtent() : undefined
    const center = roiExtent
      ? [(roiExtent[0] + roiExtent[2]) / 2, (roiExtent[1] + roiExtent[3]) / 2]
      : map.getView().getCenter()

    // Read off the dot features themselves (in current undo/redo order, so
    // an undone click's dot isn't included) rather than off `colour`, since
    // that can change live mid-session - there's no single colour to
    // snapshot, only each dot's own. Clicks with no dot (withAnnotation was
    // off) don't contribute one.
    const dots = dotsFromHistory(cellCountHistoryRef.current)

    setCellCountPending({
      count: cellCount,
      withAnnotation,
      withRoi,
      dots,
      dotSize,
      location: center ? { x: center[0], y: center[1] } : null,
      roiGeoJson: withRoi && roiFeatureRef.current ? featureToGeoJson(roiFeatureRef.current) : null,
    })
    // Deliberately only depends on `counting` - reads the other session
    // values fresh off this same render's closure at the exact instant it
    // flips false, rather than re-running for every live change to them
    // beforehand (colour/dotSize can change while still counting).
  }, [counting])

  // "View" from the saved-counts list - redraws the count's dots and ROI
  // box (if it had one) and fits the map to them. See
  // computeViewedCellCountExtent for the fallback order. Toggling it off
  // (or switching to a count with no dots/box left to show) has to clear
  // both sources too, not just skip drawing into them.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const cellCountToView = viewedCellCountId ? cellCounts.find((c) => c.id === viewedCellCountId) : undefined
    if (!cellCountToView) {
      viewedDotsSourceRef.current.clear()
      viewedRoiSourceRef.current.clear()
      return
    }

    const dots = parseCellCountDots(cellCountToView.dots)
    viewedDotsSourceRef.current.clear()
    viewedDotsSourceRef.current.addFeatures(
      dots.map(({ x, y, colour }) => {
        const feature = new Feature({ geometry: new Point([x, y]) })
        feature.set('colour', colour)
        feature.set('dotSize', cellCountToView.dotSize)
        return feature
      })
    )

    viewedRoiSourceRef.current.clear()
    let roiExtent: Extent | null = null
    if (cellCountToView.regionOfInterest) {
      const roiFeature = geoJsonToFeature(cellCountToView.regionOfInterest.geoJson)
      viewedRoiSourceRef.current.addFeature(roiFeature)
      roiExtent = roiFeature.getGeometry()?.getExtent() ?? null
    }

    const location =
      cellCountToView.locationX !== null && cellCountToView.locationY !== null
        ? { x: cellCountToView.locationX, y: cellCountToView.locationY }
        : null
    const extent = computeViewedCellCountExtent(dots, roiExtent, location)
    if (!extent) return

    map.getView().fit(extent, {
      size: map.getSize(),
      padding: [80, 80, 80, 80],
      minResolution: 1,
      duration: 400,
    })
  }, [viewedCellCountId, cellCounts])

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
