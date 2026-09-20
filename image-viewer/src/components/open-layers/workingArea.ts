import type { Extent } from 'ol/extent'
import type { BotRegion } from '../connectome/types'

interface SlideSize {
  width: number
  height: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

// The bot's region is normalized [0,1], image-space, top-left origin, y
// increasing downward - the map's own extent is Y-flipped (see this file's
// getExtent in OpenLayers.ts: [0, -height, width, 0]), so a drawn box's
// screen-up edge is the *largest* map Y, not the smallest. Each edge is
// clamped to [0,1] independently, then width/height derived from the
// clamped edges - a box dragged partly (or entirely) off the slide (the
// view has no extent constraint - see OpenLayers.ts's olView) still comes
// out as a valid, non-negative region rather than one with x+width > 1 or a
// negative size.
function extentToRegion(extent: Extent, slideSize: SlideSize): BotRegion {
  const [minX, minY, maxX, maxY] = extent
  const imageTopY = -maxY
  const imageBottomY = -minY

  const x0 = clamp01(minX / slideSize.width)
  const x1 = clamp01(maxX / slideSize.width)
  const y0 = clamp01(imageTopY / slideSize.height)
  const y1 = clamp01(imageBottomY / slideSize.height)

  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

// The inverse - used to draw the currently-set region back onto the map
// (see MapNode). Mirrors flywire-bot/src/annotationStore/payloads.ts's
// projectToMapCoordinates exactly (x = normalized.x * slide.width;
// y = -(normalized.y * slide.height)), applied to both corners.
function regionToExtent(region: BotRegion, slideSize: SlideSize): Extent {
  const imageMinX = region.x * slideSize.width
  const imageMaxX = (region.x + region.width) * slideSize.width
  const imageTopY = region.y * slideSize.height
  const imageBottomY = (region.y + region.height) * slideSize.height

  return [imageMinX, -imageBottomY, imageMaxX, -imageTopY]
}

export { clamp01, extentToRegion, regionToExtent }
export type { SlideSize }
