import { useRealtimeContext } from '../../context/RealtimeContext'
import DockedCard from '../toolbar/DockedCard'
import './RealTimePanel.css'

const STATUS_TEXT = {
    off: 'Realtime is off',
    connecting: 'Connecting…',
    reconnecting: 'Reconnecting…',
    offline: 'Offline',
} as const

// Lists everyone on this slide, you first.
function RealTimePanel() {
    const { status, me, others } = useRealtimeContext()

    return (
        <div className="realtime-panel">
            <DockedCard title="Users" className="realtime-users-card">
                {status !== 'connected' && <p className="realtime-status">{STATUS_TEXT[status]}</p>}
                <ul className="realtime-users">
                    {me && (
                        <li className="realtime-user realtime-user--me" title={me.userId}>
                            <span className="realtime-user-dot" style={{ backgroundColor: me.colour }} />
                            {me.displayName} (you)
                        </li>
                    )}
                    {others.map((participant) => (
                        <li key={participant.connectionId} className="realtime-user" title={participant.userId}>
                            <span className="realtime-user-dot" style={{ backgroundColor: participant.colour }} />
                            {participant.displayName}
                        </li>
                    ))}
                </ul>
            </DockedCard>
        </div>
    )
}

export default RealTimePanel
