import { useState } from 'react'
import { useCollectionContext, type Collection } from '../../../context/CollectionContext'
import { useEmitEvent } from '../../../context/EventContext'
import CollectionRow from '../CollectionRow'
import UserCollectionForm from './UserCollectionForm'

interface UserCollectionProps {
  collection: Collection
  here: boolean
  onExport: () => void
  onImport: () => void
}

// Your own collection on this slide - what's in it, whether others can
// look at it, and getting things in and out as GeoJSON.
function UserCollection({ collection, here, onExport, onImport }: UserCollectionProps) {
  const { leaveSession: showMine, setShared, renameCollection } = useCollectionContext()
  const emit = useEmitEvent()
  const [sharing, setSharing] = useState(false)

  const toggleShared = (shared: boolean) => {
    setSharing(true)
    setShared(shared)
      .catch(() => emit('collection:error'))
      .finally(() => setSharing(false))
  }

  return (
    <ul className="collections-list">
      <CollectionRow
        collection={collection}
        about={collection.shared ? 'Shared - anyone signed in can view it' : 'Only you can see it'}
        here={here}
        title={<UserCollectionForm collection={collection} onRename={(name) => renameCollection(collection.collectionId, name)} />}
      >
        {!here && (
          <button type="button" className="collections-button" onClick={showMine}>
            Show
          </button>
        )}
        <button type="button" className="collections-button" onClick={onExport}>
          Export
        </button>
        <button type="button" className="collections-button" onClick={onImport}>
          Import
        </button>
      </CollectionRow>
      <li className="collections-share">
        <label className="collections-toggle">
          <input
            type="checkbox"
            checked={collection.shared}
            disabled={sharing}
            onChange={(e) => toggleShared(e.target.checked)}
          />
          <span>Let others view it</span>
        </label>
        <span className="collections-note">
          {collection.shared
            ? "They can look and export, but can't change anything."
            : 'Turn on to let anyone on this slide look at it, read-only.'}
        </span>
      </li>
    </ul>
  )
}

export default UserCollection
