import { useRealtimeContext } from '../../context/RealtimeContext'
import { useNavigationContext } from '../../context/NavigationContext'
import { useEmitEvent } from '../../context/EventContext'
import { sketchFor } from '../realtime/realtime'
import './PresenceList.css'

const STATUS_TEXT = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
} as const

// The host asking everyone to look where they are. Not in Present, where
// everyone already is.
function LookHereButton() {
  const { status, me, others, navigation, askToLook } = useRealtimeContext()
  const emit = useEmitEvent()
  if (!me?.host || others.length === 0 || navigation === 'present') return null

  return (
    <button
      type="button"
      className="presence-chip presence-look"
      disabled={status !== 'connected'}
      title="Ask everyone to look where you are"
      onClick={() =>
        askToLook(null)
          .then(() => emit('request:sent'))
          .catch(() => emit('request:error'))
      }
    >
      Look here
    </button>
  )
}

// Whether you're following the host, or they're following you.
function NavigationChip() {
  const { me } = useRealtimeContext()
  const { mode, leader, following, breakAway, followAgain } = useNavigationContext()

  if (mode === 'free') return null
  if (me?.host) {
    return (
      <span className="presence-chip presence-chip--leading">
        {mode === 'present' ? "You're presenting" : 'Everyone is following you'}
      </span>
    )
  }
  if (!leader) return null
  if (mode === 'present') {
    return (
      <span className="presence-chip presence-chip--leading" style={{ borderColor: leader.colour }}>
        {leader.displayName} is presenting
        {sketchFor(leader, 'cellCount') && ` · counting ${sketchFor(leader, 'cellCount')!.data.count}`}
      </span>
    )
  }
  return (
    <span className="presence-chip presence-chip--leading" style={{ borderColor: leader.colour }}>
      {following ? `Following ${leader.displayName}` : `${leader.displayName} is leading`}
      <button type="button" className="presence-chip-button" onClick={following ? breakAway : followAgain}>
        {following ? 'Stop' : 'Follow'}
      </button>
    </span>
  )
}

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
      <NavigationChip />
      <LookHereButton />
    </div>
  )
}

export default PresenceList
