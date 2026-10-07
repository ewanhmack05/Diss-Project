import { describe, expect, it } from 'vitest'
import { savedBy } from './savedBy'

describe('savedBy', () => {
  it('says You for your own', () => {
    expect(savedBy({ createdById: 'me', createdByName: 'Alice Moore' }, 'me')).toBe('You')
  })

  it('gives the name for anyone else', () => {
    expect(savedBy({ createdById: 'bob', createdByName: 'Bob Hughes' }, 'me')).toBe('Bob Hughes')
  })

  it('is nothing for things from before sign-in', () => {
    expect(savedBy({ createdById: '', createdByName: '' }, 'me')).toBeNull()
    expect(savedBy({}, 'me')).toBeNull()
  })
})
