import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchGuestInvite,
  forgetGuestPass,
  hasExpired,
  readGuestPass,
  requestGuestPass,
  storeGuestPass,
  type GuestPass,
} from './guestPass'

const NOW = Date.parse('2026-10-20T12:00:00Z')

const pass: GuestPass = {
  token: 'a.b.c',
  guestId: 'guest-abc',
  sessionId: '6f1c2c55-0000-4000-8000-000000000001',
  slideId: '003',
  expires: '2026-10-20T14:00:00Z',
  name: 'Dr Smith',
  inviteCode: 'code1',
}

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    items,
  }
}

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status })
}

describe('stored pass', () => {
  let storage: ReturnType<typeof memoryStorage>
  beforeEach(() => {
    storage = memoryStorage()
    vi.stubGlobal('sessionStorage', storage)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('comes back after a reload', () => {
    storeGuestPass(pass)
    expect(readGuestPass(NOW)).toEqual(pass)
  })

  it('is dropped once it has run out', () => {
    storeGuestPass(pass)
    expect(readGuestPass(Date.parse(pass.expires))).toBeNull()
    expect(storage.items.size).toBe(0)
  })

  it('is dropped if it has been tampered with', () => {
    storage.setItem('guest-pass', JSON.stringify({ ...pass, token: '' }))
    expect(readGuestPass(NOW)).toBeNull()
    storage.setItem('guest-pass', '{not json')
    expect(readGuestPass(NOW)).toBeNull()
  })

  it('is gone after forgetting it', () => {
    storeGuestPass(pass)
    forgetGuestPass()
    expect(readGuestPass(NOW)).toBeNull()
  })

  it('copes with storage that throws', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => storeGuestPass(pass)).not.toThrow()
    expect(readGuestPass(NOW)).toBeNull()
    expect(() => forgetGuestPass()).not.toThrow()
  })
})

describe('hasExpired', () => {
  it('treats a date it cannot read as expired', () => {
    expect(hasExpired({ expires: 'soon' }, NOW)).toBe(true)
    expect(hasExpired({ expires: '2026-10-20T12:00:01Z' }, NOW)).toBe(false)
  })
})

describe('fetchGuestInvite', () => {
  it('asks annotation-store without a token', async () => {
    const fetcher = vi.fn(async () => json(200, { collectionId: 'c', status: 'open' }))
    const invite = await fetchGuestInvite('/store', 'ab/c', fetcher)
    expect(invite?.status).toBe('open')
    expect(fetcher).toHaveBeenCalledWith('/store/invites/ab%2Fc/guest')
  })

  it('is null for an unknown code or no store', async () => {
    expect(await fetchGuestInvite('/store', 'x', async () => json(404))).toBeNull()
    expect(
      await fetchGuestInvite('/store', 'x', async () => {
        throw new TypeError('offline')
      })
    ).toBeNull()
  })
})

describe('requestGuestPass', () => {
  const minted = { token: 't', guestId: 'guest-x', sessionId: 's', slideId: '003', expires: '2026-10-20T14:00:00Z' }

  it('sends only the code to the hub, and keeps the name on this side', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => json(200, minted))
    const result = await requestGuestPass('/hub', 'code1', 'Dr Smith', fetcher)
    expect(result).toEqual({ ok: true, pass: { ...minted, name: 'Dr Smith', inviteCode: 'code1' } })
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/hub/guests')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ inviteCode: 'code1' })
    expect(String(init?.body)).not.toContain('Smith')
  })

  it.each([
    [404, 'missing'],
    [410, 'closed'],
    [429, 'busy'],
    [500, 'failed'],
  ] as const)('turns a %i into %s', async (status, reason) => {
    expect(await requestGuestPass('/hub', 'c', 'Ann', async () => json(status, { status: 'expired' }))).toEqual({
      ok: false,
      reason,
    })
  })

  it('fails on a hub that cannot be reached or sends back junk', async () => {
    const offline = async () => {
      throw new TypeError('offline')
    }
    expect(await requestGuestPass('/hub', 'c', 'Ann', offline)).toEqual({ ok: false, reason: 'failed' })
    expect(await requestGuestPass('/hub', 'c', 'Ann', async () => json(200, { token: 't' }))).toEqual({
      ok: false,
      reason: 'failed',
    })
    expect(await requestGuestPass('/hub', 'c', 'Ann', async () => new Response('<html>', { status: 200 }))).toEqual({
      ok: false,
      reason: 'failed',
    })
  })
})
