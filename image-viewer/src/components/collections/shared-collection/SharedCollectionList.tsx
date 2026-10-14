import { useCollectionContext, type Collection } from '../../../context/CollectionContext'
import { useAuthContext } from '../../../context/AuthContext'
import { useDialogContext } from '../../../context/DialogContext'
import { useEmitEvent } from '../../../context/EventContext'
import { usePresenceContext } from '../../../context/PresenceContext'
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

function sessionAbout(session: Collection, me: string, empty: boolean): string {
  const who = session.ownerId === me ? "You're hosting" : `Hosted by ${ownerName(session)}`
  const people = `${session.members.length} ${session.members.length === 1 ? 'person' : 'people'}`
  const state = session.ended
    ? 'ended'
    : empty
      ? 'nobody in it'
      : session.myRole === 'viewer'
        ? 'you can view'
        : 'you can edit'
  return `${who} · ${people} · ${state}`
}

// Sessions you're in, and other people's collections they've shared - both
// opened the same way, from here. Starting a session, and running one,
// stays in RealTime.
function SharedCollectionList({ collections, activeId, onExport, onImport }: SharedCollectionListProps) {
  const { open, reopen, dormant, leaveForGood, deleteSession, endOther } = useCollectionContext()
  const { busySessions } = usePresenceContext()
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

  // You host one at a time - the one you're in, or else the newest. Any
  // other still going is from before that, and can only be ended.
  const hosting = collections.filter((c) => c.kind === 'session' && !c.ended && c.ownerId === user.id)
  const current = hosting.find((c) => c.collectionId === activeId) ?? hosting[0]

  const confirmEnd = (session: Collection) =>
    showDialog({
      title: `End ${session.collectionName}?`,
      message: "You can only host one session on a slide at a time. It'll be read-only, and its links stop - it's kept to look back at.",
      actions: [
        { label: 'End session', variant: 'danger', onClick: () => endOther(session.collectionId).catch(() => emit('collection:error')) },
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
        const isHost = collection.myRole === 'owner'
        // A live session nobody's in is closed - it can be looked at, and
        // only the host can open it up again. Live while you're in it.
        // Not known (presence not connected) counts as someone in it.
        const live = isSession && !collection.ended
        const empty = live && !(here && !dormant) && busySessions !== null && !busySessions.has(collection.collectionId)
        return (
          <CollectionRow
            key={collection.collectionId}
            collection={collection}
            about={isSession ? sessionAbout(collection, user.id, empty) : `${ownerName(collection)} · read-only`}
            here={here}
          >
            {!here &&
              (live && !empty ? (
                <button type="button" className="collections-button" onClick={() => open(collection.collectionId)}>
                  Rejoin
                </button>
              ) : (
                <button
                  type="button"
                  className="collections-button"
                  onClick={() => open(collection.collectionId, { viewOnly: live })}
                >
                  View
                </button>
              ))}
            {live && isHost && !here && current && collection.collectionId !== current.collectionId && (
              <button type="button" className="collections-button collections-button--danger" onClick={() => confirmEnd(collection)}>
                End
              </button>
            )}
            {live && empty && isHost && collection.collectionId === current?.collectionId && (
              <button
                type="button"
                className="collections-button collections-button--accent"
                onClick={() => (here ? reopen() : open(collection.collectionId))}
              >
                Reopen
              </button>
            )}
            {here && dormant && !empty && (
              <button type="button" className="collections-button collections-button--accent" onClick={reopen}>
                Rejoin
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
