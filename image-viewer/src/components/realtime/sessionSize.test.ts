import { describe, expect, it } from 'vitest'
import type { CollectionRole } from '../../context/CollectionContext'
import { defaultMaxEditors, readMaxEditors, sessionSize } from './sessionSize'

const members = (...roles: CollectionRole[]) => roles.map((role) => ({ role }))
const editors = (n: number) => members('owner', ...Array<CollectionRole>(n - 1).fill('editor'))

describe('sessionSize', () => {
  it('counts the host as one of the editors', () => {
    expect(sessionSize(members('owner', 'editor', 'viewer'), 6).editors).toBe(2)
  })

  it('is small and has room while everyone could edit', () => {
    expect(sessionSize(editors(5), 6)).toEqual({ editors: 5, maxEditors: 6, full: false, large: false })
  })

  it('is full but still small with every place taken and nobody watching', () => {
    expect(sessionSize(editors(6), 6)).toEqual({ editors: 6, maxEditors: 6, full: true, large: false })
  })

  it('is large once there are more people than editor places', () => {
    expect(sessionSize([...editors(6), ...members('viewer')], 6)).toMatchObject({ full: true, large: true })
  })

  it('goes back to small when people leave, and has room again when an editor steps down', () => {
    const big = [...editors(6), ...members('viewer')]
    expect(sessionSize(big.slice(0, 6), 6).large).toBe(false)
    const steppedDown = [...editors(5), ...members('viewer', 'viewer')]
    expect(sessionSize(steppedDown, 6)).toMatchObject({ editors: 5, full: false, large: true })
  })

  it('stays full when the host has made more editors than the link lets in', () => {
    expect(sessionSize([...editors(8), ...members('viewer')], 6)).toMatchObject({ editors: 8, full: true, large: true })
  })

  it('counts viewers in the size, not the editors - stored text order has no say here', () => {
    expect(sessionSize(members('viewer', 'viewer', 'viewer', 'viewer', 'viewer', 'viewer', 'owner'), 6)).toMatchObject({ editors: 1, full: false, large: true })
  })
})

describe('defaultMaxEditors', () => {
  it('starts the box at the viewer option', () => {
    expect(defaultMaxEditors(40)).toBe(40)
  })

  it('falls back to 6 without one, the same as annotation-store', () => {
    expect(defaultMaxEditors(undefined)).toBe(6)
    expect(defaultMaxEditors(Number.NaN)).toBe(6)
  })

  it('keeps an option outside 1 to 50 inside it', () => {
    expect(defaultMaxEditors(0)).toBe(1)
    expect(defaultMaxEditors(-3)).toBe(1)
    expect(defaultMaxEditors(80)).toBe(50)
    expect(defaultMaxEditors(4.6)).toBe(5)
  })
})

describe('readMaxEditors', () => {
  it.each([
    ['1', 1],
    ['6', 6],
    [' 12 ', 12],
    ['50', 50],
  ])('takes %j as %i', (text, value) => expect(readMaxEditors(text)).toBe(value))

  it.each(['', ' ', '0', '51', '-2', '2.5', '1e1', 'six', '3 4'])('turns down %j', (text) =>
    expect(readMaxEditors(text)).toBeNull()
  )
})
