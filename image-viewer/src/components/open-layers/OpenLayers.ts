import { Map, View } from 'ol'
import ImageLayer from 'ol/layer/Image'
import ImageStatic from 'ol/source/ImageStatic'
import TileLayer from 'ol/layer/Tile'
import Zoomify from 'ol/source/Zoomify'
import Projection from 'ol/proj/Projection'
import type BaseLayer from 'ol/layer/Base'

interface ImageSize {
  width: number
  height: number
}

const DEFAULT_TILE_SIZE = 256

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

function staticImageLayer(
  imagePath: string,
  projection: Projection,
  extent: number[]
): ImageLayer<ImageStatic> {
  return new ImageLayer({
    source: new ImageStatic({
      url: imagePath,
      projection,
      imageExtent: extent,
    }),
  })
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

type BaseLayerSpec =
  | { kind: 'static'; imagePath: string }
  | { kind: 'zoomify'; baseUrl: string; tileSize: number }

export function OpenLayerMap(
  target: HTMLElement,
  size: ImageSize,
  spec: BaseLayerSpec,
  extraLayers: BaseLayer[] = []
): Map {
  const extent = getExtent(size)
  const projection = olProjection(extent)
  const tileSize = spec.kind === 'zoomify' ? spec.tileSize : DEFAULT_TILE_SIZE
  const resolutions = computeResolutionLadder(size, tileSize)

  const baseLayer =
    spec.kind === 'static'
      ? staticImageLayer(spec.imagePath, projection, extent)
      : zoomifyLayer(spec.baseUrl, spec.tileSize, size, projection, extent)

  const map = new Map({
    target,
    layers: [baseLayer, ...extraLayers],
    view: olView(projection, resolutions),
  })
  map.getView().fit(extent)
  return map
}

export { getExtent }
export type { ImageSize, BaseLayerSpec }
