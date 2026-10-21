import type { Annotation } from '../../../interfaces/Annotation'
import type { AnnotationGroup } from '../../../interfaces/AnnotationGroup'
import type { CellCount } from '../../../interfaces/CellCount'
import type { ImageAdjustmentPreset } from '../../../interfaces/ImageAdjustment'
import type { AnnotationOp } from '../../realtime/realtime'

// One change in a collection, as GET /changesets gives it - see
// annotation-store's ChangeSets/. deleted is how many rows it deleted that
// are still deleted, so 0 once it's been put back.
interface ChangeSet {
  id: string
  collectionId: string
  userId: string
  userName: string
  what: string
  created: string
  deleted: number
}

interface RestoreCounts {
  annotations: number
  groups: number
  cellCounts: number
  imageAdjustments: number
  // The change deleted the collection itself.
  collection: boolean
}

// What POST /changesets/{id}/restore answers - the counts, and the rows it
// put back. Cell counts come as the Saved list has them, without dots.
interface Restored {
  counts: RestoreCounts
  annotations: Annotation[]
  groups: (AnnotationGroup & { count?: number })[]
  cellCounts: CellCount[]
  imageAdjustments: ImageAdjustmentPreset[]
}

const number = (n: number) => n.toLocaleString('en-GB')

function plural(n: number, one: string, many: string): string {
  return `${number(n)} ${n === 1 ? one : many}`
}

// What each `what` reads as. A bulk delete says how many, while it still
// knows - once put back, deleted is 0 and the count's gone with it.
const LABELS: Record<string, (deleted: number) => string> = {
  'add annotation': () => 'Added an annotation',
  'change annotation': () => 'Changed an annotation',
  'delete annotation': () => 'Deleted an annotation',
  'change annotations': () => 'Changed annotations',
  'delete annotations': (deleted) => (deleted > 0 ? `Deleted ${plural(deleted, 'annotation', 'annotations')}` : 'Deleted annotations'),
  'add group': () => 'Added a group',
  'change group': () => 'Changed a group',
  'merge groups': () => 'Merged two groups',
  'delete group': () => 'Deleted a group',
  'add cell count': () => 'Added a cell count',
  'change cell count': () => 'Changed a cell count',
  'delete cell count': () => 'Deleted a cell count',
  'add image adjustment': () => 'Saved an image adjustment',
  'change image adjustment': () => 'Changed an image adjustment',
  'delete image adjustment': () => 'Deleted an image adjustment',
  import: () => 'Imported a GeoJSON file',
  'delete collection': () => 'Deleted the collection',
  restore: () => 'Put back a change',
}

function changeLabel({ what, deleted }: Pick<ChangeSet, 'what' | 'deleted'>): string {
  const label = LABELS[what]
  if (label) return label(deleted)
  // Anything newer than this list still reads as something.
  return what ? what[0].toUpperCase() + what.slice(1) : 'Changed something'
}

// Whether it deleted something and that's all been put back since.
function wasPutBack({ what, deleted }: Pick<ChangeSet, 'what' | 'deleted'>): boolean {
  return deleted === 0 && (what.startsWith('delete') || what === 'merge groups')
}

// The one place that says who can put a change back. annotation-store lets
// any editor restore anyone's change (it's rollback, not undo), so this
// matches. If that's narrowed to the author and the host, change it here
// and in ChangeSets.cs.
function canRestore(changeSet: Pick<ChangeSet, 'deleted' | 'what'>, canEdit: boolean): boolean {
  // A deleted collection is never the one you're in, so it can't be put
  // back from its own history.
  return canEdit && changeSet.deleted > 0 && changeSet.what !== 'delete collection'
}

