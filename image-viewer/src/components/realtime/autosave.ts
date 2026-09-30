// Saved items with a label and notes that people edit together (see
// useSharedFields) - annotations and cell counts.
interface Labelled {
  label: string
  notes: string
}

const LABEL_MAX = 64
const NOTES_MAX = 256

// What to save next, or null if it matches what's already saved. An empty
// label can't be saved, so the last one stays until there's a new one -
// everything else still saves. Merged text from several people typing can
// run past the inputs' own maxLength, hence the clamp. Other fields (an
// annotation's colour, say) are passed through as they are.
function nextSave<T extends Labelled>(latest: T, saved: T): T | null {
  const next: T = {
    ...latest,
    label: latest.label.trim().slice(0, LABEL_MAX) || saved.label,
    notes: latest.notes.trim().slice(0, NOTES_MAX),
  }
  const changed = (Object.keys(next) as (keyof T)[]).some((key) => next[key] !== saved[key])
  return changed ? next : null
}

export { nextSave, LABEL_MAX, NOTES_MAX }
export type { Labelled }
