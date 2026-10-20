import { describe, expect, it } from 'vitest'
import type { Participant } from './realtime'
import { activeUsers, splitActive } from './activeUsers'

const person = (userId: string, extra: Partial<Participant> = {}): Participant => ({
  connectionId: `c-${userId}`,
  roomId: 'r',
  userId,
  displayName: userId,
  colour: '#000',
  joined: '2026-10-20T00:00:00Z',
  host: false,
  canEdit: false,
  viewport: null,
  sketches: null,
  screen: null,
  ...extra,
})

describe('activeUsers', () => {
  it('puts the host first, then editors, viewers and guests, each by name', () => {
    const me = person('me', { displayName: 'Zed', canEdit: true })
    const others = [
      person('g2', { displayName: 'Guest b', guest: true }),
      person('v1', { displayName: 'Viewer' }),
      person('h', { displayName: 'Host', host: true, canEdit: true }),
      person('e1', { displayName: 'Amy', canEdit: true }),
      person('g1', { displayName: 'Guest a', guest: true }),
    ]
    expect(activeUsers(me, others).map((u) => [u.name, u.kind])).toEqual([
      ['Host', 'host'],
      ['Amy', 'editor'],
      ['Zed', 'editor'],
      ['Viewer', 'viewer'],
      ['Guest a', 'guest'],
      ['Guest b', 'guest'],
    ])
  })

  it('sorts numbers in names the way people expect', () => {
    const others = ['Guest 10', 'Guest 2', 'Guest 1'].map((name) => person(name, { displayName: name, guest: true }))
    expect(activeUsers(null, others).map((u) => u.name)).toEqual(['Guest 1', 'Guest 2', 'Guest 10'])
  })

  it('marks you, and only you', () => {
    const me = person('me')
    const users = activeUsers(me, [person('other')])
    expect(users.find((u) => u.userId === 'me')?.me).toBe(true)
    expect(users.find((u) => u.userId === 'other')?.me).toBe(false)
  })

  it('shows someone in two tabs once, with both connections and the most they can do', () => {
    const others = [
      person('amy', { connectionId: 'tab1' }),
      person('amy', { connectionId: 'tab2', canEdit: true }),
    ]
    const [amy, ...rest] = activeUsers(null, others)
    expect(rest).toEqual([])
    expect(amy.kind).toBe('editor')
    expect(amy.connectionIds).toEqual(['tab1', 'tab2'])
  })

  it('counts you once when your other tab is in the list too', () => {
    const me = person('me', { connectionId: 'here' })
    const users = activeUsers(me, [person('me', { connectionId: 'there' })])
    expect(users).toHaveLength(1)
    expect(users[0].me).toBe(true)
  })

  it('treats a guest as a guest even if a role flag says otherwise', () => {
    expect(activeUsers(null, [person('g', { guest: true, canEdit: true })])[0].kind).toBe('guest')
  })

  it('is empty before joining, with nobody else there', () => {
    expect(activeUsers(null, [])).toEqual([])
  })
})

describe('splitActive', () => {
  it('puts guests apart from people signed in, keeping each in order', () => {
    const users = activeUsers(person('me', { displayName: 'Me' }), [
      person('g2', { displayName: 'Guest 2', guest: true }),
      person('h', { displayName: 'Host', host: true, canEdit: true }),
      person('g1', { displayName: 'Guest 1', guest: true }),
    ])
    const { signedIn, guests } = splitActive(users)
    expect(signedIn.map((u) => u.name)).toEqual(['Host', 'Me'])
    expect(guests.map((u) => u.name)).toEqual(['Guest 1', 'Guest 2'])
  })

  it('copes with nobody in one group', () => {
    expect(splitActive(activeUsers(null, [person('g', { guest: true })])).signedIn).toEqual([])
    expect(splitActive(activeUsers(null, [person('a')])).guests).toEqual([])
  })
})
