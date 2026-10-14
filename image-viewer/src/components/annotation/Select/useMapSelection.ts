import { useEffect, useRef, type RefObject } from 'react'
import Feature from 'ol/Feature'
import type Map from 'ol/Map'
import type MapBrowserEvent from 'ol/MapBrowserEvent'
import type Polygon from 'ol/geom/Polygon'
import DragBox from 'ol/interaction/DragBox'
import Draw from 'ol/interaction/Draw'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { always, mouseActionButton } from 'ol/events/condition'
import type { Annotation } from '../../../interfaces/Annotation'
import { useAnnotationSelectContext } from '../../../context/AnnotationSelectContext'
import { lassoStyle, selectedAnnotationStyle } from '../../open-layers/Styles'
import { featureAt, idsInside } from './selection'
import './Select.css'

// How close a click has to be to a line to pick it, in screen pixels.
const CLICK_TOLERANCE_PX = 6
// A lasso smaller than this (screen pixels, squared) was a click, not a lasso.
const MIN_LASSO_AREA_PX = 64

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

// The Select tab on the map: drag a box or a lasso to pick everything fully
// inside it (Shift adds to what's picked), click a shape to put it in or
// take it out, click empty space or Escape to clear. Picked shapes get a
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
    const at = layers.getArray().findIndex((l) => (l as VectorLayer<VectorSource>).getSource?.() === annotationsSource)
    layers.insertAt(at < 0 ? layers.getLength() : at, layer)
    layerRef.current = layer
    return () => {
      layers.remove(layer)
      layerRef.current = null
    }
  }, [mapRef, mapVersion, annotationsSource])

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

    // Draw doesn't say whether Shift was down, so it's watched here.
    let shiftHeld = false
    const onKey = (e: KeyboardEvent) => {
      shiftHeld = e.shiftKey
      if (e.type === 'keydown' && e.key === 'Escape' && !TYPING_TAGS.has((e.target as HTMLElement | null)?.tagName ?? '')) clear()
    }
    const onBlur = () => {
      shiftHeld = false
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', onBlur)

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

    const onClick = (e: MapBrowserEvent) => {
      const tolerance = CLICK_TOLERANCE_PX * (map.getView().getResolution() ?? 1)
      const hit = featureAt(annotationsSource.getFeatures(), e.coordinate, tolerance)
      if (hit) toggle(String(hit.getId()))
      else if (!(e.originalEvent as PointerEvent).shiftKey) clear()
    }
    map.on('singleclick', onClick)

    return () => {
      map.removeInteraction(interaction)
      map.un('singleclick', onClick)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [mapRef, mapVersion, selecting, mode, annotationsSource, select, toggle, clear])
}

export { useMapSelection }
