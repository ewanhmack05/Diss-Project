// The two made up people in the videos. They have their own accounts, so
// recording never touches anyone's real annotations - resetting them between
// runs is what keeps the videos the same each time.
export const PASSWORD = 'password'

export const PEOPLE = {
  sam: { username: 'playback-sam', firstName: 'Sam', lastName: 'Reid' },
  jo: { username: 'playback-jo', firstName: 'Jo', lastName: 'Bell' },
}

export function keycloakUser(person) {
  return {
    username: person.username,
    enabled: true,
    emailVerified: true,
    firstName: person.firstName,
    lastName: person.lastName,
    email: `${person.username}@sim.test`,
    credentials: [{ type: 'password', value: PASSWORD, temporary: false }],
  }
}

async function adminToken(options, fetcher) {
  const response = await fetcher(`${options.keycloak}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: options.adminUser,
      password: options.adminPassword,
    }),
  })
  if (!response.ok) {
    throw new Error(`Keycloak turned down the admin sign-in (${response.status}) - check --admin-user / --admin-password`)
  }
  return (await response.json()).access_token
}

// Makes whichever of them Keycloak doesn't have yet. 409 means it's there.
export async function ensurePeople(options, fetcher = fetch) {
  const token = await adminToken(options, fetcher)
  let made = 0
  for (const person of Object.values(PEOPLE)) {
    const response = await fetcher(`${options.keycloak}/admin/realms/${options.realm}/users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(keycloakUser(person)),
    })
    if (response.status === 201) made++
    else if (response.status !== 409) throw new Error(`Couldn't make ${person.username}: ${response.status}`)
  }
  return made
}

export async function removePeople(options, fetcher = fetch) {
  const token = await adminToken(options, fetcher)
  const headers = { Authorization: `Bearer ${token}` }
  const base = `${options.keycloak}/admin/realms/${options.realm}/users`
  let removed = 0
  for (const person of Object.values(PEOPLE)) {
    const found = await fetcher(`${base}?exact=true&username=${encodeURIComponent(person.username)}`, { headers })
    if (!found.ok) throw new Error(`Couldn't look up ${person.username}: ${found.status}`)
    // Search can match more than the exact name, so check it before deleting.
    const match = (await found.json()).find((user) => user.username === person.username)
    if (!match) continue
    const gone = await fetcher(`${base}/${match.id}`, { method: 'DELETE', headers })
    if (!gone.ok) throw new Error(`Couldn't remove ${person.username}: ${gone.status}`)
    removed++
  }
  return removed
}

// Only what they own. A session someone else hosts goes when that person resets.
export function collectionsToDelete(collections) {
  return collections.filter((collection) => collection.myRole === 'owner').map((collection) => collection.collectionId)
}
