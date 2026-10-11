import { describe, expect, it } from 'vitest'
import {
  applyOffline,
  applyOnline,
  applySnapshot,
  describeUser,
  inviteCodeFrom,
  listUsers,
  onlineUsers,
  whyCantInvite,
  type DirectoryUser,
  type OnlineUser,
  type PresenceState,
} from './presence'

function user(userId: string, version: number, extra: Partial<OnlineUser> = {}): OnlineUser {
  return {
    userId,
    displayName: userId[0].toUpperCase() + userId.slice(1),
    slideId: '003',
    sessionId: null,
    hosting: false,
    since: '2026-10-11T20:00:00Z',
    version,
    ...extra,
  }
}

const names = (state: PresenceState, me = 'me') => onlineUsers(state, me).map((u) => u.userId)

describe('presence state', () => {
  it('takes newer news about someone and ignores older', () => {
    let state = applyOnline({}, user('bob', 2, { slideId: '001' }))
    state = applyOnline(state, user('bob', 1, { slideId: '999' }))
    expect(onlineUsers(state, 'me')[0].slideId).toBe('001')

    state = applyOnline(state, user('bob', 3, { slideId: '003' }))
    expect(onlineUsers(state, 'me')[0].slideId).toBe('003')
  })

  it("doesn't let a late online bring back someone who's gone", () => {
    let state = applyOnline({}, user('bob', 1))
    state = applyOffline(state, { userId: 'bob', version: 3 })
    state = applyOnline(state, user('bob', 2))
    expect(names(state)).toEqual([])

    state = applyOnline(state, user('bob', 4))
    expect(names(state)).toEqual(['bob'])
  })

  it('ignores an offline older than what we have', () => {
    let state = applyOnline({}, user('bob', 5))
    state = applyOffline(state, { userId: 'bob', version: 4 })
    expect(names(state)).toEqual(['bob'])
  })

  it('a snapshot fills in everyone, and drops anyone not in it', () => {
    let state = applyOnline({}, user('dave', 1))
    state = applySnapshot(state, { users: [user('bob', 4), user('carol', 6)], version: 7 })
    expect(names(state)).toEqual(['bob', 'carol'])
  })

  it('keeps news that arrived ahead of an older snapshot', () => {
    // Carol came online at 9, but the snapshot was taken at 7.
    let state = applyOnline({}, user('carol', 9, { slideId: '001' }))
    // Bob went offline at 8, also after the snapshot.
    state = applyOffline(state, { userId: 'bob', version: 8 })
    state = applySnapshot(state, { users: [user('bob', 4), user('carol', 6, { slideId: '003' })], version: 7 })

    expect(names(state)).toEqual(['carol'])
    expect(onlineUsers(state, 'me')[0].slideId).toBe('001')
  })

  it('leaves you out and sorts by name', () => {
    let state: PresenceState = {}
    for (const [id, v] of [['me', 1], ['carol', 2], ['alice', 3], ['Bob', 4]] as const) state = applyOnline(state, user(id, v))
    expect(names(state)).toEqual(['alice', 'Bob', 'carol'])
  })
})

describe('listUsers', () => {
  const account = (userId: string, displayName = userId[0].toUpperCase() + userId.slice(1)): DirectoryUser => ({
    userId,
    username: userId,
    displayName,
  })
  const directory = ['me', 'alice', 'bob', 'carol', 'dave'].map((id) => account(id))
  const rows = (list: ReturnType<typeof listUsers>) => list.map((u) => `${u.userId}:${u.online ? 'on' : 'off'}`)

  it('lists everyone with an account but you - online first, then the rest, each by name', () => {
    let state = applyOnline({}, user('dave', 1))
    state = applyOnline(state, user('bob', 2))
    state = applyOnline(state, user('me', 3))
    expect(rows(listUsers(directory, state, 'me'))).toEqual(['bob:on', 'dave:on', 'alice:off', 'carol:off'])
  })

  it('moves someone down once they go offline', () => {
    let state = applyOnline({}, user('bob', 1))
    state = applyOffline(state, { userId: 'bob', version: 2 })
    expect(rows(listUsers(directory, state, 'me'))).toEqual(['alice:off', 'bob:off', 'carol:off', 'dave:off'])
  })

  it("still shows someone online who isn't in the directory yet", () => {
    const state = applyOnline({}, user('erin', 1))
    expect(rows(listUsers(directory, state, 'me'))[0]).toBe('erin:on')
  })

  it('falls back to just who is online without a directory', () => {
    const state = applyOnline({}, user('bob', 1))
    expect(rows(listUsers(null, state, 'me'))).toEqual(['bob:on'])
  })

  it("uses the username when there's no name", () => {
    expect(listUsers([{ userId: 'x', username: 'xavier', displayName: '' }], {}, 'me')[0].displayName).toBe('xavier')
  })
})

