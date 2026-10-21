// A guest's way into one session, from the hub's POST /guests - see
// docs/guests.md. The name is theirs, typed in, and only ever goes to the hub
// in JoinAsGuest. It's kept in this tab's sessionStorage so a reload doesn't
// throw them out, and goes when the tab closes. Never sent to annotation-store.
interface GuestPass {
  token: string
  guestId: string
  sessionId: string
  slideId: string
  expires: string
  name: string
  // The link they came in on, to go back to after signing in or making an
  // account.
  inviteCode: string
}

// What annotation-store's GET /invites/{code}/guest gives anyone with the code.
interface GuestInvite {
  collectionId: string
  slideId: string
  collectionName: string
  hostName: string
  status: 'open' | 'expired' | 'stopped' | 'ended'
  expires: string
}

type PassResult =
  | { ok: true; pass: GuestPass }
  // missing - no such code. closed - expired, stopped or ended. busy - too
  // many tries from here. failed - anything else, the hub being down included.
  | { ok: false; reason: 'missing' | 'closed' | 'busy' | 'failed' }

const STORAGE_KEY = 'guest-pass'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

function isPass(value: unknown): value is GuestPass {
  if (!value || typeof value !== 'object') return false
  const pass = value as Record<string, unknown>
  return ['token', 'guestId', 'sessionId', 'slideId', 'expires', 'name', 'inviteCode'].every(
    (key) => typeof pass[key] === 'string' && pass[key] !== ''
  )
}

function hasExpired(pass: Pick<GuestPass, 'expires'>, now: number): boolean {
  const expires = Date.parse(pass.expires)
  return Number.isNaN(expires) || expires <= now
}

function readGuestPass(now = Date.now()): GuestPass | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const pass: unknown = JSON.parse(raw)
    if (isPass(pass) && !hasExpired(pass, now)) return pass
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Blocked or broken storage - they just join again.
  }
  return null
}

function storeGuestPass(pass: GuestPass) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pass))
  } catch {
    // Not kept past a reload.
  }
}

function forgetGuestPass() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to forget.
  }
}

async function fetchGuestInvite(storeUrl: string, code: string, fetcher: Fetch = fetch): Promise<GuestInvite | null> {
  try {
    const response = await fetcher(`${storeUrl}/invites/${encodeURIComponent(code)}/guest`)
    if (!response.ok) return null
    return (await response.json()) as GuestInvite
  } catch {
    return null
  }
}

async function requestGuestPass(hubUrl: string, code: string, name: string, fetcher: Fetch = fetch): Promise<PassResult> {
  let response: Response
  try {
    response = await fetcher(`${hubUrl}/guests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode: code }),
    })
  } catch {
    return { ok: false, reason: 'failed' }
  }
  if (response.status === 404) return { ok: false, reason: 'missing' }
  if (response.status === 410) return { ok: false, reason: 'closed' }
  if (response.status === 429) return { ok: false, reason: 'busy' }
  if (!response.ok) return { ok: false, reason: 'failed' }
  try {
    const body = (await response.json()) as Omit<GuestPass, 'name' | 'inviteCode'>
    const pass = { ...body, name, inviteCode: code }
    return isPass(pass) ? { ok: true, pass } : { ok: false, reason: 'failed' }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

export { fetchGuestInvite, forgetGuestPass, hasExpired, readGuestPass, requestGuestPass, storeGuestPass }
export type { GuestInvite, GuestPass, PassResult }
