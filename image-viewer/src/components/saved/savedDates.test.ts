import { describe, expect, it } from 'vitest'
import { dayHeading, formatFullDate, formatLongDate, formatShortDate, formatTime, newestFirst, timeAgo } from './savedDates'

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
  it('gives the date and time, without the year', () => {
    expect(formatLongDate(at(2026, 9, 30, 14, 36))).toBe('30 Sept, 14:36')
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

describe('dayHeading', () => {
  const now = new Date(2026, 9, 21, 10, 55)

  it('says Today and Yesterday by the calendar, not by 24 hours', () => {
    expect(dayHeading(at(2026, 10, 21, 0, 1), now)).toBe('Today')
    expect(dayHeading(at(2026, 10, 20, 23, 59), now)).toBe('Yesterday')
    expect(dayHeading(at(2026, 10, 20, 0, 0), now)).toBe('Yesterday')
  })

  it('gives the short date before that', () => {
    expect(dayHeading(at(2026, 10, 19, 11, 14), now)).toBe('19 Oct')
    expect(dayHeading(at(2025, 10, 21), now)).toBe('21 Oct 2025')
  })

  it('crosses a month end', () => {
    expect(dayHeading(at(2026, 9, 30, 22), new Date(2026, 9, 1, 9))).toBe('Yesterday')
  })

  it('says so when it can’t read it', () => {
    expect(dayHeading('', now)).toBe('Unknown')
  })
})

describe('formatTime and formatFullDate', () => {
  it('gives the clock time for a row, and everything for one opened up', () => {
    expect(formatTime(at(2026, 10, 21, 9, 5))).toBe('09:05')
    expect(formatFullDate(new Date(2026, 9, 21, 10, 42, 13).toISOString())).toBe('Wed 21 Oct 2026, 10:42:13')
  })

  it('is blank or Unknown for something that isn’t a date', () => {
    expect(formatTime('nope')).toBe('')
    expect(formatFullDate('nope')).toBe('Unknown')
  })
})

describe('timeAgo', () => {
  const now = new Date(2026, 9, 21, 10, 55)

  it('counts up in minutes, hours, then days', () => {
    expect(timeAgo(at(2026, 10, 21, 10, 55), now)).toBe('Just now')
    expect(timeAgo(at(2026, 10, 21, 10, 54), now)).toBe('1 minute ago')
    expect(timeAgo(at(2026, 10, 21, 10, 43), now)).toBe('12 minutes ago')
    expect(timeAgo(at(2026, 10, 21, 8, 30), now)).toBe('2 hours ago')
    expect(timeAgo(at(2026, 10, 19, 10, 0), now)).toBe('2 days ago')
  })

  it('says Just now for a clock a little ahead of this one', () => {
    expect(timeAgo(at(2026, 10, 21, 10, 57), now)).toBe('Just now')
  })
})
