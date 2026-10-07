// Wire shapes for realtime-hub (see realtime-hub/README.md) plus the small
// pure bits the context and map need, kept here so they're testable.

import type OlMap from 'ol/Map'
import type View from 'ol/View'
import type { LineStyleName, ShapeTool } from '../annotation/Tools'
import type { ImageAdjustmentValues } from '../adjustments/adjustments'

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
  // The session's collection id - see CollectionContext.
  roomId: string
  userId: string
  displayName: string
  colour: string
  joined: string
  // Whether they own the session, and whether they're more than view only -
  // only they get asked into counts.
  host: boolean
  canEdit: boolean
  viewport: Viewport | null
  // What they're part way through, one per tool - see sketchFor.
  sketches: Partial<Record<SketchTool, Sketch>> | null
  screen: Screen | null
}

// What's on someone's screen besides the map, for Present. tabs is which
// tab each panel is on, by panel id. viewedCellCountId is a saved count
// shown on the map. The two being edited are only for telling view-only
// watchers what the host is up to - nobody else gets put into editing.
// The hub never looks inside.
interface Screen {
  panels: string[]
  tabs: Record<string, string>
  adjustments: ImageAdjustmentValues | null
  viewedCellCountId: string | null
  editingAnnotationId: string | null
  editingCellCountId: string | null
}

// How everyone moves round the slide - see the hub's NavigationMode.
type NavigationMode = 'free' | 'follow' | 'present'

// The host asking you to do something - you can always say no.
type HostRequest = { fromConnectionId: string; fromName: string } & (
  | { kind: 'look'; data: Viewport }
  | { kind: 'openPanel'; data: { panel: string } }
)

interface ScreenUpdate {
  connectionId: string
  screen: Screen
}

// Something someone is part way through drawing. The hub never looks
// inside data, it just passes it on and keeps the latest for late joiners.
type Sketch =
  | { tool: 'annotation'; data: AnnotationSketch }
  | { tool: 'ruler'; data: RulerSketch }
  | { tool: 'cellCount'; data: CellCountSketch }

// The host's count as it goes, for everyone watching them present. count
// is the tally - it can be more than the dots, since a count can be taken
// without placing any.
interface CellCountSketch {
  dots: { x: number; y: number; colour: string }[]
  dotSize: number
  count: number
  roiGeoJson: string | null
}

// A measuring line, end to end in map units. Done once they let go - it
// stays up for everyone until they clear it or start another. The distance
// isn't sent, everyone works it out from the same slide.
interface RulerSketch {
  from: Coord
  to: Coord
  done: boolean
}

interface AnnotationSketch {
  shape: ShapeTool
  colour: string
  lineThickness: number
  lineStyle: LineStyleName
  geoJson: string
}

type SketchTool = Sketch['tool']

// Null once they finish or give up with that tool.
interface SketchUpdate {
  connectionId: string
  tool: SketchTool
  sketch: Sketch | null
}

