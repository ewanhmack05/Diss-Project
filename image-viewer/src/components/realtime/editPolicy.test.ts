import { describe, expect, it } from 'vitest'
import {
  bulkConflictMessage,
  conflictMessage,
  defaultEditPolicy,
  oneAtATime,
  readConflict,
  sendsAfterSave,
} from './editPolicy'

describe('defaultEditPolicy', () => {
  it('takes either policy, and falls back to last change wins for anything else', () => {
    expect(defaultEditPolicy('firstComeWins')).toBe('firstComeWins')
    expect(defaultEditPolicy('lastWriteWins')).toBe('lastWriteWins')
    expect(defaultEditPolicy(undefined)).toBe('lastWriteWins')
    expect(defaultEditPolicy('FirstComeWins')).toBe('lastWriteWins')
  })
})

describe('readConflict', () => {
  const body = {
    entity: 'annotation',
    id: 'a1',
    current: { colour: '#0000FF' },
    changedBy: 'Bob',
    changedAt: '2026-10-28T10:00:00Z',
    changed: ['Colour'],
  }

  it("reads the store's 409", () => {
    expect(readConflict(body)).toEqual(body)
  })

  it('copes with nobody recorded - a change from before history was kept', () => {
    expect(readConflict({ ...body, changedBy: null, changedAt: null, changed: [] })).toMatchObject({
      changedBy: null,
      changedAt: null,
      changed: [],
    })
  })

  it("isn't fooled by something that isn't one", () => {
    expect(readConflict(null)).toBeNull()
    expect(readConflict('Conflict')).toBeNull()
    expect(readConflict({ id: 'a1' })).toBeNull()
  })
})

describe('conflictMessage', () => {
  const now = new Date('2026-10-28T10:02:30Z')
  const conflict = {
    entity: 'annotation',
    id: 'a1',
    current: {},
    changedBy: 'Bob',
    changedAt: '2026-10-28T10:00:00Z',
    changed: ['Colour'],
  }

  it('says who changed what, and when', () => {
    expect(conflictMessage(conflict, 'Region 4', now)).toBe(
      'Bob changed the colour of Region 4 2 minutes ago, before your change got there.'
    )
  })

  it('names several fields, and copes with not knowing who or when', () => {
    expect(conflictMessage({ ...conflict, changed: ['Name', 'Notes'] }, 'Tumour', now)).toContain('the name and notes of Tumour')
    expect(conflictMessage({ ...conflict, changedBy: null, changedAt: null, changed: [] }, 'Region 4', now)).toBe(
      'Someone changed Region 4, before your change got there.'
    )
  })

  it('says just now for a change a moment ago', () => {
    expect(conflictMessage({ ...conflict, changedAt: '2026-10-28T10:02:20Z' }, 'Region 4', now)).toContain('Region 4 just now,')
  })
})

describe('bulkConflictMessage', () => {
  it('says how many were left alone, and by whom', () => {
    expect(bulkConflictMessage([{ changedBy: 'Bob' }, { changedBy: 'Bob' }], 10)).toBe(
      '2 of 10 were changed by Bob first, so they were left as they are.'
    )
    expect(bulkConflictMessage([{ changedBy: 'Bob' }, { changedBy: 'Carol' }], 2)).toBe(
      'All 2 were changed by Bob and Carol first, so they were left as they are.'
    )
    expect(bulkConflictMessage([{ changedBy: 'A' }, { changedBy: 'B' }, { changedBy: null }], 5)).toContain('by 3 other people')
    expect(bulkConflictMessage([{ changedBy: null }], 1)).toBe('It was changed by someone else first, so it was left as it is.')
    expect(bulkConflictMessage([{ changedBy: 'Bob' }], 3)).toBe('1 of 3 was changed by Bob first, so it was left as it is.')
  })
})

describe('sendsAfterSave', () => {
  it('holds a change back from everyone else only under first change wins', () => {
    expect(sendsAfterSave('firstComeWins')).toBe(true)
    expect(sendsAfterSave('lastWriteWins')).toBe(false)
  })
})

describe('oneAtATime', () => {
  it('runs saves to one item in order, each after the last has finished', async () => {
    const queue = oneAtATime()
    const order: string[] = []
    const slow = (label: string, ms: number) => () =>
      new Promise<string>((resolve) =>
        setTimeout(() => {
          order.push(label)
          resolve(label)
        }, ms)
      )

    const results = await Promise.all([queue('a', slow('first', 30)), queue('a', slow('second', 1)), queue('b', slow('other', 5))])

    expect(results).toEqual(['first', 'second', 'other'])
    expect(order).toEqual(['other', 'first', 'second'])
  })

  it('carries on after one fails', async () => {
    const queue = oneAtATime()
    const failed = queue('a', () => Promise.reject(new Error('409')))
    const next = queue('a', () => Promise.resolve('ok'))
    await expect(failed).rejects.toThrow('409')
    await expect(next).resolves.toBe('ok')
  })
})
