import { describe, expect, it } from 'vitest'
import type { Participant } from '../realtime/realtime'
import { matchesName, peopleByName, splitChips } from './chips'

const person = (userId: string, extra: Partial<Participant> = {}): Participant => ({
  connectionId: `c-${userId}`,
  roomId: 'r',
  userId,
  displayName: userId,
  colour: '#000',
  joined: '2026-10-19T00:00:00Z',
  host: false,
  canEdit: false,
  viewport: null,
  sketches: null,
  screen: null,
  ...extra,
})
const crowd = (n: number) => Array.from({ length: n }, (_, i) => person(`p${i + 1}`))
const ids = (people: Participant[]) => people.map((p) => p.userId)

describe('splitChips', () => {
  it('shows everyone in a small session', () => {
    const others = crowd(5)
    expect(splitChips(others, false)).toEqual({ visible: others, more: [] })
  })

  it('shows just the editors in a large session, the host first, and puts everyone watching behind more', () => {
    // 122 people made the bar five rows deep.
    const watching = crowd(115)
    const others = [
      person('editor1', { canEdit: true }),
      ...watching.slice(0, 50),
      person('host', { host: true, canEdit: true }),
      ...watching.slice(50),
      person('editor2', { canEdit: true }),
    ]
    const { visible, more } = splitChips(others, true)
    expect(ids(visible)).toEqual(['host', 'editor1', 'editor2'])
    expect(ids(more)).toEqual(ids(watching))
  })

  it('has no chips past yours when nobody else can edit', () => {
    expect(splitChips(crowd(10), true)).toEqual({ visible: [], more: crowd(10) })
  })
})

describe('peopleByName', () => {
  it('lists each person once, by name, numbers in order', () => {
    const others = [person('b', { displayName: 'Roy 10' }), person('a', { displayName: 'Roy 2' }), person('a', { connectionId: 'second-tab', displayName: 'Roy 2' })]
    expect(peopleByName(others).map((p) => p.displayName)).toEqual(['Roy 2', 'Roy 10'])
  })
})

describe('matchesName', () => {
  it('finds a name from any part of it, ignoring case', () => {
    const roy = person('r', { displayName: 'Roy Mustang 3' })
    expect(matchesName(roy, 'must')).toBe(true)
    expect(matchesName(roy, ' ROY ')).toBe(true)
    expect(matchesName(roy, 'riza')).toBe(false)
    expect(matchesName(roy, '')).toBe(true)
  })
})
