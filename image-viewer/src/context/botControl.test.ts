import { describe, expect, it } from 'vitest'
import { parseControlState, isBotRegion } from './botControl'

describe('isBotRegion', () => {
  it('accepts null (full slide, no constraint)', () => {
    expect(isBotRegion(null)).toBe(true)
  })

  it('accepts a well-formed region', () => {
    expect(isBotRegion({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 })).toBe(true)
  })

  it('rejects a region missing a field', () => {
    expect(isBotRegion({ x: 0.1, y: 0.2, width: 0.3 })).toBe(false)
  })

  it('rejects a region with a non-numeric field', () => {
    expect(isBotRegion({ x: '0.1', y: 0.2, width: 0.3, height: 0.4 })).toBe(false)
  })

  it('rejects a bare primitive', () => {
    expect(isBotRegion(42)).toBe(false)
    expect(isBotRegion('none')).toBe(false)
  })
})

describe('parseControlState', () => {
  it('parses a full enabled state with no region', () => {
    const data = { annotationsEnabled: true, cellCountEnabled: true, region: null }
    expect(parseControlState(data)).toEqual({
      annotationsEnabled: true,
      cellCountEnabled: true,
      region: null,
      slideId: null,
    })
  })

  it('parses a state with a region set', () => {
    const data = {
      annotationsEnabled: false,
      cellCountEnabled: true,
      region: { x: 0.1, y: 0.5, width: 0.2, height: 0.25 },
    }
    expect(parseControlState(data)).toEqual({ ...data, slideId: null })
  })

  it('parses a state with a slideId set', () => {
    const data = { annotationsEnabled: true, cellCountEnabled: true, region: null, slideId: '003' }
    expect(parseControlState(data)).toEqual(data)
  })

  it('treats a missing slideId (an older bot build) the same as an explicit null', () => {
    const data = { annotationsEnabled: true, cellCountEnabled: true, region: null }
    expect(parseControlState(data)?.slideId).toBeNull()
  })

  it('rejects a response with a non-string slideId', () => {
    expect(
      parseControlState({ annotationsEnabled: true, cellCountEnabled: true, region: null, slideId: 3 })
    ).toBeNull()
  })

  it('rejects a response missing annotationsEnabled', () => {
    expect(parseControlState({ cellCountEnabled: true, region: null })).toBeNull()
  })

  it('rejects a response missing cellCountEnabled', () => {
    expect(parseControlState({ annotationsEnabled: true, region: null })).toBeNull()
  })

  it('rejects a response with a non-boolean flag', () => {
    expect(parseControlState({ annotationsEnabled: 'true', cellCountEnabled: true, region: null })).toBeNull()
  })

  it('rejects a response with a malformed region', () => {
    expect(
      parseControlState({ annotationsEnabled: true, cellCountEnabled: true, region: { x: 0.1 } })
    ).toBeNull()
  })

  it('rejects a 400 error body ({ error: string }), not just malformed JSON', () => {
    expect(parseControlState({ error: 'annotationsEnabled must be a boolean' })).toBeNull()
  })

  it('rejects non-object input (null, array, primitive)', () => {
    expect(parseControlState(null)).toBeNull()
    expect(parseControlState([1, 2, 3])).toBeNull()
    expect(parseControlState('nope')).toBeNull()
    expect(parseControlState(undefined)).toBeNull()
  })
})
