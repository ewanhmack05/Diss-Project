// Wire shapes for realtime-hub (see realtime-hub/README.md) plus the small
// pure bits the context and map need, kept here so they're testable.

import type OlMap from 'ol/Map'
import type View from 'ol/View'
import type { LineStyleName, ShapeTool } from '../annotation/Tools'

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
  sketch: Sketch | null
}

// Something someone is part way through drawing. The hub never looks
// inside data, it just passes it on and keeps the latest for late joiners.
type Sketch = { tool: 'annotation'; data: AnnotationSketch }

interface AnnotationSketch {
  shape: ShapeTool
  colour: string
  lineThickness: number
  lineStyle: LineStyleName
  geoJson: string
}

interface SketchUpdate {
  connectionId: string
  sketch: Sketch | null
}

// Shared docs carry raw Yjs updates, base64 on the wire.
interface DocStateWire {
  docId: string
  instanceId: string
  seeded: boolean
  updates: string[]
  editors: string[]
}

interface DocState {
  instanceId: string
  // True when the hub started the doc from our seed.
  seeded: boolean
  updates: Uint8Array[]
  editors: string[]
}

interface DocUpdateWire {
  docId: string
  connectionId: string
  update: string
}

interface DocEditors {
  docId: string
  editors: string[]
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

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function docStateFromWire(wire: DocStateWire): DocState {
  return {
    instanceId: wire.instanceId,
    seeded: wire.seeded,
    updates: wire.updates.map(fromBase64),
    editors: wire.editors,
  }
}

// Calls onMove whenever the view pans, zooms, rotates or the map resizes.
// Listens to the per-property events, not the view's 'change' - OL only
// fires that when an interaction starts or ends, so a drag would go quiet
// until the mouse was released. Returns an unsubscribe.
function watchView(view: View, map: OlMap, onMove: () => void): () => void {
  const viewEvents = ['change:center', 'change:resolution', 'change:rotation'] as const
  viewEvents.forEach((type) => view.on(type, onMove))
  map.on('change:size', onMove)
  return () => {
    viewEvents.forEach((type) => view.un(type, onMove))
    map.un('change:size', onMove)
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
  // Sends whatever's waiting now rather than at the end of the window.
  throttled.flush = () => {
    if (timer) clearTimeout(timer)
    flush()
  }
  return throttled
}

// Calls fn once calls stop for `ms`, with the latest args. flush() runs a
// waiting call straight away, for when the caller is about to go away.
function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null

  const run = () => {
    timer = null
    if (!pending) return
    const args = pending
    pending = null
    fn(...args)
  }

  const debounced = (...args: A) => {
    pending = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(run, ms)
  }
  debounced.flush = () => {
    if (timer) clearTimeout(timer)
    run()
  }
  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pending = null
  }
  return debounced
}

export {
  applyOp,
  viewportRing,
  viewportFrom,
  watchView,
  throttle,
  debounce,
  toBase64,
  fromBase64,
  docStateFromWire,
}
export type {
  Viewport,
  Participant,
  Sketch,
  AnnotationSketch,
  SketchUpdate,
  DocState,
  DocStateWire,
  DocUpdateWire,
  DocEditors,
  ViewportUpdate,
  OpKind,
  OpEntity,
  AnnotationOp,
  StampedOp,
  JoinResult,
}
