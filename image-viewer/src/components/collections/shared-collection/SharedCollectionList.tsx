import { useCollectionContext, type Collection } from '../../../context/CollectionContext'
import { useAuthContext } from '../../../context/AuthContext'
import { useDialogContext } from '../../../context/DialogContext'
import { useEmitEvent } from '../../../context/EventContext'
import CollectionRow from '../CollectionRow'

interface SharedCollectionListProps {
  collections: Collection[]
  activeId: string | null
  onExport: (collection: Collection) => void
  onImport: (collection: Collection) => void
}

function ownerName(collection: Collection): string {
  return collection.members.find((m) => m.role === 'owner')?.displayName || 'someone'
}

function sessionAbout(session: Collection, me: string): string {
  const who = session.ownerId === me ? "You're hosting" : `Hosted by ${ownerName(session)}`
  const people = `${session.members.length} ${session.members.length === 1 ? 'person' : 'people'}`
  const state = session.ended ? 'ended' : session.myRole === 'viewer' ? 'you can view' : 'you can edit'
  return `${who} · ${people} · ${state}`
}

// Sessions you're in, and other people's collections they've shared - both
// opened the same way, from here. Starting a session, and running one,
// stays in RealTime.
function SharedCollectionList({ collections, activeId, onExport, onImport }: SharedCollectionListProps) {
  const { open, leaveForGood, deleteSession } = useCollectionContext()
  const { user } = useAuthContext()
  const { showDialog } = useDialogContext()
  const emit = useEmitEvent()

  const confirmLeave = (session: Collection) =>
    showDialog({
      title: `Leave ${session.collectionName}?`,
      message: `You won't see it here any more, and you'll need a new invite from ${ownerName(session)} to get back in. Anything you added stays with the session.`,
      actions: [
        { label: 'Leave', variant: 'danger', onClick: () => leaveForGood(session.collectionId).catch(() => emit('collection:error')) },
        { label: 'Cancel' },
      ],
    })

  const confirmDelete = (session: Collection) =>
    showDialog({
      title: `Delete ${session.collectionName}?`,
      message: "Everything in it goes, for everyone who was in it. This can't be undone - export it first if you want to keep a copy.",
      actions: [
        { label: 'Delete', variant: 'danger', onClick: () => deleteSession(session.collectionId).catch(() => emit('collection:error')) },
        { label: 'Cancel' },
      ],
    })

  return (
    <ul className="collections-list">
      {collections.map((collection) => {
        const here = collection.collectionId === activeId
        const isSession = collection.kind === 'session'
        const canImport = collection.myRole !== 'viewer' && !collection.ended
        return (
          <CollectionRow
            key={collection.collectionId}
            collection={collection}
            about={isSession ? sessionAbout(collection, user.id) : `${ownerName(collection)} · read-only`}
            here={here}
          >
            {!here && (
              <button type="button" className="collections-button" onClick={() => open(collection.collectionId)}>
                {!isSession || collection.ended ? 'View' : 'Rejoin'}
              </button>
            )}
            <button type="button" className="collections-button" onClick={() => onExport(collection)}>
              Export
            </button>
            {canImport && (
              <button type="button" className="collections-button" onClick={() => onImport(collection)}>
                Import
              </button>
            )}
            {isSession && collection.myRole !== 'owner' && (
              <button type="button" className="collections-button collections-button--danger" onClick={() => confirmLeave(collection)}>
                Leave
              </button>
            )}
            {/* A live one is ended first, from RealTime, so nobody's left in it. */}
            {isSession && collection.myRole === 'owner' && collection.ended && (
              <button type="button" className="collections-button collections-button--danger" onClick={() => confirmDelete(collection)}>
                Delete
              </button>
            )}
          </CollectionRow>
        )
      })}
    </ul>
  )
}

export default SharedCollectionList
