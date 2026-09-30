import { useComparisonContext } from '../../../context/ComparisonContext'
import { useCellCountDrawContext } from '../../../context/CellCountDrawContext'
import DockedCard from '../../toolbar/DockedCard'
import '../CellCounter/CellCounterToolPicker.css'
import './Comparison.css'

// Shown in the cell counter and the RealTime panel while you've got an
// invite you haven't answered.
function ComparisonInvite() {
  const { comparison, myCounter, join, decline } = useComparisonContext()
  const { counting, pending } = useCellCountDrawContext()
  if (!comparison || myCounter?.state !== 'invited') return null

  const host = comparison.counters.find((c) => c.connectionId === comparison.hostConnectionId)
  const busy = counting || pending !== null

  return (
    <DockedCard title="Comparison count" className="comparison-invite">
      <p className="comparison-text">
        <span className="comparison-swatch" style={{ background: host?.colour }} />
        {host?.displayName ?? 'Someone'} wants everyone to count the same region, then compare.
      </p>
      {busy && <p className="comparison-hint">Finish or save your own count first.</p>}
      <div className="cell-counter-tool-picker-actions">
        <button type="button" className="cell-counter-tool-picker-button" onClick={decline}>
          Decline
        </button>
        <button
          type="button"
          className="cell-counter-tool-picker-button cell-counter-tool-picker-button--primary"
          disabled={busy}
          onClick={join}
        >
          Join
        </button>
      </div>
    </DockedCard>
  )
}

export default ComparisonInvite
