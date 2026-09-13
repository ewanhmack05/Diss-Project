const DEGREES_PER_TURN = 360

function normalizeDegrees(deg: number): number {
  const wrapped = deg % DEGREES_PER_TURN
  return wrapped < 0 ? wrapped + DEGREES_PER_TURN : wrapped
}

function degreesToRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

function radiansToDegrees(rad: number): number {
  return normalizeDegrees((rad * 180) / Math.PI)
}

// Used by the quick-adjust buttons (±90/±15) - just an offset, normalized.
function stepRotation(current: number, step: number): number {
  return normalizeDegrees(current + step)
}

// The signed delta (-180, 180] to travel from `from` to `to` the short way
// round the circle - e.g. shortestRotationDelta(350, 5) is +15, not -345.
// Used to animate Reset (and any other jump-to-target) via the shorter arc.
function shortestRotationDelta(from: number, to: number): number {
  const raw = normalizeDegrees(to) - normalizeDegrees(from)
  return ((raw + 180) % DEGREES_PER_TURN + DEGREES_PER_TURN) % DEGREES_PER_TURN - 180
}

export { normalizeDegrees, degreesToRadians, radiansToDegrees, stepRotation, shortestRotationDelta }
