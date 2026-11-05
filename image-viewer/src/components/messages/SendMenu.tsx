import { useAnnotationGroupContext } from '../../context/AnnotationGroupContext'
import { useAnnotationSelectContext } from '../../context/AnnotationSelectContext'
import { useCellCountStoreContext } from '../../context/CellCountStoreContext'
import { useCollectionContext } from '../../context/CollectionContext'
import type { SendPick } from './messages'

// What's going with the message - the rows are read when it's sent.
type Staged = { label: string; pick: SendPick } | { label: string; invite: true }

interface SendMenuProps {
  // Sending this session's invite in its own chat would be asking people who
  // are already in it.
  offerInvite: boolean
  onPick: (staged: Staged) => void
  onClose: () => void
}

// Anything in the collection you're in, which is all you can be sure of having
// access to. Selecting happens on the Annotations panel's Select tab.
function SendMenu({ offerInvite, onPick, onClose }: SendMenuProps) {
  const { selectedIds } = useAnnotationSelectContext()
  const { groups } = useAnnotationGroupContext()
  const { cellCounts } = useCellCountStoreContext()
  const { active, session } = useCollectionContext()
  const selected = [...selectedIds]
  const hosting = !!session && !session.ended && session.myRole === 'owner'
  const chosen = (staged: Staged) => {
    onPick(staged)
    onClose()
  }

  return (
    <div className="messages-send-menu" role="menu" aria-label="Send">
      <p className="messages-send-from">From {active?.collectionName ?? 'your collection'}</p>
      <button
        type="button"
        role="menuitem"
        className="messages-send-item"
        disabled={selected.length === 0}
        title={selected.length === 0 ? 'Pick some on the Annotations panel\'s Select tab first' : undefined}
        onClick={() => chosen({ label: `${selected.length} selected ${selected.length === 1 ? 'annotation' : 'annotations'}`, pick: { kind: 'annotations', ids: selected } })}
      >
        Selected annotations ({selected.length})
      </button>
      {groups.length > 0 && (
        <select
          className="messages-send-select"
          aria-label="Send a group"
          value=""
          onChange={(e) => {
            const group = groups.find((g) => g.id === e.target.value)
            if (group) chosen({ label: `Group: ${group.name}`, pick: { kind: 'group', id: group.id } })
          }}
        >
          <option value="">A group…</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      )}
      {cellCounts.length > 0 && (
        <select
          className="messages-send-select"
          aria-label="Send a cell count"
          value=""
          onChange={(e) => {
            const count = cellCounts.find((c) => c.id === e.target.value)
            if (count) chosen({ label: `Cell count: ${count.label || count.count}`, pick: { kind: 'cellCount', id: count.id } })
          }}
        >
          <option value="">A cell count…</option>
          {cellCounts.map((count) => (
            <option key={count.id} value={count.id}>
              {count.label || `${count.count} cells`}
            </option>
          ))}
        </select>
      )}
      <button type="button" role="menuitem" className="messages-send-item" onClick={() => chosen({ label: `The whole of ${active?.collectionName ?? 'this collection'}`, pick: { kind: 'collection' } })}>
        The whole collection
      </button>
      {offerInvite && hosting && (
        <button type="button" role="menuitem" className="messages-send-item" onClick={() => chosen({ label: `Invite to ${session.collectionName}`, invite: true })}>
          An invite to your session
        </button>
      )}
    </div>
  )
}

export default SendMenu
export type { Staged }
