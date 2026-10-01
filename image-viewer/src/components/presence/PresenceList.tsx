import { useRealtimeContext } from '../../context/RealtimeContext'
import './PresenceList.css'

const STATUS_TEXT = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
} as const

// Who else is in the session - a chip each, in the same colour as their
// viewport outline on the map. Hidden working alone, or with realtime off.
function PresenceList() {
  const { status, me, others } = useRealtimeContext()

  if (status === 'off' || status === 'alone') return null

  return (
    <div className="presence-list" aria-label="People in this session">
      {status !== 'connected' && <span className="presence-status">{STATUS_TEXT[status]}</span>}
      {me && (
        <span className="presence-chip presence-chip--me" title="You">
          <span className="presence-dot" style={{ background: me.colour }} />
          {me.displayName} (you)
        </span>
      )}
      {others.map((participant) => (
        <span key={participant.connectionId} className="presence-chip" title={participant.userId}>
          <span className="presence-dot" style={{ background: participant.colour }} />
          {participant.displayName}
        </span>
      ))}
    </div>
  )
}

export default PresenceList
