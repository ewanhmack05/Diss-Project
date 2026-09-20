import type { BotControlState, BotRegion } from '../components/connectome/types'

// Never throws - a response from a bot version this build doesn't
// understand, or no bot at all (a 200 from something else entirely) is
// treated as unusable rather than crashing the panel. Mirrors
// connectome.ts's parseBotEvent for the same reason.
function isBotRegion(value: unknown): value is BotRegion {
  if (value === null) return true
  if (typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.x === 'number' &&
    typeof record.y === 'number' &&
    typeof record.width === 'number' &&
    typeof record.height === 'number'
  )
}

function parseControlState(data: unknown): BotControlState | null {
  if (typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  if (typeof record.annotationsEnabled !== 'boolean') return null
  if (typeof record.cellCountEnabled !== 'boolean') return null
  if (!isBotRegion(record.region)) return null
  // Missing entirely (an older bot build) is treated the same as an
  // explicit null - "no slide reported yet" - rather than rejecting an
  // otherwise well-formed response over one optional field.
  const slideId = 'slideId' in record ? record.slideId : null
  if (slideId !== null && typeof slideId !== 'string') return null

  return {
    annotationsEnabled: record.annotationsEnabled,
    cellCountEnabled: record.cellCountEnabled,
    region: record.region,
    slideId,
  }
}

export { parseControlState, isBotRegion }
