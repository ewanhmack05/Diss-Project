import { describe, expect, it } from 'vitest'
import { MAX_BULK_IDS, inBatches } from './bulk'

describe('inBatches', () => {
  it('splits a selection bigger than the cap so every request is under it', () => {
    // 21k selected and deleted used to go as one request, which the store
    // turned down, and the Saved tab kept counting all of them.
    const ids = Array.from({ length: 21_000 }, (_, i) => `a${i}`)
    const batches = inBatches(ids)
    expect(batches.map((b) => b.length)).toEqual([MAX_BULK_IDS, 1_000])
    expect(batches.every((b) => b.length <= MAX_BULK_IDS)).toBe(true)
    expect(batches.flat()).toEqual(ids)
  })

  it('keeps a selection at or under the cap in one request', () => {
    expect(inBatches(['a', 'b'])).toEqual([['a', 'b']])
    expect(inBatches(Array.from({ length: MAX_BULK_IDS }, (_, i) => i))).toHaveLength(1)
  })

  it('sends nothing for nothing', () => {
    expect(inBatches([])).toEqual([])
  })

  it('splits exactly on the size given', () => {
    expect(inBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})
