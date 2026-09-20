import type { BotEvent, SeedConnection, SeedNeuron } from './types'

// Mirrors flywire-bot/src/annotationStore/payloads.ts's SUPER_CLASS_PALETTE
// value-for-value, so a neuron reads the same colour here as it does in the
// bot's own slide annotations - copied rather than imported since the two
// are separate services with no shared internals.
const SUPER_CLASS_PALETTE: Record<string, string> = {
  central: '#8B5CF6',
  visual_projection: '#EC4899',
  optic: '#F59E0B',
  sensory: '#10B981',
  motor: '#3B82F6',
  ascending: '#14B8A6',
  descending: '#EF4444',
  endocrine: '#84CC16',
  visual_centrifugal: '#F97316',
  unclassified: '#6B7280',
}

const FALLBACK_PALETTE = Object.values(SUPER_CLASS_PALETTE)

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

// superClass values outside the fixed table (there are dozens of
// finer-grained ones in the real FlyWire data) fall back to a deterministic
// hash into the same palette - same string always lands on the same colour,
// same as the bot side.
function colourForSuperClass(superClass: string): string {
  return SUPER_CLASS_PALETTE[superClass] ?? FALLBACK_PALETTE[hashString(superClass) % FALLBACK_PALETTE.length]
}

// Neuron coordinates arrive normalised to [0,1] per axis - centers the whole
// cloud on the origin and spreads it out to a size OrbitControls' default
// zoom/pan speed reads well against.
const SCENE_EXTENT = 200

function toSceneSpace(coord: number, extent: number = SCENE_EXTENT): number {
  return (coord - 0.5) * extent
}

function hexToRgb01(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ]
}

interface NeuronBuffers {
  positions: Float32Array
  colors: Float32Array
  indexById: Map<string, number>
}

// Plain typed arrays, not Three.js objects - so this (and buildConnectionBuffers
// below) can be unit-tested without a WebGL context. The panel hands these
// straight to BufferGeometry/BufferAttribute as-is.
function buildNeuronBuffers(neurons: SeedNeuron[], extent: number = SCENE_EXTENT): NeuronBuffers {
  const positions = new Float32Array(neurons.length * 3)
  const colors = new Float32Array(neurons.length * 3)
  const indexById = new Map<string, number>()

  neurons.forEach((neuron, index) => {
    positions[index * 3] = toSceneSpace(neuron.x, extent)
    positions[index * 3 + 1] = toSceneSpace(neuron.y, extent)
    positions[index * 3 + 2] = toSceneSpace(neuron.z, extent)

    const [r, g, b] = hexToRgb01(colourForSuperClass(neuron.superClass))
    colors[index * 3] = r
    colors[index * 3 + 1] = g
    colors[index * 3 + 2] = b

    indexById.set(neuron.id, index)
  })

  return { positions, colors, indexById }
}

function connectionKey(preId: string, postId: string): string {
  return `${preId}->${postId}`
}

const REST_EDGE_COLOR: [number, number, number] = [0.4, 0.4, 0.45]

interface ConnectionBuffers {
  positions: Float32Array
  colors: Float32Array
  segmentIndexByKey: Map<string, number>
}

// The contract guarantees every seed connection's preId/postId resolves to a
// seed neuron, but this drops anything that doesn't rather than trusting
// that - a bot event arriving against a stale or partial seed shouldn't be
// able to crash buffer construction.
function buildConnectionBuffers(
  connections: SeedConnection[],
  neuronPositions: Float32Array,
  indexById: Map<string, number>,
  restingColor: [number, number, number] = REST_EDGE_COLOR
): ConnectionBuffers {
  const valid = connections.filter((connection) => indexById.has(connection.preId) && indexById.has(connection.postId))
  const positions = new Float32Array(valid.length * 6)
  const colors = new Float32Array(valid.length * 6)
  const segmentIndexByKey = new Map<string, number>()

  valid.forEach((connection, segmentIndex) => {
    const preIndex = indexById.get(connection.preId)!
    const postIndex = indexById.get(connection.postId)!
    const offset = segmentIndex * 6

    positions.set(neuronPositions.subarray(preIndex * 3, preIndex * 3 + 3), offset)
    positions.set(neuronPositions.subarray(postIndex * 3, postIndex * 3 + 3), offset + 3)
    colors.set(restingColor, offset)
    colors.set(restingColor, offset + 3)

    segmentIndexByKey.set(connectionKey(connection.preId, connection.postId), segmentIndex)
  })

  return { positions, colors, segmentIndexByKey }
}

// Never throws - anything that isn't valid JSON, or parses but doesn't match
// one of the three known event shapes, is treated as noise from a bot
// version this panel doesn't understand yet rather than a fatal error.
function parseBotEvent(raw: string): BotEvent | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null

  const record = data as Record<string, unknown>
  if (typeof record.tick !== 'number' || typeof record.timestamp !== 'string') return null

  if (record.type === 'annotation' || record.type === 'cellCount') {
    if (typeof record.neuronId !== 'string') return null
    return { type: record.type, tick: record.tick, neuronId: record.neuronId, timestamp: record.timestamp }
  }

  if (record.type === 'pathway') {
    if (typeof record.preId !== 'string' || typeof record.postId !== 'string') return null
    return {
      type: 'pathway',
      tick: record.tick,
      preId: record.preId,
      postId: record.postId,
      timestamp: record.timestamp,
    }
  }

  return null
}

function toWebSocketUrl(httpUrl: string): string {
  if (httpUrl.startsWith('https://')) return `wss://${httpUrl.slice('https://'.length)}`
  if (httpUrl.startsWith('http://')) return `ws://${httpUrl.slice('http://'.length)}`
  return httpUrl
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

// Fraction of an animation's duration elapsed, clamped to [0,1] - a frame
// arriving late (a slow tab, a burst of bot events) never overshoots into an
// out-of-range progress value for the callers below.
function pulseProgress(elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0) return 1
  return clamp01(elapsedMs / durationMs)
}

// One smooth hump - 0 at both ends, 1 at the midpoint - so a pulse grows in
// and fades back out with no separate "which half am I in" branch.
function pulseIntensity(progress: number): number {
  return Math.sin(clamp01(progress) * Math.PI)
}

function easeInOutQuad(t: number): number {
  const c = clamp01(t)
  return c < 0.5 ? 2 * c * c : 1 - (-2 * c + 2) ** 2 / 2
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// Where a travelling synapse pulse sits between its two neurons at a given
// progress through the animation - eased so it starts and ends gently
// rather than moving at a constant speed.
function travelPoint(
  pre: readonly [number, number, number],
  post: readonly [number, number, number],
  progress: number
): [number, number, number] {
  const t = easeInOutQuad(progress)
  return [lerp(pre[0], post[0], t), lerp(pre[1], post[1], t), lerp(pre[2], post[2], t)]
}

export {
  SCENE_EXTENT,
  SUPER_CLASS_PALETTE,
  REST_EDGE_COLOR,
  colourForSuperClass,
  toSceneSpace,
  hexToRgb01,
  buildNeuronBuffers,
  buildConnectionBuffers,
  connectionKey,
  parseBotEvent,
  toWebSocketUrl,
  clamp01,
  pulseProgress,
  pulseIntensity,
  easeInOutQuad,
  lerp,
  travelPoint,
}
export type { NeuronBuffers, ConnectionBuffers }
