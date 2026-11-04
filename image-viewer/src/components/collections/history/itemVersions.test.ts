import { describe, expect, it } from 'vitest'
import {
  asLines,
  canGoBack,
  goBackNote,
  goBackPath,
  isItemEntity,
  isNow,
  nameAfter,
  previewPath,
  timelinePath,
  versionKind,
  versionTitle,
  wentBackMessage,
} from './itemVersions'
import type { Annotation } from '../../../interfaces/Annotation'
import type { CellCount } from '../../../interfaces/CellCount'
import type { Restored } from './history'

const counts = { annotations: 0, groups: 0, cellCounts: 0, imageAdjustments: 0, collection: false }
const nothing: Restored = { counts, annotations: [], groups: [], cellCounts: [], imageAdjustments: [], changedAnnotations: [], changedCellCounts: [] }
const annotation = { id: 'a', label: 'Region 4' } as Annotation
const cellCount = { id: 'c', label: 'Count 1' } as CellCount

describe('paths', () => {
  const item = { entity: 'annotation', id: 'a b' } as const

  it('goes to the right list for each kind of row', () => {
    expect(timelinePath(item, 'c1', 20, 10)).toBe('/annotations/a%20b/history?collectionId=c1&skip=20&take=10')
    expect(timelinePath({ entity: 'cellCount', id: 'x' }, 'c1', 0, 10)).toBe('/cellcounts/x/history?collectionId=c1&skip=0&take=10')
    expect(previewPath(item, 7)).toBe('/annotations/a%20b/history/7')
  })

  it('sends the newest entry you saw, when there is one', () => {
    expect(goBackPath(item, 7, 12)).toBe('/annotations/a%20b/history/7/restore?latest=12')
    expect(goBackPath(item, 7, null)).toBe('/annotations/a%20b/history/7/restore')
  })
})

describe('isItemEntity', () => {
  it('is only the rows with a timeline', () => {
    expect(isItemEntity('annotation')).toBe(true)
    expect(isItemEntity('cellCount')).toBe(true)
    expect(isItemEntity('group')).toBe(false)
    expect(isItemEntity('imageAdjustment')).toBe(false)
  })
})

describe('versionTitle', () => {
  it.each([
    ['create', 'add annotation', 'Added'],
    ['create', 'import', 'Imported'],
    ['create', 'restore', 'Put back'],
    ['create', 'restore annotation', 'Put back'],
    ['update', 'restore cell count', 'Put back'],
    ['update', 'change annotation', 'Changed'],
    ['update', 'change annotations', 'Changed'],
    ['update', 'merge groups', 'Its group was merged'],
    ['update', 'delete group', 'Its group was deleted'],
    ['delete', 'delete annotation', 'Deleted'],
    ['delete', 'delete annotations', 'Deleted'],
  ] as const)('%s in a change of "%s" is "%s"', (op, what, title) => {
    expect(versionTitle({ op, what })).toBe(title)
  })
})

describe('versionKind', () => {
  it.each([
    ['create', 'add annotation', 'add'],
    ['create', 'restore annotation', 'restore'],
    ['update', 'delete group', 'change'],
    ['update', 'merge groups', 'merge'],
    ['create', 'import', 'import'],
    ['delete', 'delete annotations', 'delete'],
  ] as const)('%s in a change of "%s" gets the %s icon', (op, what, kind) => {
    expect(versionKind({ op, what })).toBe(kind)
  })
})

describe('canGoBack', () => {
  it('is for editors only', () => {
    expect(canGoBack({ id: 1, op: 'create' }, 2, true)).toBe(true)
    expect(canGoBack({ id: 1, op: 'create' }, 2, false)).toBe(false)
  })

  it('has nothing to go back to on the newest, which is how it is now', () => {
    expect(canGoBack({ id: 2, op: 'update' }, 2, true)).toBe(false)
    expect(isNow({ id: 2, op: 'update' }, 2)).toBe(true)
  })

  it('can bring it back when the newest deleted it, which is not how it is now', () => {
    expect(canGoBack({ id: 2, op: 'delete' }, 2, true)).toBe(true)
    expect(isNow({ id: 2, op: 'delete' }, 2)).toBe(false)
  })
})

describe('asLines', () => {
  it('reads like the History tab, groups by name', () => {
    const lines = asLines(
      [
        { entity: 'annotation', column: 'Label', before: 'a', after: 'b', count: 1, names: [] },
        { entity: 'annotation', column: 'GroupId', before: 'g1', after: null, count: 1, names: [] },
      ],
      { g1: 'Tumour' },
    )

    expect(lines.map((l) => [l.field, l.from[0].text, l.to.text])).toEqual([
      ['Label', 'a', 'b'],
      ['Group', 'Tumour', 'No group'],
    ])
  })
})

describe('goBackNote', () => {
  it('says later changes go, whoever made them', () => {
    const note = goBackNote('annotation', { gone: false, groupGone: null })
    expect(note).toContain('undoes every change to this annotation since, whoever made it')
    expect(note).toContain('gone back on too')
  })

  it('says a deleted one comes back', () => {
    expect(goBackNote('cellCount', { gone: true, groupGone: null })).toContain('This cell count is deleted, so it comes back')
  })

  it('says when its group has gone', () => {
    expect(goBackNote('annotation', { gone: false, groupGone: 'Tumour' })).toContain('"Tumour" has gone since')
  })
})

describe('wentBackMessage', () => {
  it('says brought back for a deleted one', () => {
    expect(wentBackMessage('annotation', 'Region 4', { ...nothing, annotations: [annotation] })).toBe('Brought back Region 4')
    expect(wentBackMessage('cellCount', 'Count 1', { ...nothing, cellCounts: [cellCount] })).toBe('Brought back Count 1')
  })

  it('says put back for one still there', () => {
    expect(wentBackMessage('annotation', 'Region 4', { ...nothing, changedAnnotations: [annotation] })).toBe('Put Region 4 back how it was')
    expect(wentBackMessage('cellCount', 'Count 1', { ...nothing, changedCellCounts: [cellCount] })).toBe('Put Count 1 back how it was')
  })

  it('says so when nothing needed doing', () => {
    expect(wentBackMessage('annotation', 'Region 4', nothing)).toBe('Region 4 is already how it was then')
  })

  it('still reads with no name', () => {
    expect(wentBackMessage('annotation', null, nothing)).toBe('The annotation is already how it was then')
    expect(wentBackMessage('cellCount', '', { ...nothing, changedCellCounts: [{ ...cellCount, label: '' }] })).toBe('Put the cell count back how it was')
  })

  it('goes by what it is called now, not what it was called when opened', () => {
    expect(wentBackMessage('annotation', 'Region 4 (checked)', { ...nothing, changedAnnotations: [annotation] })).toBe('Put Region 4 back how it was')
    expect(nameAfter('Region 4 (checked)', { ...nothing, changedAnnotations: [annotation] })).toBe('Region 4')
    expect(nameAfter('Count (old)', { ...nothing, cellCounts: [cellCount] })).toBe('Count 1')
    expect(nameAfter('as it was', nothing)).toBe('as it was')
  })
})
