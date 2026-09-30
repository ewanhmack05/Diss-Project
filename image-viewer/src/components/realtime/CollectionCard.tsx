import { useCollectionContext, type CollectionRole } from '../../context/CollectionContext'
import { useAuthContext } from '../../context/AuthContext'
import { useEmitEvent } from '../../context/EventContext'
import DockedCard from '../toolbar/DockedCard'

const ROLE_TEXT: Record<CollectionRole, string> = {
  owner: 'owner',
  editor: 'can edit',
  viewer: 'can view',
}

// Which collection you're working in, and who's in it. The owner can take
// people out here - adding them is next to their name in the Users card.
function CollectionCard() {
  const { collections, active, setActiveCollectionId, removeMember, status } = useCollectionContext()
  const { user } = useAuthContext()
  const emit = useEmitEvent()
  if (status !== 'ready' || !active) return null

  const isOwner = active.myRole === 'owner'
  const remove = (userId: string) => removeMember(userId).catch(() => emit('collection:member-error'))

  return (
    <DockedCard title="Collection" className="realtime-collection-card">
      <label className="realtime-collection-field">
        Working in
        <select value={active.collectionId} onChange={(e) => setActiveCollectionId(e.target.value)}>
          {collections.map((collection) => (
            <option key={collection.collectionId} value={collection.collectionId}>
              {collection.collectionName}
              {collection.ownerId === user.id ? ' (yours)' : ` (${ROLE_TEXT[collection.myRole]})`}
            </option>
          ))}
        </select>
      </label>
      <ul className="realtime-members">
        {active.members.map((member) => (
          <li key={member.userId} className="realtime-member" title={member.userId}>
            <span className="realtime-member-name">
              {member.displayName || member.userId}
              {member.userId === user.id && ' (you)'}
            </span>
            <span className="realtime-member-role">{ROLE_TEXT[member.role]}</span>
            {isOwner && member.role !== 'owner' && (
              <button
                type="button"
                className="realtime-member-remove"
                aria-label={`Take ${member.displayName} out of this collection`}
                onClick={() => remove(member.userId)}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {!isOwner && (
        <button type="button" className="realtime-button" onClick={() => remove(user.id)}>
          Leave this collection
        </button>
      )}
    </DockedCard>
  )
}

export default CollectionCard
