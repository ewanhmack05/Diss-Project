import { describe, expect, it } from 'vitest'
import { oneOpen } from './oneOpen'

describe('oneOpen', () => {
  it('opening one closes whichever was open', () => {
    const boxes = oneOpen()
    boxes.open('a')
    boxes.open('b')
    expect(boxes.current()).toBe('b')
  })

  it('toggles the same one shut', () => {
    const boxes = oneOpen()
    boxes.toggle('a')
    expect(boxes.current()).toBe('a')
    boxes.toggle('a')
    expect(boxes.current()).toBeNull()
  })

  it('a late close of an old box leaves the new one open', () => {
    const boxes = oneOpen()
    boxes.open('a')
    boxes.open('b')
    boxes.close('a')
    expect(boxes.current()).toBe('b')
  })

  it('tells listeners only when something changes, until they stop listening', () => {
    const boxes = oneOpen()
    let told = 0
    const stop = boxes.subscribe(() => told++)
    boxes.open('a')
    boxes.open('a')
    boxes.close('b')
    expect(told).toBe(1)
    stop()
    boxes.close('a')
    expect(told).toBe(1)
  })
})
