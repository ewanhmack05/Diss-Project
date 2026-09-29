// Wire shapes for realtime-hub (see realtime-hub/README.md) plus the small
// pure bits the context and map need, kept here so they're testable.

type Coord = [number, number]

interface Viewport {
  center: Coord
  resolution: number
  rotation: number
  // The view box before rotation - centre ± half the screen size, in map
  // units. Turn it by `rotation` round the centre to get what's on screen.
  extent: [number, number, number, number]
}

interface Participant {
  connectionId: string
  slideId: string
  userId: string
  displayName: string
  colour: string
  joined: string
  viewport: Viewport | null
}

interface ViewportUpdate {
  connectionId: string
  viewport: Viewport
}

type OpKind = 'create' | 'update' | 'delete'
type OpEntity = 'annotation' | 'cellCount'

interface AnnotationOp {
  kind: OpKind
  entity: OpEntity
  id: string
  // Whole item for create, just the changed fields for update.
  data?: unknown
}

interface StampedOp {
  seq: number
  serverTime: string
  connectionId: string
  userId: string
  op: AnnotationOp
}

interface JoinResult {
  me: Participant
  others: Participant[]
  seq: number
}

// Applies someone else's op to a local list. A create for an id we already
// have is ignored rather than duplicated.
function applyOp<T extends { id: string }>(items: T[], op: AnnotationOp): T[] {
  switch (op.kind) {
    case 'create':
      return items.some((item) => item.id === op.id) ? items : [...items, op.data as T]
    case 'update':
      return items.map((item) => (item.id === op.id ? { ...item, ...(op.data as Partial<T>) } : item))
    case 'delete':
      return items.filter((item) => item.id !== op.id)
  }
}

// What someone can actually see, as a closed ring: their unrotated box
// turned by their rotation round the centre. Same maths OL uses for its own
// rotated viewport. Starts at their top-left.
function viewportRing({ center, rotation, extent }: Viewport): Coord[] {
  const [cx, cy] = center
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const turn = ([x, y]: Coord): Coord => {
    const dx = x - cx
    const dy = y - cy
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
  }
  const [minX, minY, maxX, maxY] = extent
  const topLeft = turn([minX, maxY])
  return [topLeft, turn([maxX, maxY]), turn([maxX, minY]), turn([minX, minY]), topLeft]
}

// Builds a Viewport from an OL view's state and the map's pixel size.
function viewportFrom(center: Coord, resolution: number, rotation: number, size: Coord): Viewport {
  const halfWidth = (size[0] * resolution) / 2
  const halfHeight = (size[1] * resolution) / 2
  return {
    center,
    resolution,
    rotation,
    extent: [center[0] - halfWidth, center[1] - halfHeight, center[0] + halfWidth, center[1] + halfHeight],
  }
}

// Calls fn at most once per `ms`, always with the latest args - the last
// call in a burst is never dropped, so others end up where you stopped.
function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null

  const flush = () => {
    timer = null
    last = Date.now()
    if (pending) {
      const args = pending
      pending = null
      fn(...args)
    }
  }

  const throttled = (...args: A) => {
    pending = args
    if (timer) return
    const wait = ms - (Date.now() - last)
    if (wait <= 0) flush()
    else timer = setTimeout(flush, wait)
  }
  throttled.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pending = null
  }
  return throttled
}

export { applyOp, viewportRing, viewportFrom, throttle }
export type {
  Viewport,
  Participant,
  ViewportUpdate,
  OpKind,
  OpEntity,
  AnnotationOp,
  StampedOp,
  JoinResult,
}
