import { useEffect, useRef, useState } from 'react'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import type { Annotation } from '../../../interfaces/Annotation'
import { setAnnotationRenderProperties } from '../../open-layers/Styles'
import { debounce, throttle } from '../../realtime/realtime'
import { useSharedFields } from '../../realtime/useSharedFields'
import EditingWith from '../../realtime/EditingWith'
import { LABEL_MAX, NOTES_MAX, nextSave } from '../../realtime/autosave'
import ColourPicker from '../../colour-picker/ColourPicker'
import DockedCard from '../../toolbar/DockedCard'
import '../FreeForm/AnnotationForm.css'

interface SavedAnnotationEditProps {
  annotation: Annotation
  onBack: () => void
}

const FIELDS = ['label', 'notes'] as const
// Typing saves once you pause; colour goes out while you drag the custom
// picker so everyone else sees it change.
const AUTOSAVE_MS = 500
const COLOUR_MS = 200

// Label and notes are shared live (see useSharedFields), so two people can
// type in the same box at once. Everything saves as it changes - there's
// no Save button, because with several people in here "unsaved" would mean
// something different for each of them.
function SavedAnnotationEdit({ annotation, onBack }: SavedAnnotationEditProps) {
  const { annotationsSource, updateAnnotation, deleteAnnotation } = useAnnotationStoreContext()
  const [colour, setColour] = useState(annotation.colour)

  // Read by the save, which outlives any one render.
  const [initial] = useState(() => ({ label: annotation.label, notes: annotation.notes ?? '', colour: annotation.colour }))
  const latestRef = useRef(initial)
  const savedRef = useRef(initial)
  const updateRef = useRef(updateAnnotation)
  useEffect(() => {
    updateRef.current = updateAnnotation
  })

  const [[saveText, saveColour]] = useState(() => {
    const commit = () => {
      const next = nextSave(latestRef.current, savedRef.current)
      if (!next) return
      savedRef.current = next
      updateRef.current(annotation.id, next)
    }
    return [debounce(commit, AUTOSAVE_MS), throttle(commit, COLOUR_MS)] as const
  })

  const { values, editors, fieldProps } = useSharedFields(
    `annotation:${annotation.id}`,
    FIELDS,
    { label: annotation.label, notes: annotation.notes ?? '' },
    // Remote changes save too - whoever saves last then always has the
    // merged text, whatever order the saves land in.
    (next) => {
      latestRef.current = { ...latestRef.current, ...next }
      saveText()
    }
  )

  // Closing the form, however it happens, saves whatever's still waiting.
  useEffect(
    () => () => {
      saveText.flush()
      saveColour.flush()
    },
    [saveText, saveColour]
  )

  // Someone else changed the colour - follow it, unless it's just our own
  // save coming back round.
  useEffect(() => {
    if (annotation.colour === savedRef.current.colour) return
    savedRef.current = { ...savedRef.current, colour: annotation.colour }
    latestRef.current = { ...latestRef.current, colour: annotation.colour }
    setColour(annotation.colour)
  }, [annotation.colour])

  const handleColourChange = (next: string) => {
    setColour(next)
    latestRef.current = { ...latestRef.current, colour: next }
    const feature = annotationsSource.getFeatureById(annotation.id)
    if (feature) {
      feature.set('colour', next)
      setAnnotationRenderProperties(feature)
    }
    saveColour()
  }

  const handleDelete = () => {
    saveText.cancel()
    saveColour.cancel()
    deleteAnnotation(annotation.id)
    onBack()
  }

  return (
    <div className="annotation-form">
      <DockedCard className="annotation-form-field-card">
        <label className="annotation-form-field">
          Label
          <input type="text" maxLength={LABEL_MAX} {...fieldProps('label')} />
        </label>
        {!values.label.trim() && (
          <p className="annotation-form-hint">A label is needed, so the last one is kept for now.</p>
        )}
      </DockedCard>

      <DockedCard className="annotation-form-field-card annotation-form-notes-card">
        <label className="annotation-form-field">
          Notes
          <textarea
            maxLength={NOTES_MAX}
            rows={3}
            placeholder="Add any thoughts on this annotation"
            {...fieldProps('notes')}
          />
        </label>
      </DockedCard>

      <DockedCard title="Colour" className="annotation-form-colour-card">
        <ColourPicker value={colour} onChange={handleColourChange} />
      </DockedCard>

      <DockedCard title="Actions" className="annotation-form-actions-card">
        <div className="annotation-form-actions annotation-form-actions--stacked">
          <button
            type="button"
            className="annotation-form-button annotation-form-button--primary"
            onClick={onBack}
          >
            Done
          </button>
          <button
            type="button"
            className="annotation-form-button annotation-form-button--danger"
            data-cy="delete-button"
            onClick={handleDelete}
          >
            Delete
          </button>
        </div>
        <p className="annotation-form-hint">Changes save as you go.</p>
        <EditingWith editors={editors} />
      </DockedCard>
    </div>
  )
}

export default SavedAnnotationEdit
