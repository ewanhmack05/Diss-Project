import { describe, expect, it } from 'vitest'
import { peopleLine } from './peopleLine'

const names = (n: number) => Array.from({ length: n }, (_, i) => `Person ${i + 1}`)

describe('peopleLine', () => {
  it('names everyone in a small session', () => {
    expect(peopleLine(['Bob Hughes'])).toBe('Bob Hughes')
    expect(peopleLine(names(3))).toBe('Person 1, Person 2, Person 3')
  })

  it('names one more rather than saying +1 other', () => {
    expect(peopleLine(names(5))).toBe('Person 1, Person 2, Person 3, Person 4, Person 5')
  })

  it('names the first few in order and counts the rest', () => {
    expect(peopleLine(names(6))).toBe('Person 1, Person 2, Person 3, Person 4 +2 others')
    expect(peopleLine(names(68))).toBe('Person 1, Person 2, Person 3, Person 4 +64 others')
  })

  it('puts a comma in a big count', () => {
    expect(peopleLine(names(1504))).toMatch(/\+1,500 others$/)
  })

  it('takes how many to show', () => {
    expect(peopleLine(names(4), 2)).toBe('Person 1, Person 2 +2 others')
  })

  it('is empty for nobody - the caller says so its own way', () => {
    expect(peopleLine([])).toBe('')
  })
})
