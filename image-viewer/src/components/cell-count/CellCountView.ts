import { boundingExtent, buffer, type Extent } from 'ol/extent'
import type { Coordinate } from 'ol/coordinate'

const FIT_PADDING = 40
const LOCATION_ONLY_HALF_SIZE = 10

// What "View" fits to, in order: the ROI box, then the dots, then a small
// pad around the location, then nothing. Pulled out of MapNode so it's
// unit-testable without a live map.
function computeViewedCellCountExtent(
  dots: { x: number; y: number }[],
  roiExtent: Extent | null,
  location: { x: number; y: number } | null
): Extent | null {
  if (roiExtent) return buffer(roiExtent, FIT_PADDING)

  if (dots.length > 0) {
    return buffer(boundingExtent(dots.map(({ x, y }): Coordinate => [x, y])), FIT_PADDING)
  }

  if (location) {
    return [
      location.x - LOCATION_ONLY_HALF_SIZE,
      location.y - LOCATION_ONLY_HALF_SIZE,
      location.x + LOCATION_ONLY_HALF_SIZE,
      location.y + LOCATION_ONLY_HALF_SIZE,
    ]
  }

  return null
}

// The "View" button toggles: clicking the one already showing turns it off.
function toggleViewedCellCountId(current: string | null, clickedId: string): string | null {
  return current === clickedId ? null : clickedId
}

export { computeViewedCellCountExtent, toggleViewedCellCountId }