describe('inviteCodeFrom', () => {
  it('takes a code on its own', () => {
    expect(inviteCodeFrom('juyhsUFHC4gB')).toBe('juyhsUFHC4gB')
    expect(inviteCodeFrom('  a-b_C9  ')).toBe('a-b_C9')
  })

  it('takes the code off the end of an invite link', () => {
    expect(inviteCodeFrom('https://localhost:5173/?invite=juyhsUFHC4gB')).toBe('juyhsUFHC4gB')
    expect(inviteCodeFrom(' https://192.168.1.20:5173/?slide=003&invite=x_Y-z#map ')).toBe('x_Y-z')
  })

  it("keeps the code's case - codes are case sensitive", () => {
    expect(inviteCodeFrom('JUYHSufhc4Gb')).toBe('JUYHSufhc4Gb')
  })

  it("turns down anything that isn't a code", () => {
    expect(inviteCodeFrom('')).toBeNull()
    expect(inviteCodeFrom('   ')).toBeNull()
    expect(inviteCodeFrom('not a code')).toBeNull()
    expect(inviteCodeFrom('juyhs/UFHC4gB')).toBeNull()
    expect(inviteCodeFrom('https://localhost:5173/')).toBeNull()
    expect(inviteCodeFrom('https://localhost:5173/?invite=')).toBeNull()
    expect(inviteCodeFrom('https://localhost:5173/?invite=bad%20code')).toBeNull()
    expect(inviteCodeFrom('a'.repeat(65))).toBeNull()
  })
})

describe('describeUser', () => {
  const me = { slideId: '003', sessionId: 's1' }

  it('says what they are doing and where', () => {
    expect(describeUser(user('bob', 1), me)).toBe('Working alone · this slide')
    expect(describeUser(user('bob', 1, { sessionId: 's2', hosting: true }), me)).toBe('Hosting a session · this slide')
    expect(describeUser(user('bob', 1, { sessionId: 's2', slideId: '001' }), me)).toBe('In a session · slide 001')
    expect(describeUser(user('bob', 1, { sessionId: 's1' }), me)).toBe('In your session')
    expect(describeUser(user('bob', 1, { slideId: null }), me)).toBe('Just signed in')
    expect(describeUser(null, me)).toBe('Offline')
  })

  it("doesn't call two people working alone the same session", () => {
    expect(describeUser(user('bob', 1), { slideId: '003', sessionId: null })).toBe('Working alone · this slide')
  })
})

describe('whyCantInvite', () => {
  const hosting = { slideId: '003', sessionId: 's1', hosting: true }

  it('lets the host invite someone on the same slide', () => {
    expect(whyCantInvite(user('bob', 1), hosting)).toBeNull()
    expect(whyCantInvite(user('bob', 1, { sessionId: 's2' }), hosting)).toBeNull()
  })

  it('says why not otherwise', () => {
    expect(whyCantInvite(user('bob', 1), { ...hosting, hosting: false })).toMatch(/Host a session/)
    expect(whyCantInvite(user('bob', 1), { ...hosting, sessionId: null })).toMatch(/Host a session/)
    expect(whyCantInvite(user('bob', 1, { sessionId: 's1' }), hosting)).toMatch(/already in it/)
    expect(whyCantInvite(user('bob', 1, { slideId: '001' }), hosting)).toMatch(/another slide/)
    expect(whyCantInvite(null, hosting)).toMatch(/offline/)
  })
})
