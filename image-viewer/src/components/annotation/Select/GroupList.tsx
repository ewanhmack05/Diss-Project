import { useAnnotationGroupContext } from '../../../context/AnnotationGroupContext'
import { useAnnotationSelectContext } from '../../../context/AnnotationSelectContext'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import { useDialogContext } from '../../../context/DialogContext'
import type { AnnotationGroup } from '../../../interfaces/AnnotationGroup'

interface GroupListProps {
  editable: boolean
  // Puts what's picked into the group - only offered while something's picked.
  onAdd?: (groupId: string) => void
  // Opens the group's own page.
  onOpen: (groupId: string) => void
}

// The collection's groups - show or hide each on the map, open one, and for
// editors, add what's picked to one, pick everything in one, or delete it.
function GroupList({ editable, onAdd, onOpen }: GroupListProps) {
  const { groups, hiddenGroupIds, toggleHidden, deleteGroup } = useAnnotationGroupContext()
  const { annotations } = useAnnotationStoreContext()
  const { selectedIds, select } = useAnnotationSelectContext()
  const { showDialog } = useDialogContext()

  if (groups.length === 0) {
    return (
      <p className="select-hint">
        {editable ? 'No groups yet - pick some annotations and put them in a new group.' : 'No groups in this collection.'}
      </p>
    )
  }

  const membersOf = (groupId: string) => annotations.filter((a) => a.groupId === groupId).map((a) => a.id)

  const confirmDelete = (group: AnnotationGroup, count: number) =>
    showDialog({
      title: `Delete ${group.name}?`,
      message:
        count > 0
          ? `The ${count} ${count === 1 ? 'annotation' : 'annotations'} in it stay - they just won't be in a group.`
          : "It's empty, so nothing else changes.",
      actions: [
        { label: 'Delete group', variant: 'danger', onClick: () => deleteGroup(group.id).catch(() => {}) },
        { label: 'Cancel' },
      ],
    })

  return (
    <ul className="select-groups">
      {groups.map((group) => {
        const members = membersOf(group.id)
        const hidden = hiddenGroupIds.has(group.id)
        // Picked ones that aren't in it yet.
        const adding = [...selectedIds].filter((id) => !members.includes(id)).length
        return (
          <li key={group.id} className="select-group">
            <button
              type="button"
              className="select-icon-button"
              aria-label={hidden ? `Show ${group.name}` : `Hide ${group.name}`}
              aria-pressed={!hidden}
              onClick={() => {
                // Hidden ones can't be picked, so they come out of the selection.
                if (!hidden) select([...selectedIds].filter((id) => !members.includes(id)), false)
                toggleHidden(group.id)
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                {hidden ? <line x1="4" y1="4" x2="20" y2="20" /> : <circle cx="12" cy="12" r="3" />}
              </svg>
            </button>
            <button
              type="button"
              className={`select-group-name${hidden ? ' select-group-name--hidden' : ''}`}
              title={`Open ${group.name}`}
              onClick={() => onOpen(group.id)}
            >
              {group.name}
            </button>
            <span className="select-group-count">{members.length}</span>
            {editable && (
              <>
                {onAdd && adding > 0 ? (
                  <button
                    type="button"
                    className="select-button select-button--accent"
                    title="Put what's picked in this group"
                    onClick={() => onAdd(group.id)}
                  >
                    Add {adding}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="select-button"
                    disabled={hidden || members.length === 0}
                    title="Pick everything in this group"
                    onClick={() => select(members, false)}
                  >
                    Select
                  </button>
                )}
                <button
                  type="button"
                  className="select-icon-button select-icon-button--danger"
                  aria-label={`Delete ${group.name}`}
                  onClick={() => confirmDelete(group, members.length)}
                >
                  ×
                </button>
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default GroupList
