import { changeLines, type ChangeLine, type FieldChange } from './changes'
import { changeKind, type ChangeKind, type Restored } from './history'

// One annotation's or cell count's timeline, as annotation-store's
// History/ItemHistory.cs gives it, and the wording for going back on it.

type ItemEntity = 'annotation' | 'cellCount'

// What the timeline's open on. Comes from a Saved row, or from a deleted row
// in the History tab, so all it needs is what to call it.
interface Item {
  entity: ItemEntity
  id: string
  name: string | null
}

interface ItemVersion {
  id: number
  changeSetId: string
  userId: string
  userName: string
  what: string
  created: string
  op: 'create' | 'update' | 'delete'
  changes: FieldChange[]
}

interface ItemTimeline {
  versions: ItemVersion[]
  total: number
  latest: number | null
  groups: Record<string, string>
}

interface ItemPreview {
  gone: boolean
  changes: FieldChange[]
  groups: Record<string, string>
  // The group it was in, when that's gone since.
  groupGone: string | null
  latest: number | null
}

const PATHS: Record<ItemEntity, string> = { annotation: 'annotations', cellCount: 'cellcounts' }

const NOUNS: Record<ItemEntity, string> = { annotation: 'annotation', cellCount: 'cell count' }

function isItemEntity(entity: string): entity is ItemEntity {
  return entity in PATHS
}

function timelinePath({ entity, id }: Pick<Item, 'entity' | 'id'>, collectionId: string, skip: number, take: number): string {
  return `/${PATHS[entity]}/${encodeURIComponent(id)}/history?collectionId=${encodeURIComponent(collectionId)}&skip=${skip}&take=${take}`
}

function previewPath({ entity, id }: Pick<Item, 'entity' | 'id'>, version: number): string {
  return `/${PATHS[entity]}/${encodeURIComponent(id)}/history/${version}`
}

// latest is the newest entry you were looking at - if there's a newer one, the
// store says so rather than undoing something you haven't seen.
function goBackPath(item: Pick<Item, 'entity' | 'id'>, version: number, latest: number | null): string {
  const path = `${previewPath(item, version)}/restore`
  return latest === null ? path : `${path}?latest=${latest}`
}

// What happened to this row. The change set's own label would be about the
// whole change - "Merged two groups", on an annotation that only moved.
function versionTitle({ op, what }: Pick<ItemVersion, 'op' | 'what'>): string {
  const kind: ChangeKind = changeKind(what)
  if (kind === 'restore') return 'Put back'
  if (op === 'create') return kind === 'import' ? 'Imported' : 'Added'
  if (op === 'delete') return 'Deleted'
  if (kind === 'merge') return 'Its group was merged'
  if (what === 'delete group') return 'Its group was deleted'
  return 'Changed'
}

// Which icon a version gets - by what happened to this row too.
function versionKind({ op, what }: Pick<ItemVersion, 'op' | 'what'>): ChangeKind {
  const kind = changeKind(what)
  if (kind === 'restore' || kind === 'import' || kind === 'merge') return kind
  if (op === 'create') return 'add'
  return op === 'delete' ? 'delete' : 'change'
}

function asLines(changes: FieldChange[], groups: Record<string, string>): ChangeLine[] {
  return changeLines({ changes, created: 0, deleted: 0, deletedNames: [], groups })
}

// The newest entry is how it is now, so there's nothing to go back to - unless
// that entry deleted it. Who can is the same as for putting a change back.
function canGoBack(version: Pick<ItemVersion, 'id' | 'op'>, latest: number | null, canEdit: boolean): boolean {
  return canEdit && !(version.id === latest && version.op !== 'delete')
}

function isNow(version: Pick<ItemVersion, 'id' | 'op'>, latest: number | null): boolean {
  return version.id === latest && version.op !== 'delete'
}

// Said above the button, so it's clear what happens before it does.
function goBackNote(entity: ItemEntity, preview: Pick<ItemPreview, 'gone' | 'groupGone'>): string {
  const noun = NOUNS[entity]
  const what = preview.gone
    ? `This ${noun} is deleted, so it comes back as this for everyone in this collection.`
    : `This undoes every change to this ${noun} since, whoever made it, for everyone in this collection.`
  const group = preview.groupGone ? ` "${preview.groupGone}" has gone since, so it goes where that went, or in no group.` : ''
  return `${what}${group} It's a change of its own, so it can be gone back on too.`
}

// What the row's called now it's gone back - or what it was, if nothing changed.
function nameAfter(name: string | null, restored: Restored): string | null {
  const [row] = [...restored.annotations, ...restored.changedAnnotations, ...restored.cellCounts, ...(restored.changedCellCounts ?? [])]
  return row ? row.label : name
}

// The toast once it's done, by what it's called now. Nothing came back or
// changed if it was already so.
function wentBackMessage(entity: ItemEntity, name: string | null, restored: Restored): string {
  const called = nameAfter(name, restored) || `the ${NOUNS[entity]}`
  if (restored.annotations.length + restored.cellCounts.length > 0) return `Brought back ${called}`
  if ((restored.changedAnnotations ?? []).length + (restored.changedCellCounts ?? []).length > 0) return `Put ${called} back how it was`
  return `${called[0].toUpperCase()}${called.slice(1)} is already how it was then`
}

export {
  isItemEntity,
  timelinePath,
  previewPath,
  goBackPath,
  versionTitle,
  versionKind,
  asLines,
  canGoBack,
  isNow,
  goBackNote,
  nameAfter,
  wentBackMessage,
}
export type { Item, ItemEntity, ItemVersion, ItemTimeline, ItemPreview }
