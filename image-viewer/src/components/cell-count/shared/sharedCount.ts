import type { SharedCount, SharedDot } from '../../realtime/realtime'
import type { CellCountDot } from '../../../interfaces/CellCount'

// Dots from two different people closer than `radius` - most likely the
// same cell counted from both sides of wherever they split the work. Same
// person twice isn't flagged; that's their own undo to sort out.
// Buckets dots into a grid of radius-sized cells so each dot only checks
// its neighbours, which keeps it quick with thousands of dots.
function findDoubleCounts(dots: SharedDot[], radius: number): Set<string> {
  const flagged = new Set<string>()
  if (radius <= 0) return flagged

  const grid = new Map<string, SharedDot[]>()
  const key = (gx: number, gy: number) => `${gx},${gy}`
  for (const dot of dots) {
    const k = key(Math.floor(dot.x / radius), Math.floor(dot.y / radius))
    const bucket = grid.get(k)
    if (bucket) bucket.push(dot)
    else grid.set(k, [dot])
  }

  for (const dot of dots) {
    const gx = Math.floor(dot.x / radius)
    const gy = Math.floor(dot.y / radius)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of grid.get(key(gx + dx, gy + dy)) ?? []) {
          if (other.connectionId === dot.connectionId) continue
          if (Math.hypot(other.x - dot.x, other.y - dot.y) <= radius) {
            flagged.add(dot.id)
            flagged.add(other.id)
          }
        }
      }
    }
  }
  return flagged
}

// How many dots each person has placed, by connection id.
function tallyByContributor(dots: SharedDot[]): Map<string, number> {
  const tally = new Map<string, number>()
  for (const dot of dots) tally.set(dot.connectionId, (tally.get(dot.connectionId) ?? 0) + 1)
  return tally
}

// The dots as they're saved - connection ids mean nothing once everyone's
// gone, so each gets the user id and name of whoever placed it.
function savedDots(sharedCount: SharedCount | null): CellCountDot[] {
  if (!sharedCount) return []
  const people = new Map(sharedCount.contributors.map((c) => [c.connectionId, c]))
  return sharedCount.dots.map(({ x, y, colour, connectionId }) => {
    const person = people.get(connectionId)
    return person
      ? { x, y, colour, placedBy: { userId: person.userId, name: person.displayName } }
      : { x, y, colour }
  })
}

export { findDoubleCounts, tallyByContributor, savedDots }
