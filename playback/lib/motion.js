// Where the pointer goes between two points. Eased so it reads as a hand
// on video, not a teleport. No randomness - the same scene moves the same way.

export function easedPath(from, to, steps) {
  const count = Math.max(1, Math.round(steps))
  const points = []
  for (let i = 1; i <= count; i++) {
    const t = i / count
    const eased = t * t * (3 - 2 * t)
    points.push({ x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased })
  }
  return points
}

// About one step per 10px, so long moves take longer but never crawl.
export function stepsFor(from, to) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  return Math.min(40, Math.max(6, Math.round(distance / 10)))
}

// Every point along a list of waypoints, for drawing and dragging.
export function pathThrough(points, stepsEach = 6) {
  const out = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    for (let step = 1; step <= stepsEach; step++) {
      const t = step / stepsEach
      out.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
    }
  }
  return out
}

export function arc(center, radius, fromDegrees, toDegrees, steps) {
  const points = []
  for (let i = 0; i <= steps; i++) {
    const radians = ((fromDegrees + ((toDegrees - fromDegrees) * i) / steps) * Math.PI) / 180
    points.push({ x: center.x + radius * Math.cos(radians), y: center.y + radius * Math.sin(radians) })
  }
  return points
}

// A wobbly closed loop, for tracing round something freehand.
export function wobblyLoop(center, radius, steps = 48) {
  return arc(center, radius, 0, 360, steps).map((point, i) => {
    const wobble = 1 + 0.12 * Math.sin((i / steps) * Math.PI * 10)
    return {
      x: center.x + (point.x - center.x) * wobble,
      y: center.y + (point.y - center.y) * wobble,
    }
  })
}

// Where to drop the pointer on a range input to land on a value.
export function sliderX(box, min, max, value) {
  const fraction = Math.min(1, Math.max(0, (value - min) / (max - min)))
  return box.x + box.width * fraction
}
