interface EditableFields {
  label: string
  notes: string
  colour: string
}

const LABEL_MAX = 64
const NOTES_MAX = 256

// What to save next, or null if it matches what's already saved. An empty
// label can't be saved, so the last one stays until there's a new one -
// notes and colour still save. Merged text from several people typing can
// run past the inputs' own maxLength, hence the clamp.
function nextSave(latest: EditableFields, saved: EditableFields): EditableFields | null {
  const next = {
    label: latest.label.trim().slice(0, LABEL_MAX) || saved.label,
    notes: latest.notes.trim().slice(0, NOTES_MAX),
    colour: latest.colour,
  }
  if (next.label === saved.label && next.notes === saved.notes && next.colour === saved.colour) return null
  return next
}

export { nextSave, LABEL_MAX, NOTES_MAX }
export type { EditableFields }
