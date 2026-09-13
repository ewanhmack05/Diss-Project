interface ImageAdjustmentValues {
  brightness: number
  contrast: number
  gamma: number
  red: number
  green: number
  blue: number
}

const DEFAULT_ADJUSTMENTS: ImageAdjustmentValues = {
  brightness: 0,
  contrast: 0,
  gamma: 1,
  red: 1,
  green: 1,
  blue: 1,
}

const RANGES: Record<keyof ImageAdjustmentValues, [number, number]> = {
  brightness: [-1, 1],
  contrast: [-1, 1],
  gamma: [0.1, 3],
  red: [0, 2],
  green: [0, 2],
  blue: [0, 2],
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// Missing/non-finite fields fall back to that field's own default, not the
// whole object's - so a partial patch (e.g. just { red: 5 }) still clamps
// red and leaves the other five at their individual defaults rather than
// wiping them all back to DEFAULT_ADJUSTMENTS.
function clampAdjustmentValues(values: Partial<ImageAdjustmentValues>): ImageAdjustmentValues {
  const result = {} as ImageAdjustmentValues
  for (const key of Object.keys(RANGES) as (keyof ImageAdjustmentValues)[]) {
    const [min, max] = RANGES[key]
    const value = values[key]
    result[key] = typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : DEFAULT_ADJUSTMENTS[key]
  }
  return result
}

function parseAdjustments(json: string): ImageAdjustmentValues {
  try {
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_ADJUSTMENTS }
    return clampAdjustmentValues(parsed as Partial<ImageAdjustmentValues>)
  } catch {
    return { ...DEFAULT_ADJUSTMENTS }
  }
}

function serializeAdjustments(values: ImageAdjustmentValues): string {
  return JSON.stringify(values)
}

// Used to build the body of a preset "Update" PUT: the backend endpoint
// mirrors Annotation's PUT, which overwrites every field it's given rather
// than patching only what changed - sending just { adjustments } would blank
// the preset's own name server-side, so this carries the rest of the preset
// through untouched alongside the new adjustments.
function withUpdatedAdjustments<T extends { adjustments: string }>(
  preset: T,
  values: ImageAdjustmentValues
): T {
  return { ...preset, adjustments: serializeAdjustments(values) }
}

export {
  DEFAULT_ADJUSTMENTS,
  clampAdjustmentValues,
  parseAdjustments,
  serializeAdjustments,
  withUpdatedAdjustments,
}
export type { ImageAdjustmentValues }
