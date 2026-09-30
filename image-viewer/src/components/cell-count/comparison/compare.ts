import type { ComparisonDot } from '../../realtime/realtime'

interface CounterDots {
  connectionId: string
  dots: ComparisonDot[]
}

// One cell as best we can tell - the middle of every dot that landed on it.
interface MatchedCell {
  x: number
  y: number
  // Connection ids, in counter order.
  foundBy: string[]
}

interface CounterSummary {
  connectionId: string
  count: number
  // Cells everyone found.
  agreed: number
  // Cells someone else found that they didn't.
  missed: number
  // Cells nobody else found.
  onlyThem: number
}

interface ComparisonSummary {
  cells: MatchedCell[]
  counters: CounterSummary[]
  // Cells everyone found.
  agreed: number
  // agreed / cells - 1 when there's nothing to disagree on.
  agreement: number
}

interface WorkingCell extends MatchedCell {
  sumX: number
  sumY: number
}

// Groups everyone's dots into cells. Goes one counter at a time: each of
// their dots joins the nearest cell within `radius` that they haven't
// already got a dot on, nearest pairs first so a dot doesn't steal a cell
// another of theirs sits closer to. Anything left over starts a new cell.
// Greedy, so not the best possible matching, but it's the same answer
// whoever runs it since everyone gets the counters in the same order.
function matchCells(counters: CounterDots[], radius: number): MatchedCell[] {
  const cells: WorkingCell[] = []

  for (const { connectionId, dots } of counters) {
    const pairs: { dot: number; cell: number; distance: number }[] = []
    dots.forEach((dot, d) =>
      cells.forEach((cell, c) => {
        const distance = Math.hypot(dot.x - cell.x, dot.y - cell.y)
        if (distance <= radius) pairs.push({ dot: d, cell: c, distance })
      })
    )
    pairs.sort((a, b) => a.distance - b.distance)

    // Dot index -> cell index.
    const joined = new Map<number, number>()
    const takenCells = new Set<number>()
    for (const { dot, cell } of pairs) {
      if (joined.has(dot) || takenCells.has(cell)) continue
      joined.set(dot, cell)
      takenCells.add(cell)
    }

    // Centres only move once this counter is done, so their own dots are
    // all matched against the same positions.
    joined.forEach((c, d) => {
      const cell = cells[c]
      cell.foundBy.push(connectionId)
      cell.sumX += dots[d].x
      cell.sumY += dots[d].y
      cell.x = cell.sumX / cell.foundBy.length
      cell.y = cell.sumY / cell.foundBy.length
    })
    dots.forEach((dot, d) => {
      if (!joined.has(d)) cells.push({ x: dot.x, y: dot.y, foundBy: [connectionId], sumX: dot.x, sumY: dot.y })
    })
  }

  return cells.map(({ x, y, foundBy }) => ({ x, y, foundBy }))
}

function compareCounts(counters: CounterDots[], radius: number): ComparisonSummary {
  const cells = matchCells(counters, radius)
  const everyone = counters.length
  const agreed = cells.filter((cell) => cell.foundBy.length === everyone).length

  return {
    cells,
    counters: counters.map(({ connectionId, dots }) => ({
      connectionId,
      count: dots.length,
      agreed,
      missed: cells.filter((cell) => !cell.foundBy.includes(connectionId)).length,
      onlyThem: everyone > 1 ? cells.filter((cell) => cell.foundBy.length === 1 && cell.foundBy[0] === connectionId).length : 0,
    })),
    agreed,
    agreement: cells.length === 0 ? 1 : agreed / cells.length,
  }
}

export { compareCounts, matchCells }
export type { CounterDots, MatchedCell, CounterSummary, ComparisonSummary }
