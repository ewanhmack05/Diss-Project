import { Map, View } from 'ol'
import TileLayer from 'ol/layer/Tile'
import Zoomify from 'ol/source/Zoomify'
import Projection from 'ol/proj/Projection'
import OverviewMap from 'ol/control/OverviewMap'
import Control from 'ol/control/Control'
import type BaseLayer from 'ol/layer/Base'

interface ImageSize {
  width: number
  height: number
}

// Smallest the overview's viewport-indicator box is ever allowed to shrink
// to, in CSS pixels - see clampOverviewBoxSize.
const MIN_OVERVIEW_BOX_PX = 6

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

// Excludes any *intermediate* tier coarser than "life-size" (magnification
// 1) from the ladder the main view is allowed to reach - without this,
// zooming out on a slide whose native resolution isn't objective-power-
// aligned to the tile pyramid could show it shrunk below x1 well before it
// actually needs to. Same objectivePower/resolution formula the status
// bar's magnification label uses (see attachOverviewStatusBar), so "stop
// scrolling out at x1" and "the label reads x1" agree for a slide small
// enough that x1 and "whole slide" roughly coincide.
//
// The ladder's own coarsest tier (resolutions[0] - "whole slide, one
// tile") is always kept regardless of objectivePower, though, even when
// that means going below x1: for a slide many times bigger than a single
// tile at native resolution (e.g. a large .mrxs scan), that tier can sit
// at a tiny fraction of x1, and trimming it left no way to zoom out far
// enough to see the whole slide at all - a viewer that can't show the
// whole slide defeats the point of a *whole-slide* viewer. Without
// objectivePower, the ladder's own coarsest tier already sits at exactly
// x1 by construction (see formatMagnification's fallback), so there's
// nothing to trim either way.
function capResolutionsAtNativeScale(resolutions: number[], objectivePower: number | null): number[] {
  if (objectivePower === null) return resolutions
  const wholeSlideResolution = resolutions[0]
  const capped = resolutions.filter(
    (resolution) => resolution <= objectivePower || resolution === wholeSlideResolution
  )
  return capped.length > 0 ? capped : resolutions.slice(-1)
}

