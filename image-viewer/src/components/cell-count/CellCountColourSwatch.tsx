import { colourBreakdownBackground } from './CellCountDots'
import type { CellCountColourCount } from '../../interfaces/CellCount'

interface CellCountColourSwatchProps {
  breakdown: CellCountColourCount[]
  className: string
}

// A round swatch representing every colour used in a count's session - a
// flat circle for one colour (the common case), a pie-style conic-gradient
// sized by each colour's share for more than one, so a saved count that
// changed colour mid-tally isn't misrepresented as a single colour.
function CellCountColourSwatch({ breakdown, className }: CellCountColourSwatchProps) {
  return <span className={className} style={{ background: colourBreakdownBackground(breakdown) }} />
}

export default CellCountColourSwatch
