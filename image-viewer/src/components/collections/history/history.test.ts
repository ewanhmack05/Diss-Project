import { describe, expect, it } from 'vitest'
import {
  byDay,
  canRestore,
  changeKind,
  changeLabel,
  initials,
  restoreNote,
  restoreStatus,
  restoredList,
  restoredMessage,
  restoredOps,
  shortId,
  wasPutBack,
  type Restored,
} from './history'

const none = { annotations: 0, groups: 0, cellCounts: 0, imageAdjustments: 0, collection: false }

describe('changeLabel', () => {
  it('says how many a bulk delete took, with a thousands separator', () => {
    expect(changeLabel({ what: 'delete annotations', deleted: 2140 })).toBe('Deleted 2,140 annotations')
    expect(changeLabel({ what: 'delete annotations', deleted: 1 })).toBe('Deleted 1 annotation')
  })

  it("drops the count once it's been put back, since it isn't known any more", () => {
    expect(changeLabel({ what: 'delete annotations', deleted: 0 })).toBe('Deleted annotations')
  })

  it('reads every kind of change the store makes', () => {
    const whats = [
      'add annotation',
      'change annotation',
      'delete annotation',
      'change annotations',
      'delete annotations',
      'add group',
      'change group',
      'merge groups',
      'delete group',
      'add cell count',
      'change cell count',
      'delete cell count',
      'add image adjustment',
      'change image adjustment',
      'delete image adjustment',
      'import',
      'delete collection',
      'restore',
    ]
    const labels = whats.map((what) => changeLabel({ what, deleted: 1 }))
    // Every one has its own wording, not the fallback.
    labels.forEach((label, i) => expect(label).not.toBe(whats[i][0].toUpperCase() + whats[i].slice(1)))
    expect(new Set(labels).size).toBe(whats.length)
    expect(changeLabel({ what: 'restore', deleted: 0 })).toBe('Put back a change')
  })

  it("still says something for a change it doesn't know", () => {
    expect(changeLabel({ what: 'rename session', deleted: 0 })).toBe('Rename session')
    expect(changeLabel({ what: '', deleted: 0 })).toBe('Changed something')
  })
})

describe('wasPutBack', () => {
  it('is a delete with nothing left deleted', () => {
    expect(wasPutBack({ what: 'delete annotations', deleted: 0 })).toBe(true)
    expect(wasPutBack({ what: 'merge groups', deleted: 0 })).toBe(true)
  })

  it("isn't a delete still deleted, or something that never deleted anything", () => {
    expect(wasPutBack({ what: 'delete annotations', deleted: 3 })).toBe(false)
    expect(wasPutBack({ what: 'add annotation', deleted: 0 })).toBe(false)
    expect(wasPutBack({ what: 'restore', deleted: 0 })).toBe(false)
  })
})

describe('canRestore', () => {
  it('lets an editor put back anything still deleted, whoever deleted it', () => {
    expect(canRestore({ what: 'delete annotations', deleted: 5 }, true)).toBe(true)
    expect(canRestore({ what: 'merge groups', deleted: 1 }, true)).toBe(true)
  })

  it("doesn't for viewers and guests, who can only look", () => {
    expect(canRestore({ what: 'delete annotations', deleted: 5 }, false)).toBe(false)
  })

  it("doesn't when there's nothing left to put back", () => {
    expect(canRestore({ what: 'delete annotations', deleted: 0 }, true)).toBe(false)
    expect(canRestore({ what: 'add annotation', deleted: 0 }, true)).toBe(false)
  })

  it("doesn't offer the collection's own delete - you can't be in a deleted one", () => {
    expect(canRestore({ what: 'delete collection', deleted: 1 }, true)).toBe(false)
  })
})

describe('restoredList', () => {
  it('lists only what came back, with an and before the last', () => {
    expect(restoredList({ ...none, annotations: 2140 })).toBe('2,140 annotations')
    expect(restoredList({ ...none, annotations: 2, groups: 1 })).toBe('2 annotations and 1 group')
    expect(restoredList({ annotations: 1, groups: 2, cellCounts: 1, imageAdjustments: 3 })).toBe(
      '1 annotation, 2 groups, 1 cell count and 3 image adjustments'
    )
    expect(restoredList(none)).toBe('nothing')
  })
})

