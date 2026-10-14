import { describe, expect, it } from 'vitest'
import { savedTabLabel } from './useSavedTotal'

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
