import { describe, expect, it } from 'vitest'
import { canRollBack, nothingToDo, previewPath, rollbackLines, rollbackPath } from './rollback'

const none = { back: 0, changed: 0, gone: 0 }
const nothing = { annotations: none, groups: none, cellCounts: none }

describe('paths', () => {
  it('sends the newest entry you saw, when there is one', () => {
    expect(previewPath('a b')).toBe('/changesets/a%20b/rollback')
    expect(rollbackPath('c1', 12)).toBe('/changesets/c1/rollback?latest=12')
    expect(rollbackPath('c1', null)).toBe('/changesets/c1/rollback')
  })
})

describe('canRollBack', () => {
  it('is for editors', () => {
    expect(canRollBack({ what: 'change annotation' }, true)).toBe(true)
    expect(canRollBack({ what: 'change annotation' }, false)).toBe(false)
  })

  it('has no way back from deleting the collection, which is never the one you are in', () => {
    expect(canRollBack({ what: 'delete collection' }, true)).toBe(false)
  })
})

describe('rollbackLines', () => {
  it('says what happens to each kind of row, with thousands readable', () => {
    expect(rollbackLines({ ...nothing, annotations: { back: 2140, changed: 3, gone: 12 } })).toEqual([
      '2,140 annotations come back',
      '3 annotations go back how they were',
      '12 annotations added since are taken out',
    ])
  })

  it('reads right for one', () => {
    expect(rollbackLines({ annotations: { back: 1, changed: 1, gone: 1 }, groups: { ...none, back: 1 }, cellCounts: { ...none, gone: 1 } })).toEqual([
      '1 annotation comes back',
      '1 annotation goes back how it was',
      '1 annotation added since is taken out',
      '1 group comes back',
      '1 cell count added since is taken out',
    ])
  })

  it('says nothing when there is nothing to do', () => {
    expect(rollbackLines(nothing)).toEqual([])
    expect(nothingToDo(nothing)).toBe(true)
    expect(nothingToDo({ ...nothing, groups: { ...none, changed: 1 } })).toBe(false)
  })
})
