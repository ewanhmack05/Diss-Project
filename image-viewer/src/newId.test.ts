import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId } from './newId'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses randomUUID when it is there', () => {
    expect(newId()).toMatch(UUID_V4)
  })

  it('still makes a v4 uuid over plain http, where randomUUID is missing', () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array<ArrayBuffer>) => real.getRandomValues(bytes) })
    const ids = new Set(Array.from({ length: 50 }, newId))
    expect(ids.size).toBe(50)
    ids.forEach((id) => expect(id).toMatch(UUID_V4))
  })
})
