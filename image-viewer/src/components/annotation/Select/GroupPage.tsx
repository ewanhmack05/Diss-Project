import { useEffect, useRef, useState } from 'react'
import { useAnnotationGroupContext } from '../../../context/AnnotationGroupContext'
import { useAnnotationSelectContext } from '../../../context/AnnotationSelectContext'
import { UNDO_DELETE_MS, useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import { useDialogContext } from '../../../context/DialogContext'
import { useToastContext } from '../../../context/ToastContext'
import type { AnnotationGroup } from '../../../interfaces/AnnotationGroup'
import ColourPicker from '../../colour-picker/ColourPicker'
import { debounce } from '../../realtime/realtime'
import { TEXT_SAVE_MS } from '../../realtime/autosave'
import { newChangeSet } from '../bulk'
import { DefaultColour } from '../Tools'
import Icon from '../../../icons/Icon'
import chevronLeftSvg from '../../../icons/chevron-left.svg?raw'

// Group notes save once you pause, like an annotation's.
const NOTES_MAX = 10_000

const plural = (n: number) => `${n} ${n === 1 ? 'annotation' : 'annotations'}`

interface GroupPageProps {
  group: AnnotationGroup
  editable: boolean
  onBack: () => void
}

// One group - its name and notes, and everything in it at once: recolour,
// pick on the map, delete, or merge it into another group. Viewers just see
// the name, notes and how many are in it.
function GroupPage({ group, editable, onBack }: GroupPageProps) {
  const { groups, updateGroup, mergeGroup, deleteGroup } = useAnnotationGroupContext()
  const { annotations, updateMany, deleteMany } = useAnnotationStoreContext()
  const { select } = useAnnotationSelectContext()
  const { showDialog } = useDialogContext()
  const { addToast } = useToastContext()
  const members = annotations.filter((a) => a.groupId === group.id).map((a) => a.id)
  // The most used colour in it, to start the picker on.
  const [colour, setColour] = useState(() => {
    const counts = new Map<string, number>()
    for (const a of annotations) if (a.groupId === group.id) counts.set(a.colour, (counts.get(a.colour) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? DefaultColour
  })
  const [name, setName] = useState(group.name)
  const [notes, setNotes] = useState(group.notes)
  const [mergeInto, setMergeInto] = useState('')

  // Someone else changing them shows here, unless you're typing in that box.
  const [nameFocused, setNameFocused] = useState(false)
  const [notesFocused, setNotesFocused] = useState(false)
  useEffect(() => {
    if (!nameFocused) setName(group.name)
  }, [group.name, nameFocused])
  useEffect(() => {
    if (!notesFocused) setNotes(group.notes)
  }, [group.notes, notesFocused])

  // Renaming and every notes save while the page is open are one change -
  // see SavedAnnotationEdit. Merging and deleting are changes of their own.
  const [changeSet] = useState(newChangeSet)
  const updateRef = useRef(updateGroup)
  useEffect(() => {
    updateRef.current = updateGroup
  })
  const [saveNotes] = useState(() =>
    debounce((id: string, text: string) => {
      updateRef.current(id, { notes: text }, changeSet).catch(() => {})
    }, TEXT_SAVE_MS)
  )
  // Leaving the page doesn't lose the last few keys.
  useEffect(() => () => saveNotes.flush(), [saveNotes])

  const saveName = () => {
    setNameFocused(false)
    const trimmed = name.trim()
    if (!trimmed) setName(group.name)
    else if (trimmed !== group.name) updateGroup(group.id, { name: trimmed }, changeSet).catch(() => setName(group.name))
  }

  const others = groups.filter((g) => g.id !== group.id)
  const target = others.find((g) => g.id === mergeInto)

  const confirmMerge = () => {
    if (!target) return
    showDialog({
      title: `Merge ${group.name} into ${target.name}?`,
      message: `${members.length > 0 ? `Its ${plural(members.length)} move into ${target.name}, and` : 'It'} ${group.name} is deleted. Any notes are kept, added to ${target.name}'s.`,
      actions: [
        { label: 'Merge', variant: 'accent', onClick: () => mergeGroup(group.id, target.id).then(onBack).catch(() => {}) },
        { label: 'Cancel' },
      ],
    })
  }

  const confirmDeleteAnnotations = () =>
    showDialog({
      title: `Delete the ${plural(members.length)} in ${group.name}?`,
      message: "They'll be gone for everyone in this collection - the group stays, empty. You'll have a few seconds to undo it.",
      actions: [
        {
          label: 'Delete',
          variant: 'danger',
          onClick: () => {
            const count = members.length
            const undo = deleteMany(members)
            if (!undo) return
            addToast(`Deleted ${plural(count)}`, 'success', {
              actions: [{ label: 'Undo', primary: true, onClick: undo }],
              duration: UNDO_DELETE_MS - 500,
            })
          },
        },
        { label: 'Cancel' },
      ],
    })

  const confirmDeleteGroup = () =>
    showDialog({
      title: `Delete ${group.name}?`,
      message:
        members.length > 0
          ? `The ${plural(members.length)} in it stay - they just won't be in a group.`
          : "It's empty, so nothing else changes.",
      actions: [
        { label: 'Delete group', variant: 'danger', onClick: () => deleteGroup(group.id).then(onBack).catch(() => {}) },
        { label: 'Cancel' },
      ],
    })

  return (
    <div className="select-tab">
      <button type="button" className="select-back" onClick={onBack}>
        <Icon svg={chevronLeftSvg} size={12} />
        Groups
      </button>

      <section className="select-section">
        {editable ? (
          <input
            className="select-page-name"
            aria-label="Group name"
            value={name}
            maxLength={64}
            onFocus={() => setNameFocused(true)}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') {
                setName(group.name)
                e.currentTarget.blur()
              }
            }}
          />
        ) : (
          <h2 className="select-page-title">{group.name}</h2>
        )}
        <div className="select-count-row">
          <span className="select-count">{plural(members.length)}</span>
          {editable && (
            <button type="button" className="select-button" disabled={members.length === 0} onClick={() => select(members, false)}>
              Select on map
            </button>
          )}
        </div>
      </section>

      <section className="select-section">
        <h3 className="select-heading">Notes</h3>
        {editable ? (
          <textarea
            className="select-notes"
            aria-label="Group notes"
            placeholder="What's this group for?"
            value={notes}
            maxLength={NOTES_MAX}
            rows={4}
            onFocus={() => setNotesFocused(true)}
            onBlur={() => {
              saveNotes.flush()
              setNotesFocused(false)
            }}
            onChange={(e) => {
              setNotes(e.target.value)
              saveNotes(group.id, e.target.value)
            }}
          />
        ) : (
          <p className="select-hint">{group.notes || 'No notes.'}</p>
        )}
      </section>

      {editable && (
        <>
          <section className="select-section">
            <h3 className="select-heading">Colour</h3>
            <ColourPicker value={colour} onChange={setColour} />
            <button
              type="button"
              className="select-button select-button--wide"
              disabled={members.length === 0}
              onClick={() => updateMany(members, { colour })}
            >
              Recolour {plural(members.length)}
            </button>
          </section>

          {others.length > 0 && (
            <section className="select-section">
              <h3 className="select-heading">Merge</h3>
              <div className="select-row">
                <select aria-label="Merge into" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
                  <option value="">Into…</option>
                  {others.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="select-button" disabled={!target} onClick={confirmMerge}>
                  Merge
                </button>
              </div>
            </section>
          )}

          <section className="select-section">
            <button
              type="button"
              className="select-button select-button--danger select-button--wide"
              disabled={members.length === 0}
              onClick={confirmDeleteAnnotations}
            >
              Delete its {plural(members.length)}
            </button>
            <button type="button" className="select-button select-button--wide" onClick={confirmDeleteGroup}>
              Delete the group, keep its annotations
            </button>
          </section>
        </>
      )}
    </div>
  )
}

export default GroupPage
