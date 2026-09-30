import { useRealtimeContext } from '../../context/RealtimeContext'
import { useCollectionContext } from '../../context/CollectionContext'
import { useAuthContext } from '../../context/AuthContext'
import { useEmitEvent } from '../../context/EventContext'
import DockedCard from '../toolbar/DockedCard'
import CountInvites from '../cell-count/CountInvites'
import CollectionCard from './CollectionCard'
import { useComparisonContext } from '../../context/ComparisonContext'
import { useSharedCountContext } from '../../context/SharedCountContext'
import './RealTimePanel.css'

const STATUS_TEXT = {
    off: 'Realtime is off',
    connecting: 'Connecting…',
    reconnecting: 'Reconnecting…',
    offline: 'Offline',
} as const

// Lists everyone on this slide, you first, and which collection you're in.
function RealTimePanel() {
    const { status, me, others } = useRealtimeContext()
    const { user, signOut, switchUser } = useAuthContext()
    const { active, addMember } = useCollectionContext()
    const emit = useEmitEvent()
    const { comparison, myCounter } = useComparisonContext()
    const handedIn = comparison?.counters.filter((c) => c.state === 'submitted').length ?? 0
    const { sharedCount, myContributor } = useSharedCountContext()
    const sharedJoined = sharedCount?.contributors.filter((c) => c.state === 'joined').length ?? 0

    // The owner can add anyone here who isn't in the collection yet. Two tabs
    // can be the same person, so only offer it once per person.
    const inCollection = new Set(active?.members.map((m) => m.userId))
    const canAdd = active?.myRole === 'owner'
    const offered = new Set<string>()
    const addable = (userId: string) => {
        if (!canAdd || inCollection.has(userId) || offered.has(userId)) return false
        offered.add(userId)
        return true
    }

    return (
        <div className="realtime-panel">
            <DockedCard title="Users" className="realtime-users-card">
                {status !== 'connected' && <p className="realtime-status">{STATUS_TEXT[status]}</p>}
                <ul className="realtime-users">
                    {me && (
                        <li className="realtime-user realtime-user--me" title={me.userId}>
                            <span className="realtime-user-dot" style={{ backgroundColor: me.colour }} />
                            <span className="realtime-user-name">{me.displayName} (you)</span>
                        </li>
                    )}
                    {others.map((participant) => (
                        <li key={participant.connectionId} className="realtime-user" title={participant.userId}>
                            <span className="realtime-user-dot" style={{ backgroundColor: participant.colour }} />
                            <span className="realtime-user-name">{participant.displayName}</span>
                            {addable(participant.userId) && (
                                <button
                                    type="button"
                                    className="realtime-user-add"
                                    title={`Let ${participant.displayName} see and edit ${active?.collectionName}`}
                                    onClick={() =>
                                        addMember(participant.userId, participant.displayName).catch(() =>
                                            emit('collection:member-error')
                                        )
                                    }
                                >
                                    Add
                                </button>
                            )}
                        </li>
                    ))}
                </ul>
                <p className="realtime-signed-in">
                    Signed in as <strong>{user.name}</strong>
                </p>
                <div className="realtime-account-actions">
                    <button type="button" className="realtime-button" onClick={switchUser}>
                        Switch user
                    </button>
                    <button type="button" className="realtime-button" onClick={signOut}>
                        Sign out
                    </button>
                </div>
            </DockedCard>
            <CollectionCard />
            <CountInvites />
            {comparison && myCounter?.state !== 'invited' && (
                <p className="realtime-status">
                    {comparison.revealed
                        ? 'Comparison count finished'
                        : `Comparison count running - ${handedIn} of ${comparison.counters.length} handed in`}
                </p>
            )}
            {sharedCount && myContributor?.state !== 'invited' && (
                <p className="realtime-status">
                    {`Shared count running - ${sharedCount.dots.length} cells, ${sharedJoined} counting`}
                </p>
            )}
        </div>
    )
}

export default RealTimePanel
