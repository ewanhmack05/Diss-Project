import { describe, expect, it } from 'vitest'
import { bringToFront, stackIndex } from './focusOrder'

describe('bringToFront', () => {
  it('appends a never-focused key to the front', () => {
    expect(bringToFront([], 'a')).toEqual(['a'])
    expect(bringToFront(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('moves an already-focused key to the front instead of duplicating it', () => {
    expect(bringToFront(['a', 'b'], 'a')).toEqual(['b', 'a'])
  })

  it('is a no-op when the key is already at the front', () => {
    expect(bringToFront(['a', 'b'], 'b')).toEqual(['a', 'b'])
  })
})

describe('stackIndex', () => {
  it('is 0 for a key that has never been focused', () => {
    expect(stackIndex([], 'a')).toBe(0)
    expect(stackIndex(['b', 'c'], 'a')).toBe(0)
  })

  it('grows the more recently a key was brought to front', () => {
    const order = bringToFront(bringToFront(bringToFront([], 'a'), 'b'), 'c')
    expect(stackIndex(order, 'a')).toBe(0)
    expect(stackIndex(order, 'b')).toBe(1)
    expect(stackIndex(order, 'c')).toBe(2)
  })

  it('reflects a key moving back to front after something else was focused', () => {
    let order = bringToFront(bringToFront([], 'a'), 'b')
    order = bringToFront(order, 'a')
    expect(stackIndex(order, 'a')).toBeGreaterThan(stackIndex(order, 'b'))
  })
})
