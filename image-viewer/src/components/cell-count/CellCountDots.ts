import type Feature from 'ol/Feature'
import type Point from 'ol/geom/Point'
import type { CellCountDot, CellCountColourCount } from '../../interfaces/CellCount'

const NO_COLOUR = 'var(--chrome-text-secondary)'

// Shared by MapNode's live history card (CellCounterDuring) and the
// `pending` snapshot it assembles when counting stops - both read the same
// dot Features off its cellCountHistoryRef, just at different times. Pulled
// out so it's unit-testable without a live map. Filters out the nulls a
// withAnnotation-off click pushes there - within a single session
// withAnnotation doesn't change, so a null-free result here just means
// it's an annotated session.
function dotsFromHistory(history: (Feature<Point> | null)[]): CellCountDot[] {
  return history
    .filter((feature): feature is Feature<Point> => feature !== null)
    .map((feature) => {
      const [x, y] = feature.getGeometry()!.getCoordinates()
      return { x, y, colour: feature.get('colour') as string }
    })
}

function parseCellCountDots(json: string): CellCountDot[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// The colour breakdown is derived from the dots themselves rather than
// stored separately, so there's only ever one source of truth for "how
// many dots ended up in each colour".
function colourBreakdownFromDots(dots: CellCountDot[]): CellCountColourCount[] {
  const counts = new Map<string, number>()
  for (const dot of dots) {
    counts.set(dot.colour, (counts.get(dot.colour) ?? 0) + 1)
  }
  return Array.from(counts, ([colour, count]) => ({ colour, count }))
}

// A single CSS `background` value representing a colour breakdown - a flat
// colour for one, a conic-gradient pie sized by each colour's share of the
// total for more than one, or a neutral grey when there's nothing to show
// (e.g. every click in the session had withAnnotation off, so no dot - and
// therefore no colour - was ever recorded).
function colourBreakdownBackground(breakdown: CellCountColourCount[]): string {
  const total = breakdown.reduce((sum, entry) => sum + entry.count, 0)
  if (total === 0) return NO_COLOUR
  if (breakdown.length === 1) return breakdown[0].colour

  let cursor = 0
  const stops = breakdown.map(({ colour, count }) => {
    const start = cursor
    cursor += (count / total) * 100
    return `${colour} ${start}% ${cursor}%`
  })
  return `conic-gradient(${stops.join(', ')})`
}

export { parseCellCountDots, colourBreakdownFromDots, colourBreakdownBackground, dotsFromHistory }
