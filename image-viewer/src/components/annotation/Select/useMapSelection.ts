import { useEffect, useRef, type RefObject } from 'react'
import Feature from 'ol/Feature'
import type Map from 'ol/Map'
import type MapBrowserEvent from 'ol/MapBrowserEvent'
import type Polygon from 'ol/geom/Polygon'
import DragBox from 'ol/interaction/DragBox'
import DragPan from 'ol/interaction/DragPan'
import Draw from 'ol/interaction/Draw'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { always, mouseActionButton } from 'ol/events/condition'
import type { Annotation } from '../../../interfaces/Annotation'
import { useAnnotationSelectContext } from '../../../context/AnnotationSelectContext'
import { lassoStyle, selectedAnnotationStyle } from '../../open-layers/Styles'
import { featureAt, idsInside, isPanKey, isTyping } from './selection'
import './Select.css'

// How close a click has to be to a line to pick it, in screen pixels.
const CLICK_TOLERANCE_PX = 6
// A lasso smaller than this (screen pixels, squared) was a click, not a lasso.
const MIN_LASSO_AREA_PX = 64

// The Select tab on the map: drag a box or a lasso to pick everything fully
// inside it (Shift adds to what's picked), click a shape to put it in or
// take it out, click empty space or Escape to clear. Hold Space, or drag
// with the middle button, to move the map instead. Picked shapes get a
// halo. MapNode calls this after it syncs annotationsSource, so the halo
// is built from this render's features.
function useMapSelection(
  mapRef: RefObject<Map | null>,
  mapVersion: number,
  annotationsSource: VectorSource,
  annotations: Annotation[],
  visible: boolean
) {
  const { selecting, mode, selectedIds, select, toggle, clear } = useAnnotationSelectContext()
  const highlightSourceRef = useRef(new VectorSource())
  const layerRef = useRef<VectorLayer<VectorSource> | null>(null)

  // Under the shapes, so the halo sits behind them.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const layer = new VectorLayer({ source: highlightSourceRef.current, style: selectedAnnotationStyle })
    const layers = map.getLayers()
    const at = layers.getArray().findIndex((l) => l.get('savedAnnotations'))
    layers.insertAt(at < 0 ? layers.getLength() : at, layer)
    layerRef.current = layer
    return () => {
      layers.remove(layer)
      layerRef.current = null
    }
  }, [mapRef, mapVersion])

  useEffect(() => {
    layerRef.current?.setVisible(visible)
  }, [visible, mapVersion])

  useEffect(() => {
    const source = highlightSourceRef.current
    source.clear()
    const halos: Feature[] = []
    for (const id of selectedIds) {
      const geometry = annotationsSource.getFeatureById(id)?.getGeometry()
      if (!geometry) continue
      const halo = new Feature(geometry.clone())
      halo.set('lineThickness', annotationsSource.getFeatureById(id)?.get('lineThickness'))
      halos.push(halo)
    }
    source.addFeatures(halos)
  }, [selectedIds, annotations, annotationsSource, mapVersion])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !selecting) return

    const viewport = map.getViewport()
    // Draw doesn't say whether Shift was down, so it's watched here.
    let shiftHeld = false
    // Box and lasso take every left drag, so moving the map turns them off
    // until it's done and lets DragPan have it. A freehand Draw ignores its
    // condition, so switching it off is the only way past it.
    let spaceHeld = false
    let middleHeld = false
    let overMap = viewport.matches(':hover')
    let buttonsDown = 0
    const setPanning = () => {
      const panning = spaceHeld || middleHeld
      interaction.setActive(!panning)
      viewport.classList.toggle('select-panning', panning)
    }

    const onKey = (e: KeyboardEvent) => {
      shiftHeld = e.shiftKey
      const tagName = (e.target as HTMLElement | null)?.tagName
      if (e.type === 'keydown' && e.key === 'Escape' && !isTyping(tagName)) clear()
      if (e.code !== 'Space') return
      if (e.type === 'keyup') {
        if (spaceHeld) {
          e.preventDefault()
          spaceHeld = false
          setPanning()
        }
        return
      }
      // Not part way through a box or lasso - that would throw it away.
      if (!isPanKey(e.code, tagName, overMap) || (buttonsDown && !spaceHeld)) return
      e.preventDefault()
      if (!spaceHeld) {
        spaceHeld = true
        setPanning()
      }
    }
    const onBlur = () => {
      shiftHeld = false
      spaceHeld = false
      middleHeld = false
      buttonsDown = 0
      setPanning()
    }
    const onEnter = () => {
      overMap = true
    }
    const onLeave = () => {
      overMap = false
    }
    // Capture, so it's turned off before OpenLayers sees the press.
    const onDown = (e: PointerEvent) => {
      buttonsDown = e.buttons
      if (e.button !== 1) return
      // Otherwise Windows starts autoscroll.
      e.preventDefault()
      middleHeld = true
      setPanning()
    }
    const onUp = (e: PointerEvent) => {
      buttonsDown = e.buttons
      if (e.button !== 1 || !middleHeld) return
      middleHeld = false
      setPanning()
    }
    const stopAutoscroll = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)
    viewport.addEventListener('pointerenter', onEnter)
    viewport.addEventListener('pointerleave', onLeave)
    viewport.addEventListener('pointerdown', onDown, true)
    viewport.addEventListener('mousedown', stopAutoscroll, true)
    window.addEventListener('pointerup', onUp)
    // The map's own DragPan only takes the left button.
    const middlePan = new DragPan({ condition: (e) => (e.originalEvent as PointerEvent).button === 1 })

    const pick = (area: Polygon, add: boolean) => select(idsInside(annotationsSource.getFeatures(), area), add)

    let interaction: DragBox | Draw
    if (mode === 'box') {
      const box = new DragBox({ condition: mouseActionButton, className: 'select-dragbox' })
      box.on('boxend', (e) => pick(box.getGeometry(), (e.mapBrowserEvent.originalEvent as PointerEvent).shiftKey))
      interaction = box
    } else {
      const lasso = new Draw({ type: 'Polygon', freehand: true, condition: always, style: lassoStyle })
      lasso.on('drawend', (e) => {
        const area = e.feature.getGeometry() as Polygon
        const resolution = map.getView().getResolution() ?? 1
        if (area.getArea() < MIN_LASSO_AREA_PX * resolution * resolution) return
        pick(area, shiftHeld)
      })
      interaction = lasso
    }
    map.addInteraction(interaction)
    map.addInteraction(middlePan)

    const onClick = (e: MapBrowserEvent) => {
      if (spaceHeld) return
      const tolerance = CLICK_TOLERANCE_PX * (map.getView().getResolution() ?? 1)
      const hit = featureAt(annotationsSource.getFeatures(), e.coordinate, tolerance)
      if (hit) toggle(String(hit.getId()))
      else if (!(e.originalEvent as PointerEvent).shiftKey) clear()
    }
    map.on('singleclick', onClick)

    return () => {
      map.removeInteraction(interaction)
      map.removeInteraction(middlePan)
      map.un('singleclick', onClick)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
      viewport.removeEventListener('pointerenter', onEnter)
      viewport.removeEventListener('pointerleave', onLeave)
      viewport.removeEventListener('pointerdown', onDown, true)
      viewport.removeEventListener('mousedown', stopAutoscroll, true)
      window.removeEventListener('pointerup', onUp)
      viewport.classList.remove('select-panning')
    }
  }, [mapRef, mapVersion, selecting, mode, annotationsSource, select, toggle, clear])
}

export { useMapSelection }
