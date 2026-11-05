import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectionsToDelete, ensurePeople, keycloakUser, PEOPLE, removePeople } from '../lib/people.js'

const OPTIONS = { keycloak: 'http://kc/auth', realm: 'diss', adminUser: 'admin', adminPassword: 'admin' }

function reply(status, body = null) {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

test('none of the recording users are the real test users', () => {
  const names = Object.values(PEOPLE).map((person) => person.username)
  for (const real of ['alice', 'bob', 'carol']) assert.ok(!names.includes(real))
  assert.ok(names.every((name) => name.startsWith('playback-')))
})

test('a new user is filled in enough to skip the complete your profile page', () => {
  const user = keycloakUser(PEOPLE.sam)
  assert.equal(user.emailVerified, true)
  assert.ok(user.firstName && user.lastName && user.email)
  assert.equal(user.credentials[0].temporary, false)
})

test('ensurePeople counts only the ones it made', async () => {
  const statuses = [201, 409]
  const made = await ensurePeople(OPTIONS, async (url) =>
    url.endsWith('/token') ? reply(200, { access_token: 't' }) : reply(statuses.shift())
  )
  assert.equal(made, 1)
})

test('ensurePeople stops on anything unexpected', async () => {
  await assert.rejects(
    ensurePeople(OPTIONS, async (url) => (url.endsWith('/token') ? reply(200, { access_token: 't' }) : reply(500))),
    /Couldn't make playback-sam: 500/
  )
})

test('a turned down admin sign-in says which flags to check', async () => {
  await assert.rejects(ensurePeople(OPTIONS, async () => reply(401)), /--admin-user/)
})

test('removePeople only deletes an exact username match', async () => {
  const deleted = []
  const removed = await removePeople(OPTIONS, async (url, init) => {
    if (url.endsWith('/token')) return reply(200, { access_token: 't' })
    if (init?.method === 'DELETE') {
      deleted.push(url.split('/').at(-1))
      return reply(204)
    }
    // Keycloak's search can hand back near matches.
    return reply(200, url.includes('playback-sam')
      ? [{ id: 'near', username: 'playback-sam2' }, { id: 'sam', username: 'playback-sam' }]
      : [{ id: 'near', username: 'playback-jo2' }])
  })
  assert.deepEqual(deleted, ['sam'])
  assert.equal(removed, 1)
})

test('only collections they own get deleted', () => {
  const ids = collectionsToDelete([
    { collectionId: 'mine', myRole: 'owner' },
    { collectionId: 'hosted-by-someone', myRole: 'editor' },
    { collectionId: 'shared-with-all', myRole: 'viewer' },
    { collectionId: 'not-a-member', myRole: null },
  ])
  assert.deepEqual(ids, ['mine'])
})