// "2,140 annotations and a group" - what a restore will or did bring back.
function restoredList(counts: Omit<RestoreCounts, 'collection'>): string {
  const parts = [
    counts.annotations > 0 && plural(counts.annotations, 'annotation', 'annotations'),
    counts.groups > 0 && plural(counts.groups, 'group', 'groups'),
    counts.cellCounts > 0 && plural(counts.cellCounts, 'cell count', 'cell counts'),
    counts.imageAdjustments > 0 && plural(counts.imageAdjustments, 'image adjustment', 'image adjustments'),
  ].filter((part): part is string => !!part)
  if (parts.length === 0) return 'nothing'
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// The toast once it's done. Someone else may have put it back first, so
// it can be nothing.
function restoredMessage(counts: RestoreCounts): string {
  if (counts.collection) return 'Put the collection back'
  const list = restoredList(counts)
  return list === 'nothing' ? 'Nothing to put back - it was already back' : `Put back ${list}`
}

// What it deleted that's still deleted, for one change opened up - or
// that it's all back. Nothing for a change that didn't delete anything.
const DELETED_NOUNS: Record<string, [string, string]> = {
  'delete annotation': ['annotation', 'annotations'],
  'delete annotations': ['annotation', 'annotations'],
  'delete group': ['group', 'groups'],
  'merge groups': ['group', 'groups'],
  'delete cell count': ['cell count', 'cell counts'],
  'delete image adjustment': ['image adjustment', 'image adjustments'],
}

function restoreStatus(changeSet: Pick<ChangeSet, 'what' | 'deleted'>): string | null {
  if (wasPutBack(changeSet)) return 'Already put back'
  if (changeSet.deleted === 0) return null
  const [one, many] = DELETED_NOUNS[changeSet.what] ?? ['thing', 'things']
  return `${plural(changeSet.deleted, one, many)} still deleted`
}

// Said above Put back, so it's clear what happens before it does.
function restoreNote({ what }: Pick<ChangeSet, 'what'>): string {
  const everyone = 'It comes back for everyone in this collection, as a change of its own.'
  // Deleting or merging a group ungrouped what was in it, and which ones
  // isn't kept yet.
  return what === 'delete group' || what === 'merge groups' ? `${everyone} The group comes back empty.` : everyone
}

// Which icon a row gets.
type ChangeKind = 'add' | 'change' | 'delete' | 'merge' | 'import' | 'restore'

function changeKind(what: string): ChangeKind {
  if (what === 'import' || what === 'restore') return what
  if (what === 'merge groups') return 'merge'
  if (what.startsWith('add')) return 'add'
  if (what.startsWith('delete')) return 'delete'
  return 'change'
}

// "AM" for Alice Moore - first and last word.
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0][0]
  const last = words.length > 1 ? words[words.length - 1][0] : ''
  return (first + last).toUpperCase()
}

// Enough of a change set's id to tell it apart, and to find it in the store.
function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id
}

// A page of changes under day headings, keeping their order. The heading
// is worked out by the caller (savedDates' dayHeading), so this stays plain.
function byDay<T extends { created: string }>(items: T[], heading: (iso: string) => string): { heading: string; items: T[] }[] {
  const days: { heading: string; items: T[] }[] = []
  for (const item of items) {
    const label = heading(item.created)
    const last = days[days.length - 1]
    if (last && last.heading === label) last.items.push(item)
    else days.push({ heading: label, items: [item] })
  }
  return days
}

// Everyone else is told with a create per row, the same as an import.
// Image adjustments are personal, so nobody else needs them.
function restoredOps(restored: Restored): AnnotationOp[] {
  // Groups first, so an annotation that's in one never arrives before it.
  return [
    ...restored.groups.map(({ count: _count, ...group }): AnnotationOp => ({
      kind: 'create',
      entity: 'annotationGroup',
      id: group.id,
      data: { ...group, notes: group.notes ?? '' },
    })),
    ...restored.annotations.map((a): AnnotationOp => ({ kind: 'create', entity: 'annotation', id: a.id, data: a })),
    ...restored.cellCounts.map((c): AnnotationOp => ({ kind: 'create', entity: 'cellCount', id: c.id, data: c })),
  ]
}

export {
  changeLabel,
  wasPutBack,
  canRestore,
  restoredList,
  restoredMessage,
  restoreStatus,
  restoreNote,
  changeKind,
  initials,
  shortId,
  byDay,
  restoredOps,
}
export type { ChangeSet, ChangeKind, Restored, RestoreCounts }
