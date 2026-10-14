import { describe, expect, it } from 'vitest'
import { NO_FILTERS, PALETTE, activeFilterCount, filterKey, filterParams, passes, toggled, type SavedFilters } from './filters'

function params(filters: SavedFilters): URLSearchParams {
  const query = new URLSearchParams()
  filterParams(filters, query)
  return query
}

// Local time, like the date inputs.
const at = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).toISOString()

describe('filterParams', () => {
  it('sends nothing with nothing picked', () => {
    expect(params(NO_FILTERS).toString()).toBe('')
  })

  it('repeats a key for each one picked', () => {
    const query = params({ ...NO_FILTERS, createdBy: ['alice', 'bob'], shapes: ['line'], colours: ['#fb0909', '#0913fb'] })
    expect(query.getAll('createdBy')).toEqual(['alice', 'bob'])
    expect(query.getAll('shape')).toEqual(['line'])
    expect(query.getAll('colour')).toEqual(['#fb0909', '#0913fb'])
  })

  it('sends Custom as everything but the palette', () => {
    const query = params({ ...NO_FILTERS, colours: ['#fb0909'], customColour: true })
    expect(query.getAll('colour')).toEqual(['#fb0909'])
    expect(query.getAll('otherThan')).toEqual(PALETTE)
  })

  it('sends with/without as true/false', () => {
    const query = params({ ...NO_FILTERS, notes: 'yes', roi: 'no' })
    expect(query.get('hasNotes')).toBe('true')
    expect(query.get('withRoi')).toBe('false')
  })

  it('sends days as the start of the first and the start of the day after the last', () => {
    const query = params({ ...NO_FILTERS, from: '2026-10-01', to: '2026-10-14' })
    expect(query.get('from')).toBe(new Date(2026, 9, 1).toISOString())
    expect(query.get('to')).toBe(new Date(2026, 9, 15).toISOString())
  })

  it('gets the day after right across a month end', () => {
    expect(params({ ...NO_FILTERS, to: '2026-10-31' }).get('to')).toBe(new Date(2026, 10, 1).toISOString())
  })
})

describe('passes', () => {
  const box = { created: at(2026, 10, 14), createdById: 'bob', shape: 'rectangle', colour: '#FB0909', notes: '' }

  it('lets everything through with nothing picked', () => {
    expect(passes(box, NO_FILTERS)).toBe(true)
  })

  it('matches any of the people, shapes and colours picked', () => {
    expect(passes(box, { ...NO_FILTERS, createdBy: ['alice', 'bob'] })).toBe(true)
    expect(passes(box, { ...NO_FILTERS, createdBy: ['alice'] })).toBe(false)
    expect(passes(box, { ...NO_FILTERS, shapes: ['line', 'rectangle'] })).toBe(true)
    expect(passes(box, { ...NO_FILTERS, shapes: ['line'] })).toBe(false)
    // Saved upper case, picked lower.
    expect(passes(box, { ...NO_FILTERS, colours: ['#fb0909'] })).toBe(true)
    expect(passes(box, { ...NO_FILTERS, colours: ['#0913fb'] })).toBe(false)
  })

  it('takes Custom as any colour off the palette, alongside picked ones', () => {
    const custom = { ...box, colour: '#123456' }
    expect(passes(custom, { ...NO_FILTERS, customColour: true })).toBe(true)
    expect(passes(box, { ...NO_FILTERS, customColour: true })).toBe(false)
    expect(passes(box, { ...NO_FILTERS, colours: ['#fb0909'], customColour: true })).toBe(true)
    expect(passes(custom, { ...NO_FILTERS, colours: ['#fb0909'] })).toBe(false)
  })

  it('checks notes and region of interest', () => {
    expect(passes(box, { ...NO_FILTERS, notes: 'no' })).toBe(true)
    expect(passes(box, { ...NO_FILTERS, notes: 'yes' })).toBe(false)
    expect(passes({ ...box, withRoi: true }, { ...NO_FILTERS, roi: 'yes' })).toBe(true)
    expect(passes(box, { ...NO_FILTERS, roi: 'yes' })).toBe(false)
  })

  it('takes both days whole', () => {
    const range = { ...NO_FILTERS, from: '2026-10-14', to: '2026-10-14' }
    expect(passes({ ...box, created: at(2026, 10, 14, 0) }, range)).toBe(true)
    expect(passes({ ...box, created: at(2026, 10, 14, 23) }, range)).toBe(true)
    expect(passes({ ...box, created: at(2026, 10, 13, 23) }, range)).toBe(false)
    expect(passes({ ...box, created: at(2026, 10, 15, 0) }, range)).toBe(false)
  })
})

describe('activeFilterCount', () => {
  it('counts each kind of filter once, and a date range once', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0)
    expect(activeFilterCount({ ...NO_FILTERS, createdBy: ['a', 'b'], colours: ['#000000'] })).toBe(2)
    expect(activeFilterCount({ ...NO_FILTERS, from: '2026-10-01', to: '2026-10-14', notes: 'yes' })).toBe(2)
    expect(activeFilterCount({ ...NO_FILTERS, customColour: true })).toBe(1)
  })
})

describe('filterKey', () => {
  it('is the same for equal filters and different otherwise', () => {
    expect(filterKey({ ...NO_FILTERS })).toBe(filterKey(NO_FILTERS))
    expect(filterKey({ ...NO_FILTERS, roi: 'no' })).not.toBe(filterKey(NO_FILTERS))
  })
})

describe('toggled', () => {
  it('adds or takes away one value', () => {
    expect(toggled(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggled(['a', 'b'], 'a')).toEqual(['b'])
  })
})