describe('restoredMessage', () => {
  it('says what came back', () => {
    expect(restoredMessage({ ...none, cellCounts: 1 })).toBe('Put back 1 cell count')
    expect(restoredMessage({ ...none, collection: true })).toBe('Put the collection back')
  })

  it('says so when someone else got there first', () => {
    expect(restoredMessage(none)).toBe('Nothing to put back - it was already back')
  })
})

describe('restoreStatus', () => {
  it('says how much is still deleted, in what it is', () => {
    expect(restoreStatus({ what: 'delete annotations', deleted: 300 })).toBe('300 annotations still deleted')
    expect(restoreStatus({ what: 'delete cell count', deleted: 1 })).toBe('1 cell count still deleted')
    expect(restoreStatus({ what: 'merge groups', deleted: 1 })).toBe('1 group still deleted')
    expect(restoreStatus({ what: 'something new', deleted: 4 })).toBe('4 things still deleted')
  })

  it("says it's back once it is, and nothing for a change that didn't delete", () => {
    expect(restoreStatus({ what: 'delete annotations', deleted: 0 })).toBe('Already put back')
    expect(restoreStatus({ what: 'add annotation', deleted: 0 })).toBeNull()
  })
})

describe('restoreNote', () => {
  it('warns that a group comes back empty', () => {
    expect(restoreNote({ what: 'delete group' })).toContain('comes back empty')
    expect(restoreNote({ what: 'merge groups' })).toContain('comes back empty')
    expect(restoreNote({ what: 'delete annotations' })).not.toContain('empty')
  })
})

describe('changeKind', () => {
  it('picks the icon from what the change did', () => {
    expect(changeKind('add cell count')).toBe('add')
    expect(changeKind('delete annotations')).toBe('delete')
    expect(changeKind('delete collection')).toBe('delete')
    expect(changeKind('change group')).toBe('change')
    expect(changeKind('merge groups')).toBe('merge')
    expect(changeKind('import')).toBe('import')
    expect(changeKind('restore')).toBe('restore')
    expect(changeKind('something new')).toBe('change')
  })
})

describe('initials', () => {
  it('takes the first and last word', () => {
    expect(initials('Alice Moore')).toBe('AM')
    expect(initials('mary  ann de la cruz ')).toBe('MC')
    expect(initials('alice')).toBe('A')
  })

  it('shows something for no name', () => {
    expect(initials('  ')).toBe('?')
  })
})

describe('shortId', () => {
  it('keeps the ends of a GUID', () => {
    expect(shortId('7f3c0000-1111-2222-3333-44445555a91e')).toBe('7f3c…a91e')
    expect(shortId('short')).toBe('short')
  })
})

describe('byDay', () => {
  const heading = (iso: string) => iso.slice(0, 10)

  it('puts runs of the same day under one heading, in order', () => {
    const days = byDay(
      [{ created: '2026-10-21T10:42' }, { created: '2026-10-21T09:55' }, { created: '2026-10-20T16:20' }],
      heading
    )
    expect(days.map((d) => [d.heading, d.items.length])).toEqual([
      ['2026-10-21', 2],
      ['2026-10-20', 1],
    ])
  })

  it('is nothing for nothing', () => {
    expect(byDay([], heading)).toEqual([])
  })
})

describe('restoredOps', () => {
  const restored: Restored = {
    counts: { ...none, annotations: 1, groups: 1, cellCounts: 1, imageAdjustments: 1 },
    annotations: [{ id: 'a1', label: 'a' } as Restored['annotations'][number]],
    groups: [{ id: 'g1', collectionId: 'c', name: 'g', notes: 'n', created: '', count: 0 }],
    cellCounts: [{ id: 'c1', dots: null } as Restored['cellCounts'][number]],
    imageAdjustments: [{ imageAdjustmentId: 'p1', collectionId: 'c', adjustmentName: 'p', adjustments: '{}', created: '' }],
  }

  it('tells everyone else with a create per row, groups first', () => {
    const ops = restoredOps(restored)
    expect(ops.map((op) => [op.kind, op.entity, op.id])).toEqual([
      ['create', 'annotationGroup', 'g1'],
      ['create', 'annotation', 'a1'],
      ['create', 'cellCount', 'c1'],
    ])
  })

  it("leaves the store's member count off a group, like a made one", () => {
    expect(restoredOps(restored)[0].data).toEqual({ id: 'g1', collectionId: 'c', name: 'g', notes: 'n', created: '' })
  })

  it('sends nothing for nothing', () => {
    expect(restoredOps({ counts: none, annotations: [], groups: [], cellCounts: [], imageAdjustments: [] })).toEqual([])
  })
})
