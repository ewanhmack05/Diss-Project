import { Map, View } from 'ol'
import TileLayer from 'ol/layer/Tile'
import Zoomify from 'ol/source/Zoomify'
import Projection from 'ol/proj/Projection'
import OverviewMap from 'ol/control/OverviewMap'
import type BaseLayer from 'ol/layer/Base'

interface ImageSize {
  width: number
  height: number
}

// A whole-slide image has no natural CRS, so we project it onto its own
// pixel grid (Y flipped, since OpenLayers extents grow upward).
function getExtent(size: ImageSize): number[] {
  const left = 0
  const top = -size.height
  const right = size.width
  const bottom = 0
  return [left, top, right, bottom]
}

function olProjection(extent: number[]): Projection {
  return new Projection({
    code: 'image-viewer',
    units: 'pixels',
    extent,
  })
}

// Same halving ladder as tiler's ZoomifyTiling.ComputeTiers / ol/source/Zoomify's
// default tierSizeCalculation: 1 (native resolution) up to however many doublings
// are needed until the whole slide fits in a single tile. Passed to the View as
// its resolutions, this caps zoom to what the slide can actually show - no
// blurring past native resolution on the zoomed-in end, no zooming out into
// empty space past "whole slide, one tile" on the other. Computed per slide
// since the ladder length depends on its dimensions.
function computeResolutionLadder(size: ImageSize, tileSize: number): number[] {
  const resolutions = [1]
  let width = size.width
  let height = size.height
  while (width > tileSize || height > tileSize) {
    resolutions.unshift(resolutions[0] * 2)
    width = Math.floor(width / 2)
    height = Math.floor(height / 2)
  }
  return resolutions
}

// baseUrl must include the trailing slide segment, e.g.
// "http://localhost:5095/slides/000/" - Zoomify appends
// "TileGroup{g}/{z}-{x}-{y}.jpg" itself, matching tiler's route exactly.
// tierSizeCalculation is left at its default ('default') deliberately -
// tiler/Slides/ZoomifyTiling.cs reimplements that exact algorithm
// server-side so client and server agree on tier/tile numbering.
function zoomifyLayer(
  baseUrl: string,
  tileSize: number,
  size: ImageSize,
  projection: Projection,
  extent: number[]
): TileLayer<Zoomify> {
  return new TileLayer({
    source: new Zoomify({
      url: baseUrl,
      size: [size.width, size.height],
      extent,
      tileSize,
      projection,
      crossOrigin: 'anonymous',
    }),
  })
}

// No extent constraint on the view - annotations should be drawable outside
// the image border, so panning isn't clamped to it. resolutions (see
// computeResolutionLadder) is what keeps zoom itself within a sensible,
// slide-derived range.
function olView(projection: Projection, resolutions: number[]): View {
  return new View({
    projection,
    resolutions,
  })
}

interface BaseLayerSpec {
  baseUrl: string
  tileSize: number
}

// Layers can't be shared between two Map instances, so the overview needs
// its own copy built the same way - same projection/extent instance as
// the main map, so the two line up exactly.
function buildBaseLayer(
  spec: BaseLayerSpec,
  projection: Projection,
  extent: number[],
  size: ImageSize
): BaseLayer {
  return zoomifyLayer(spec.baseUrl, spec.tileSize, size, projection, extent)
}

// Formats a magnification ratio as "x1", "x40", "x0.3" etc - integer once it
// reaches double digits (nobody needs "x40.2"), one or two decimal places
// below that so small ratios don't all collapse to "x0".
function formatMagnification(value: number): string {
  if (value >= 10) return `x${Math.round(value)}`
  if (value >= 1) return `x${Math.round(value * 10) / 10}`
  return `x${Math.round(value * 100) / 100}`
}

// A status bar attached below the overview map's own element: current zoom
// as a magnification factor, and a collapse/expand toggle (using
// OverviewMap's public setCollapsed API rather than moving its internal
// button, which isn't part of its documented interface). Appended as a
// sibling of .ol-overviewmap-map rather than inside it, so it stays visible
// even when the thumbnail itself is collapsed. `overview.element` is
// protected, so the container is found by querying the DOM instead - safe
// to do right after addControl(), which appends it synchronously.
function attachOverviewStatusBar(
  overview: OverviewMap,
  container: HTMLElement,
  view: View,
  resolutions: number[],
  objectivePower: number | null
): void {
  const bar = document.createElement('div')
  bar.className = 'ol-overviewmap-statusbar'

  const zoomLabel = document.createElement('span')
  zoomLabel.className = 'ol-overviewmap-zoom'

  const toggleButton = document.createElement('button')
  toggleButton.type = 'button'
  toggleButton.className = 'ol-overviewmap-toggle'
  toggleButton.setAttribute('aria-label', 'Toggle overview map')

  // objectivePower (openslide.objective-power) is the scanner's real
  // objective magnification at native resolution - when the slide reports
  // one, resolution 1 genuinely means e.g. "x40", and it scales down from
  // there as you zoom out. Without it (a format that doesn't report it),
  // fall back to a relative multiple of the most zoomed-out tier, which is
  // the closest honest stand-in.
  const updateZoomLabel = () => {
    const resolution = view.getResolution() ?? 1
    const magnification =
      objectivePower !== null ? objectivePower / resolution : resolutions[0] / resolution
    zoomLabel.textContent = formatMagnification(magnification)
  }

  const updateToggleIcon = () => {
    toggleButton.textContent = overview.getCollapsed() ? '›' : '‹'
  }

  toggleButton.addEventListener('click', () => {
    overview.setCollapsed(!overview.getCollapsed())
    updateToggleIcon()
  })

  view.on('change:resolution', updateZoomLabel)
  updateZoomLabel()
  updateToggleIcon()

  bar.appendChild(zoomLabel)
  bar.appendChild(toggleButton)
  container.appendChild(bar)
}

export function OpenLayerMap(
  target: HTMLElement,
  size: ImageSize,
  spec: BaseLayerSpec,
  objectivePower: number | null = null,
  extraLayers: BaseLayer[] = []
): Map {
  const extent = getExtent(size)
  const projection = olProjection(extent)
  const resolutions = computeResolutionLadder(size, spec.tileSize)

  const baseLayer = buildBaseLayer(spec, projection, extent, size)

  const map = new Map({
    target,
    layers: [baseLayer, ...extraLayers],
    view: olView(projection, resolutions),
  })

  // Overview panel: whole-slide thumbnail with a box showing the current
  // viewport, which shrinks/grows as you zoom - draggable/clickable to
  // reposition the main view. Needs its own explicit view - left to its
  // default, OverviewMap assumes a standard web-mercator-ish projection,
  // which silently fails to render anything in our custom pixel one.
  // resolutions[0] (the coarsest tier) frames the whole slide directly, no
  // fit()-after-attach timing to worry about.
  const overview = new OverviewMap({
    view: new View({
      projection,
      resolutions,
      center: [size.width / 2, -size.height / 2],
      resolution: resolutions[0],
    }),
    layers: [buildBaseLayer(spec, projection, extent, size)],
    collapsed: false,
    collapsible: true,
  })
  map.addControl(overview)
  const overviewContainer = target.querySelector<HTMLElement>('.ol-overviewmap')
  if (overviewContainer) {
    attachOverviewStatusBar(overview, overviewContainer, map.getView(), resolutions, objectivePower)
  }

  map.getView().fit(extent)
  return map
}

export { getExtent }
export type { ImageSize, BaseLayerSpec }
