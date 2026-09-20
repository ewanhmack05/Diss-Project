// Mirrors the live connectome server's contract exactly (see flywire-bot's
// live server, built alongside this panel) - this file has no dependency on
// that service, just the shapes it promises to send.

interface SeedNeuron {
  id: string
  label: string
  superClass: string
  side: string | null
  neurotransmitter: string | null
  x: number
  y: number
  z: number
}

interface SeedConnection {
  preId: string
  postId: string
  synapses: number
  neurotransmitter: string | null
}

interface SeedMeta {
  generatedAt: string
  source: string
  citation: string
  neuronCount: number
  connectionCount: number
}

interface SeedFile {
  meta: SeedMeta
  neurons: SeedNeuron[]
  connections: SeedConnection[]
}

type BotEvent =
  | { type: 'annotation'; tick: number; neuronId: string; timestamp: string }
  | { type: 'cellCount'; tick: number; neuronId: string; timestamp: string }
  | { type: 'pathway'; tick: number; preId: string; postId: string; timestamp: string }

// Normalized [0,1], image-space, top-left origin, x right / y down, relative
// to the slide's real pixel width/height - null means "no constraint, whole
// slide". See open-layers/workingArea.ts for the conversion to/from the map's
// own (Y-flipped) coordinate space.
interface BotRegion {
  x: number
  y: number
  width: number
  height: number
}

// The bot's /control contract - what it's currently doing, independent of
// the pathway wiring itself (that always runs; these two flags only gate
// the 2D annotation/cell-count dots it draws on the slide).
interface BotControlState {
  annotationsEnabled: boolean
  cellCountEnabled: boolean
  region: BotRegion | null
  // Which slide the bot is currently writing annotations/cell counts into -
  // null until some browser has reported one (see BotControlContext, which
  // reports this tab's own slide on load and on every slide change). Read
  // here only to detect a mismatch; nothing currently displays it.
  slideId: string | null
}

export type { SeedNeuron, SeedConnection, SeedMeta, SeedFile, BotEvent, BotRegion, BotControlState }
