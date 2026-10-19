import { useEffect, useState } from 'react'
import { useAnnotationGroupContext } from '../../../context/AnnotationGroupContext'
import { useAnnotationSelectContext, type SelectMode } from '../../../context/AnnotationSelectContext'
import { UNDO_DELETE_MS, useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import { useCellCountDrawContext } from '../../../context/CellCountDrawContext'
import { useCollectionContext } from '../../../context/CollectionContext'
import { useDialogContext } from '../../../context/DialogContext'
import { useToastContext } from '../../../context/ToastContext'
import ColourPicker from '../../colour-picker/ColourPicker'
import { DefaultColour } from '../Tools'
import GroupList from './GroupList'
import GroupPage from './GroupPage'
import './Select.css'

const MODES: { mode: SelectMode; label: string; hint: string }[] = [
  { mode: 'box', label: 'Box', hint: 'Drag a box' },
  { mode: 'lasso', label: 'Lasso', hint: 'Draw round them' },
]

const plural = (n: number) => `${n} ${n === 1 ? 'annotation' : 'annotations'}`

// Picking many annotations on the map at once - by box, lasso or clicking
// them - to recolour, group or delete together. Viewers just get the groups,
// to show and hide.
function SelectTab() {
  const { setSelecting, mode, setMode, selectedIds, select, clear } = useAnnotationSelectContext()
  const { annotations, updateMany, deleteMany } = useAnnotationStoreContext()
  const { groups, hiddenGroupIds, createGroup, showAll } = useAnnotationGroupContext()
  const { canEdit } = useCollectionContext()
  const { counting } = useCellCountDrawContext()
  const { showDialog } = useDialogContext()
  const { addToast } = useToastContext()
  const [colour, setColour] = useState(DefaultColour)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  // A group's own page, instead of the tab, while it's open.
  const [openGroupId, setOpenGroupId] = useState<string | null>(null)
  const openGroup = groups.find((g) => g.id === openGroupId)

  // Clicks on the map are counting's while a count's going.
  const active = canEdit && !counting
  useEffect(() => {
    setSelecting(active)
    return () => setSelecting(false)
  }, [active, setSelecting])

  // Nothing stays picked once you leave the tab, and every group's back on
  // the map - hiding them is only done, and undone, from here.
  useEffect(
    () => () => {
      clear()
      showAll()
    },
    [clear, showAll]
  )

  // Gone if someone else deletes or merges it - back to the list then.
  if (openGroup) return <GroupPage key={openGroup.id} group={openGroup} editable={canEdit} onBack={() => setOpenGroupId(null)} />

  if (!canEdit) {
    return (
      <div className="select-tab">
        <section className="select-section">
          <h3 className="select-heading">Groups</h3>
          <GroupList editable={false} onOpen={setOpenGroupId} />
        </section>
      </div>
    )
  }

  const ids = [...selectedIds]
  const visible = annotations.filter((a) => !a.groupId || !hiddenGroupIds.has(a.groupId))
  const hint = MODES.find((m) => m.mode === mode)!.hint

  const inAGroup = annotations.filter((a) => a.groupId && selectedIds.has(a.id)).length

  const newGroup = () => {
    if (!newName.trim() || busy) return
    setBusy(true)
    createGroup(newName.trim(), ids)
      .then(() => setNewName(''))
      .catch(() => {})
      .finally(() => setBusy(false))
  }

  const confirmDelete = () =>
    showDialog({
      title: `Delete ${plural(ids.length)}?`,
      message: "They'll be gone for everyone in this collection. You'll have a few seconds to undo it.",
      actions: [
        {
          label: 'Delete',
          variant: 'danger',
          onClick: () => {
            const undo = deleteMany(ids)
            if (!undo) return
            addToast(`Deleted ${plural(ids.length)}`, 'success', {
              actions: [{ label: 'Undo', primary: true, onClick: undo }],
              duration: UNDO_DELETE_MS - 500,
            })
          },
        },
        { label: 'Cancel' },
      ],
    })

  return (
    <div className="select-tab">
      <section className="select-section">
        <div className="select-segmented" role="group" aria-label="Select by">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              aria-pressed={mode === m.mode}
              className={`select-segment${mode === m.mode ? ' select-segment--active' : ''}`}
              onClick={() => setMode(m.mode)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="select-hint">
          {counting
            ? 'Finish counting to pick annotations on the map.'
            : `${hint} to pick everything fully inside it. Hold Shift to add to what's picked, click a shape to put it in or take it out, Esc to clear. Hold Space or drag with the middle button to move the map.`}
        </p>
      </section>

      <div className="select-count-row">
        <span className="select-count">{ids.length > 0 ? `${plural(ids.length)} picked` : 'Nothing picked'}</span>
        <button
          type="button"
          className="select-button"
          disabled={visible.length === 0}
          onClick={() => select(visible.map((a) => a.id), false)}
        >
          All
        </button>
        <button type="button" className="select-button" disabled={ids.length === 0} onClick={clear}>
          Clear
        </button>
      </div>

      {ids.length > 0 && (
        <>
          <section className="select-section">
            <h3 className="select-heading">Colour</h3>
            <ColourPicker value={colour} onChange={setColour} />
            <button type="button" className="select-button select-button--wide" onClick={() => updateMany(ids, { colour })}>
              Recolour {plural(ids.length)}
            </button>
          </section>

          {/* Into an existing group is Add on its row, below. */}
          <section className="select-section">
            <h3 className="select-heading">New group</h3>
            <form
              className="select-row"
              onSubmit={(e) => {
                e.preventDefault()
                newGroup()
              }}
            >
              <input
                aria-label="New group name"
                placeholder="Name"
                value={newName}
                maxLength={64}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button type="submit" className="select-button select-button--accent" disabled={busy || !newName.trim()}>
                Group {ids.length}
              </button>
            </form>
            {inAGroup > 0 && (
              <button type="button" className="select-button" onClick={() => updateMany(ids, { groupId: null })}>
                Take {inAGroup === ids.length ? 'them' : inAGroup} out of their groups
              </button>
            )}
          </section>

          <button type="button" className="select-button select-button--danger select-button--wide" onClick={confirmDelete}>
            Delete {plural(ids.length)}
          </button>
        </>
      )}

      <section className="select-section">
        <h3 className="select-heading">Groups ({groups.length})</h3>
        <GroupList editable onAdd={(groupId) => updateMany(ids, { groupId })} onOpen={setOpenGroupId} />
      </section>
    </div>
  )
}

export default SelectTab