// Someone's sketch for one tool, typed for that tool.
function sketchFor<T extends SketchTool>(participant: Participant, tool: T): Extract<Sketch, { tool: T }> | null {
  const sketch = participant.sketches?.[tool]
  return sketch?.tool === tool ? (sketch as Extract<Sketch, { tool: T }>) : null
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
// collection is a nudge that someone's membership changed - see CollectionContext.
type OpEntity = 'annotation' | 'cellCount' | 'collection'

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

// Comparison count - see realtime-hub/README.md. Dots are null on everyone
// until it's revealed.
type CounterState = 'invited' | 'counting' | 'submitted'

interface ComparisonDot {
  x: number
  y: number
}

interface Counter {
  connectionId: string
  displayName: string
  colour: string
  state: CounterState
  dots: ComparisonDot[] | null
}

interface ComparisonSettings {
  roiGeoJson: string
  dotSize: number
  // Map units. Dots closer than this are the same cell.
  matchRadius: number
}

interface Comparison {
  id: string
  hostConnectionId: string
  settings: ComparisonSettings
  started: string
  revealed: boolean
  counters: Counter[]
}

// Shared count - see realtime-hub/README.md. left is someone who joined and
// went, kept so their dots still have a name.
type ContributorState = 'invited' | 'joined' | 'left'

interface Contributor {
  connectionId: string
  userId: string
  displayName: string
  colour: string
  state: ContributorState
}

// connectionId is whoever placed it - the hub fills it in.
interface SharedDot {
  id: string
  x: number
  y: number
  colour: string
  connectionId: string
}

interface SharedCountSettings {
  // Null for the whole slide.
  roiGeoJson: string | null
  dotSize: number
  matchRadius: number
}

interface SharedCount {
  id: string
  hostConnectionId: string
  settings: SharedCountSettings
  started: string
  contributors: Contributor[]
  dots: SharedDot[]
}

interface SharedDotAdded {
  sharedCountId: string
  dot: SharedDot
}

interface SharedDotRemoved {
  sharedCountId: string
  dotId: string
}

interface JoinResult {
  me: Participant
  others: Participant[]
  seq: number
  comparison: Comparison | null
  sharedCount: SharedCount | null
  navigation: NavigationMode
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

// The host everyone follows - the first of their connections that has
// said where it is.
function leaderOf(others: Participant[]): Participant | null {
  return others.find((p) => p.host && p.viewport) ?? null
}

// Where to put your view to see roughly what the host sees. Screens differ,
// so it's fitted rather than copied - the host's whole view fits on yours,
// at their rotation.
function followView(host: Viewport, size: [number, number]): Pick<Viewport, 'center' | 'resolution' | 'rotation'> {
  const [minX, minY, maxX, maxY] = host.extent
  const resolution = Math.max((maxX - minX) / size[0], (maxY - minY) / size[1])
  return { center: host.center, resolution: Number.isFinite(resolution) && resolution > 0 ? resolution : host.resolution, rotation: host.rotation }
}

type ViewState = Pick<Viewport, 'center' | 'resolution' | 'rotation'>

// Whether the view is still where following put it - so something else
// nudging it to the same place (a rotation round-tripped through degrees,
// say) doesn't count as moving away. Rotation is compared round the circle.
function sameView(a: ViewState, b: ViewState): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) <= b.resolution / 2
  const turn = Math.abs(a.rotation - b.rotation) % (2 * Math.PI)
  return (
    near(a.center[0], b.center[0]) &&
    near(a.center[1], b.center[1]) &&
    Math.abs(a.resolution / b.resolution - 1) < 1e-6 &&
    Math.min(turn, 2 * Math.PI - turn) < 1e-6
  )
}

// Panels that never follow the host - the RealTime panel is everyone's own.
const UNSHARED_PANELS = ['realtime']

// What changed between two lists of the host's open panels.
function panelChanges(before: string[], after: string[]): { open: string[]; close: string[] } {
  const shared = (panels: string[]) => panels.filter((p) => !UNSHARED_PANELS.includes(p))
  const was = shared(before)
  const now = shared(after)
  return { open: now.filter((p) => !was.includes(p)), close: was.filter((p) => !now.includes(p)) }
}

// Tabs the host has moved to since last time, by panel.
function tabChanges(before: Record<string, string>, after: Record<string, string>): [string, string][] {
  return Object.entries(after).filter(([panel, tab]) => !UNSHARED_PANELS.includes(panel) && before[panel] !== tab)
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
  sketchFor,
  leaderOf,
  followView,
  sameView,
  panelChanges,
  tabChanges,
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
  ViewState,
  Participant,
  NavigationMode,
  Screen,
  ScreenUpdate,
  HostRequest,
  Sketch,
  AnnotationSketch,
  RulerSketch,
  CellCountSketch,
  SketchUpdate,
  SketchTool,
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
  CounterState,
  ComparisonDot,
  Counter,
  ComparisonSettings,
  Comparison,
  ContributorState,
  Contributor,
  SharedDot,
  SharedCountSettings,
  SharedCount,
  SharedDotAdded,
  SharedDotRemoved,
}
