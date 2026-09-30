import { useComparisonContext } from '../../../context/ComparisonContext'
import { useRealtimeContext } from '../../../context/RealtimeContext'
import { useCellCountDrawContext } from '../../../context/CellCountDrawContext'
import type { CounterState } from '../../realtime/realtime'
import DockedCard from '../../toolbar/DockedCard'
import '../CellCounter/CellCounterToolPicker.css'
import './Comparison.css'

const STATE_TEXT: Record<CounterState, string> = {
  invited: 'Invited',
  counting: 'Counting…',
  submitted: 'Handed in',
}

// After handing in, until everyone else has. Only states come through -
// nobody's count or dots are sent until the reveal.
function ComparisonWaiting() {
  const { comparison, quit } = useComparisonContext()
  const { me } = useRealtimeContext()
  const { pending } = useCellCountDrawContext()
  if (!comparison) return null

  return (
    <div className="comparison">
      <DockedCard title="Waiting on" className="comparison-card">
        <ul className="comparison-counters">
          {comparison.counters.map((counter) => (
            <li key={counter.connectionId} className="comparison-counter">
              <span className="comparison-swatch" style={{ background: counter.colour }} />
              <span className="comparison-name">
                {counter.displayName}
                {counter.connectionId === me?.connectionId && ' (you)'}
              </span>
              <span className={`comparison-state comparison-state--${counter.state}`}>{STATE_TEXT[counter.state]}</span>
            </li>
          ))}
        </ul>
      </DockedCard>

      <DockedCard title="Your count" className="comparison-card comparison-card--narrow">
        <p className="comparison-figure">
          <strong>{pending?.count ?? 0}</strong> handed in
        </p>
      </DockedCard>

      <p className="comparison-hint">
        Results show once nobody is still counting. Anyone who hasn't joined by then misses out.
      </p>
      <button type="button" className="cell-counter-tool-picker-button" onClick={quit}>
        Leave comparison
      </button>
    </div>
  )
}

export default ComparisonWaiting
