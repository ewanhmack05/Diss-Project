import { useComparisonContext } from '../../context/ComparisonContext'
import { useSharedCountContext } from '../../context/SharedCountContext'
import { useCellCountDrawContext } from '../../context/CellCountDrawContext'
import DockedCard from '../toolbar/DockedCard'
import './CellCounter/CellCounterToolPicker.css'
import './comparison/Comparison.css'

interface CountInviteProps {
  title: string
  host: { displayName: string; colour: string } | undefined
  text: string
  busy: boolean
  onJoin: () => void
  onDecline: () => void
}

function CountInvite({ title, host, text, busy, onJoin, onDecline }: CountInviteProps) {
  return (
    <DockedCard title={title} className="comparison-invite">
      <p className="comparison-text">
        <span className="comparison-swatch" style={{ background: host?.colour }} />
        {host?.displayName ?? 'Someone'} {text}
      </p>
      {busy && <p className="comparison-hint">Finish or save your own count first.</p>}
      <div className="cell-counter-tool-picker-actions">
        <button type="button" className="cell-counter-tool-picker-button" onClick={onDecline}>
          Decline
        </button>
        <button
          type="button"
          className="cell-counter-tool-picker-button cell-counter-tool-picker-button--primary"
          disabled={busy}
          onClick={onJoin}
        >
          Join
        </button>
      </div>
    </DockedCard>
  )
}

// Any comparison or shared count invite you haven't answered yet. Shown in
// the cell counter and the RealTime panel.
function CountInvites() {
  const comparison = useComparisonContext()
  const shared = useSharedCountContext()
  const { counting, pending } = useCellCountDrawContext()
  const busy = counting || pending !== null

  const comparisonHost = comparison.comparison?.counters.find(
    (c) => c.connectionId === comparison.comparison?.hostConnectionId
  )
  const sharedHost = shared.sharedCount?.contributors.find(
    (c) => c.connectionId === shared.sharedCount?.hostConnectionId
  )

  return (
    <>
      {comparison.myCounter?.state === 'invited' && (
        <CountInvite
          title="Comparison count"
          host={comparisonHost}
          text="wants everyone to count the same region, then compare."
          busy={busy}
          onJoin={comparison.join}
          onDecline={comparison.decline}
        />
      )}
      {shared.myContributor?.state === 'invited' && (
        <CountInvite
          title="Shared count"
          host={sharedHost}
          text={`started a shared count - everyone adds to the same tally${
            shared.sharedCount?.settings.roiGeoJson ? ' inside their box' : ''
          }.`}
          busy={busy}
          onJoin={shared.join}
          onDecline={shared.decline}
        />
      )}
    </>
  )
}

export default CountInvites
