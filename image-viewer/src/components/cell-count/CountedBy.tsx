import type { CellCountDot } from '../../interfaces/CellCount'
import { placedByBreakdown } from './CellCountDots'
import './CellCounter/CellCountForm.css'

// Who placed how many of the dots - only shared counts record it, so it
// renders nothing for anything else.
function CountedBy({ dots }: { dots: CellCountDot[] }) {
  const people = placedByBreakdown(dots)
  if (people.length === 0) return null

  return (
    <div className="cell-count-form-field">
      Counted by
      <div className="cell-count-form-static cell-count-form-colour-breakdown">
        {people.map(({ userId, name, count }) => (
          <span key={userId} className="cell-count-form-colour-chip" title={userId}>
            {name} · {count}
          </span>
        ))}
      </div>
    </div>
  )
}

export default CountedBy