// OL's OverviewMap draws the current-viewport box at its true scale relative
// to the whole slide, with no minimum size - fine for a slide a few thousand
// pixels wide, but on something like slide 003 (101832x219976, ~14x larger
// than the CMU-1 sample) the box shrinks below a visible pixel at native
// zoom, so the overview stops showing where you are at all. Floors both
// dimensions so there's always a marker on screen; NaN (box not measured
// yet) also floors to `min` rather than propagating.
function clampOverviewBoxSize(
  width: number,
  height: number,
  min: number
): { width: number; height: number } {
  return {
    width: Number.isFinite(width) ? Math.max(width, min) : min,
    height: Number.isFinite(height) ? Math.max(height, min) : min,
  }
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

// Largest "nice" value (a 1-2-5 progression scaled by a power of ten) that
// doesn't exceed maxValue - the standard map-scale-bar algorithm, so the
// bar always reads a round number ("500 µm", "2 mm") rather than an
// arbitrary one ("438 µm") that happened to fit the available width.
function niceScaleValue(maxValue: number): number {
  if (maxValue <= 0) return 0
  const exponent = Math.floor(Math.log10(maxValue))
  const base = 10 ** exponent
  const fraction = maxValue / base
  const step = fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1
  return step * base
}

// Picks the bar's length (in whatever linear unit unitsPerScreenPixel is
// expressed in - microns, or raw image pixels when a slide has no mpp) and
// the on-screen pixel width that represents, capped at maxWidthPx.
function chooseScaleBarLength(
  unitsPerScreenPixel: number,
  maxWidthPx: number
): { length: number; widthPx: number } {
  if (!Number.isFinite(unitsPerScreenPixel) || unitsPerScreenPixel <= 0) {
    return { length: 0, widthPx: 0 }
  }
  const length = niceScaleValue(unitsPerScreenPixel * maxWidthPx)
  return { length, widthPx: length / unitsPerScreenPixel }
}

// `length` is already a round number by construction (see niceScaleValue),
// so unlike ruler.ts's formatDistanceMicrons this never needs to round -
// just to pick µm vs mm (1-2-5 scaled by 1000 is still 1-2-5, so the
// division is always exact).
function formatScaleLength(length: number, unit: 'micron' | 'pixel'): string {
  if (unit === 'pixel') return `${length} px`
  return length >= 1000 ? `${length / 1000} mm` : `${length} µm`
}

const MAX_SCALE_BAR_WIDTH_PX = 220

// A floating scale bar, bottom-right of the map - a plain OL Control (own
// overlay element, positioned via CSS, no backing rectangle) rather than
// something attached to the overview, so it isn't tied to the overview's
// position or visibility. Bar length in microns/pixels per on-screen pixel
// is resolution (image px per screen px) times mppX (microns per image px),
// or just resolution itself when the slide has no mpp data. Only mppX (not
// mppY) is used, matching how every other map viewer's horizontal scale bar
// works - a fine approximation even for the rare non-square-pixel slide.
function buildScaleBarControl(view: View, mppX: number | null): Control {
  // Positioning (bottom/right, in em) lives on this outer element, which
  // carries no font-size of its own - .ol-scalebar-chip's bigger font-size
  // stays local to the chip's own text/padding instead of also inflating
  // the em basis the outer element's bottom/right offsets are computed
  // against, which put an unwanted gap above the toolbar the last time
  // those two things shared a font-size on the same element.
  const element = document.createElement('div')
  element.className = 'ol-scalebar'

  const chip = document.createElement('div')
  chip.className = 'ol-scalebar-chip'

  const line = document.createElement('div')
  line.className = 'ol-scalebar-line'

  const label = document.createElement('span')
  label.className = 'ol-scalebar-label'

  const update = () => {
    const resolution = view.getResolution() ?? 1
    const unitsPerScreenPixel = mppX !== null ? resolution * mppX : resolution
    const { length, widthPx } = chooseScaleBarLength(unitsPerScreenPixel, MAX_SCALE_BAR_WIDTH_PX)
    line.style.width = `${widthPx}px`
    label.textContent = formatScaleLength(length, mppX !== null ? 'micron' : 'pixel')
  }

  view.on('change:resolution', update)
  update()

  chip.appendChild(line)
  chip.appendChild(label)
  element.appendChild(chip)

  return new Control({ element })
}

export function OpenLayerMap(
  target: HTMLElement,
  size: ImageSize,
  spec: BaseLayerSpec,
  objectivePower: number | null = null,
  mppX: number | null = null,
  extraLayers: BaseLayer[] = []
): Map {
  const extent = getExtent(size)
  const projection = olProjection(extent)
  const resolutions = computeResolutionLadder(size, spec.tileSize)
  const viewResolutions = capResolutionsAtNativeScale(resolutions, objectivePower)

  const baseLayer = buildBaseLayer(spec, projection, extent, size)

  const map = new Map({
    target,
    layers: [baseLayer, ...extraLayers],
    view: olView(projection, viewResolutions),
  })

  // Overview panel: whole-slide thumbnail with a box showing the current
  // viewport, which shrinks/grows as you zoom - draggable/clickable to
  // reposition the main view. Needs its own explicit view - left to its
  // default, OverviewMap assumes a standard web-mercator-ish projection,
  // which silently fails to render anything in our custom pixel one.
  // resolutions[0] (the coarsest tier) frames the whole slide directly, no
  // fit()-after-attach timing to worry about. No `resolutions` constraint
  // here (see the re-fit listener below) - letting it pick an exact
  // continuous resolution avoids snapping to a ladder step that doesn't
  // quite match the overview container's aspect ratio.
  const overview = new OverviewMap({
    view: new View({
      projection,
      center: [size.width / 2, -size.height / 2],
      resolution: resolutions[0],
    }),
    layers: [buildBaseLayer(spec, projection, extent, size)],
    collapsed: false,
    collapsible: true,
  })
  map.addControl(overview)
  map.addControl(buildScaleBarControl(map.getView(), mppX))

  // OL's OverviewMap automatically rescales/recenters its *own* view to keep
  // the tracked box within a comfortable size ratio (see ol/control/
  // OverviewMap's MIN_RATIO/MAX_RATIO) - sensible for an open-ended map, but
  // wrong here: the overview should always frame the whole slide, unchanged,
  // with only the box reflecting the current viewport. Re-fit it back to the
  // full extent after every main-view change, undoing whatever automatic
  // rescale/recenter OL's own logic just applied - without this, zooming
  // back out left the overview's own frame stuck more zoomed-in than it
  // started, so the box (and visible thumbnail) no longer matched reality.
  const overviewView = overview.getOverviewMap().getView()
  map.getView().on('change', () => overviewView.fit(extent))

  const overviewContainer = target.querySelector<HTMLElement>('.ol-overviewmap')
  if (overviewContainer) {
    attachOverviewStatusBar(overview, overviewContainer, map.getView(), resolutions, objectivePower)

    // OverviewMap recomputes the box's width/height from scratch in its own
    // 'postrender' handler (registered by addControl() above, so it runs
    // before this one on the same event) - floor it right after, every
    // frame, rather than trying to fight OL for control of the style once.
    const overviewBox = overviewContainer.querySelector<HTMLElement>('.ol-overviewmap-box')
    if (overviewBox) {
      map.on('postrender', () => {
        const { width, height } = clampOverviewBoxSize(
          parseFloat(overviewBox.style.width),
          parseFloat(overviewBox.style.height),
          MIN_OVERVIEW_BOX_PX
        )
        overviewBox.style.width = `${width}px`
        overviewBox.style.height = `${height}px`
      })
    }
  }

  map.getView().fit(extent)
  return map
}

export {
  getExtent,
  computeResolutionLadder,
  capResolutionsAtNativeScale,
  clampOverviewBoxSize,
  niceScaleValue,
  chooseScaleBarLength,
  formatScaleLength,
}
export type { ImageSize, BaseLayerSpec }
