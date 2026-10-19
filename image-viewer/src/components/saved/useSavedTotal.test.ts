import { describe, expect, it } from 'vitest'
import { fresherTotal, savedTabLabel, type FetchedTotal } from './useSavedTotal'

const at = (total: number, asked: number, collectionId = 'c1'): FetchedTotal => ({ collectionId, total, at: 0, asked })

describe('fresherTotal', () => {
  it("takes the Saved list's newer count over the store's older one", () => {
    // seed_stress.py added 30k straight to annotation-store. The store's
    // total was from page load; opening Saved asked again and got the real
    // number, but leaving Saved went back to the old one.
    expect(fresherTotal(at(20_998, 100), at(50_998, 200)).total).toBe(50_998)
  })

  it('keeps the newer ask when an older one lands after it', () => {
    expect(fresherTotal(at(50_998, 200), at(20_998, 100)).total).toBe(50_998)
  })

  it('takes the first answer, and any answer for another collection', () => {
    expect(fresherTotal(null, at(5, 1)).total).toBe(5)
    expect(fresherTotal(at(5, 999), at(7, 1, 'c2'))).toEqual(at(7, 1, 'c2'))
  })

  it('takes a later answer to the same ask time', () => {
    expect(fresherTotal(at(5, 100), at(6, 100)).total).toBe(6)
  })
})

describe('savedTabLabel', () => {
  it('is just "Saved" until the total is known, or while there is nothing', () => {
    expect(savedTabLabel(null)).toBe('Saved')
    expect(savedTabLabel(0)).toBe('Saved')
  })

  it('adds the total once there is something saved', () => {
    expect(savedTabLabel(1)).toBe('Saved (1)')
    expect(savedTabLabel(130)).toBe('Saved (130)')
  })

  it('groups big totals the way the rest of the viewer does', () => {
    expect(savedTabLabel(50_000)).toBe(`Saved (${(50_000).toLocaleString()})`)
  })
})

describe('savedTabLabel with the list open', () => {
  it("goes by the list's count over the collection's", () => {
    expect(savedTabLabel(130, { total: 5, filtered: true })).toBe('Saved (5)')
    expect(savedTabLabel(130, { total: 128, filtered: false })).toBe('Saved (128)')
  })

  it('says 0 when a search or filter finds nothing, but not when nothing is saved', () => {
    expect(savedTabLabel(130, { total: 0, filtered: true })).toBe('Saved (0)')
    expect(savedTabLabel(0, { total: 0, filtered: false })).toBe('Saved')
  })
})
