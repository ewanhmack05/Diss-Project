import { describe, expect, it } from 'vitest'
import { formatLongDate, formatShortDate, newestFirst } from './savedDates'

// Built in local time, since that's what the formatting uses.
const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).toISOString()

describe('formatShortDate', () => {
  const now = new Date(2026, 8, 30, 12, 0)

  it('leaves the year off for this year', () => {
    expect(formatShortDate(at(2026, 9, 30, 14, 36), now)).toBe('30 Sept')
  })

  it('adds the year for any other year', () => {
    expect(formatShortDate(at(2025, 3, 4), now)).toBe('4 Mar 2025')
  })

  it('is blank for something that isn’t a date', () => {
    expect(formatShortDate('not a date', now)).toBe('')
  })
})

describe('formatLongDate', () => {
  it('gives the date and time', () => {
    expect(formatLongDate(at(2026, 9, 30, 14, 36))).toBe('30 Sept 2026, 14:36')
  })

  it('says so when it can’t read it', () => {
    expect(formatLongDate('')).toBe('Unknown')
  })
})

describe('newestFirst', () => {
  it('puts the newest first, whatever order they came in', () => {
    const items = [
      { id: 'old', created: at(2026, 9, 28) },
      { id: 'newest', created: at(2026, 9, 30, 14, 36) },
      { id: 'middle', created: at(2026, 9, 29) },
    ]
    expect(newestFirst(items).map((i) => i.id)).toEqual(['newest', 'middle', 'old'])
  })

  it('puts anything without a readable date last, and leaves the input alone', () => {
    const items = [
      { id: 'broken', created: '' },
      { id: 'dated', created: at(2026, 1, 1) },
    ]
    expect(newestFirst(items).map((i) => i.id)).toEqual(['dated', 'broken'])
    expect(items[0].id).toBe('broken')
  })
})
