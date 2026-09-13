// Straight-line distance between two points, in whatever unit dx/dy are
// already expressed in (image pixels, most of the time).
function pixelDistance(dx: number, dy: number): number {
  return Math.hypot(dx, dy)
}

// Same, but scaled per-axis by microns-per-pixel before combining - not just
// pixelDistance() times an average mpp, since mppX/mppY can differ (non-
// square pixels) and a diagonal drag mixes both axes.
function physicalDistanceMicrons(dx: number, dy: number, mppX: number, mppY: number): number {
  return Math.hypot(dx * mppX, dy * mppY)
}

// Same tiered rounding as OpenLayers.ts's formatMagnification: integer once
// a value reaches double digits, one decimal place below that - keeps a
// measured distance from ever showing false precision like "733.4827 µm".
function roundTiered(value: number): number {
  if (value >= 10) return Math.round(value)
  return Math.round(value * 10) / 10
}

function formatDistanceMicrons(microns: number): string {
  if (microns >= 1000) return `${roundTiered(microns / 1000)} mm`
  return `${roundTiered(microns)} µm`
}

function formatDistancePixels(pixels: number): string {
  return `${Math.round(pixels)} px`
}

export { pixelDistance, physicalDistanceMicrons, formatDistanceMicrons, formatDistancePixels }
