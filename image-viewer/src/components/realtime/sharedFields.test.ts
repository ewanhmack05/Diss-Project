import { describe, expect, it } from 'vitest'
import { SharedFields, textDiff, transformIndex, type DocTransport, type FieldChange } from './sharedFields'
import type { DocState } from './realtime'

type Field = 'label' | 'notes'
const FIELDS: readonly Field[] = ['label', 'notes']

// Same rules as realtime-hub's OpenDoc/SendDocUpdate/CloseDoc: the first
// opener's seed starts the doc, later seeds are ignored, updates go to every
// other editor, and the doc is dropped when the last editor closes.
class FakeHub {
  private docs = new Map<string, { instanceId: string; updates: Uint8Array[]; editors: Set<Peer> }>()
  private nextInstance = 1
  // Deliveries waiting to happen, so tests can hold them back or reorder.
  queue: (() => void)[] = []

  transport(peer: Peer): DocTransport {
    return {
      open: async (seed) => this.open(peer, seed),
      send: (update) => this.send(peer, update),
    }
  }

  open(peer: Peer, seed: Uint8Array): DocState {
    let doc = this.docs.get('doc')
    const seeded = !doc
    if (!doc) {
      doc = { instanceId: `instance-${this.nextInstance++}`, updates: [seed], editors: new Set() }
      this.docs.set('doc', doc)
    }
    doc.editors.add(peer)
    return { instanceId: doc.instanceId, seeded, updates: [...doc.updates], editors: [] }
  }

  send(from: Peer, update: Uint8Array): void {
    const doc = this.docs.get('doc')
    if (!doc || !doc.editors.has(from)) throw new Error('Open the doc first')
    doc.updates.push(update)
    for (const editor of doc.editors) {
      if (editor !== from) this.queue.push(() => editor.shared.receive(update))
    }
  }

  close(peer: Peer): void {
    const doc = this.docs.get('doc')
    if (!doc) return
    doc.editors.delete(peer)
    if (doc.editors.size === 0) this.docs.delete('doc')
  }

  deliverAll(): void {
    while (this.queue.length) this.queue.shift()!()
  }
}

class Peer {
  shared: SharedFields<Field>
  private hub: FakeHub
  constructor(hub: FakeHub, initial: Record<Field, string>) {
    this.hub = hub
    this.shared = new SharedFields(FIELDS, initial)
  }
  connect() {
    return this.shared.connect(this.hub.transport(this))
  }
  drop() {
    this.shared.disconnect()
    this.hub.close(this)
  }
}

const saved = { label: 'Tumour edge', notes: '' }

describe('textDiff', () => {
  it('finds a typed character', () => {
    expect(textDiff('abc', 'abXc')).toEqual({ index: 2, remove: 0, insert: 'X' })
  })

  it('finds a deletion', () => {
    expect(textDiff('abcdef', 'abef')).toEqual({ index: 2, remove: 2, insert: '' })
  })

  it('finds a selection replaced by a paste', () => {
    expect(textDiff('hello world', 'hello there world')).toEqual({ index: 6, remove: 0, insert: 'there ' })
    expect(textDiff('hello world', 'hello WORLD')).toEqual({ index: 6, remove: 5, insert: 'WORLD' })
  })

  it('does nothing when nothing changed', () => {
    expect(textDiff('same', 'same')).toEqual({ index: 4, remove: 0, insert: '' })
  })

  it('never overlaps prefix and suffix on repeated characters', () => {
    expect(textDiff('aaa', 'aaaa')).toEqual({ index: 3, remove: 0, insert: 'a' })
    expect(textDiff('aaaa', 'aa')).toEqual({ index: 2, remove: 2, insert: '' })
  })
})

describe('transformIndex', () => {
  it('moves the caret right for text inserted before it', () => {
    expect(transformIndex(5, [{ retain: 2 }, { insert: 'abc' }])).toBe(8)
  })

  it('leaves the caret for text inserted after it or right at it', () => {
    expect(transformIndex(5, [{ retain: 7 }, { insert: 'abc' }])).toBe(5)
    expect(transformIndex(5, [{ retain: 5 }, { insert: 'abc' }])).toBe(5)
  })

  it('moves the caret left for text deleted before it', () => {
    expect(transformIndex(5, [{ retain: 1 }, { delete: 2 }])).toBe(3)
  })

  it('puts the caret at the cut when the deletion spans it', () => {
    expect(transformIndex(5, [{ retain: 3 }, { delete: 6 }])).toBe(3)
  })

  it('handles an insert at the very start', () => {
    expect(transformIndex(0, [{ insert: 'x' }])).toBe(0)
    expect(transformIndex(2, [{ insert: 'x' }])).toBe(3)
  })
})

describe('SharedFields', () => {
  it('lets a second opener join without doubling the seed text', async () => {
    const hub = new FakeHub()
    const a = new Peer(hub, saved)
    const b = new Peer(hub, saved)

    expect((await a.connect())?.seeded).toBe(true)
    expect((await b.connect())?.seeded).toBe(false)

    expect(a.shared.values()).toEqual(saved)
    expect(b.shared.values()).toEqual(saved)
  })

  it('merges two people typing into the same field at once', async () => {
    const hub = new FakeHub()
    const a = new Peer(hub, saved)
    const b = new Peer(hub, saved)
    await a.connect()
    await b.connect()

    a.shared.set('label', 'Big Tumour edge')
    b.shared.set('label', 'Tumour edge (left)')
    hub.deliverAll()

    expect(a.shared.get('label')).toBe('Big Tumour edge (left)')
    expect(b.shared.get('label')).toBe('Big Tumour edge (left)')
  })

  it("shows a late opener someone's unsaved typing rather than reverting it", async () => {
    const hub = new FakeHub()
    const a = new Peer(hub, saved)
    await a.connect()
    a.shared.set('notes', 'still typing')

    // B only has the saved value, which doesn't have A's notes yet.
    const b = new Peer(hub, saved)
    await b.connect()
    hub.deliverAll()

    expect(b.shared.get('notes')).toBe('still typing')
    expect(a.shared.get('notes')).toBe('still typing')
  })

  it('merges offline edits back in on reconnect', async () => {
    const hub = new FakeHub()
    const a = new Peer(hub, saved)
    const b = new Peer(hub, saved)
    await a.connect()
    await b.connect()

    a.shared.disconnect()
    a.shared.set('label', 'Tumour edge A')
    b.shared.set('notes', 'from B')
    hub.deliverAll()
    expect(a.shared.get('notes')).toBe('')

    await a.connect()
    hub.deliverAll()

    expect(a.shared.values()).toEqual({ label: 'Tumour edge A', notes: 'from B' })
    expect(b.shared.values()).toEqual({ label: 'Tumour edge A', notes: 'from B' })
  })

  it('reapplies offline edits on top of a doc that was re-seeded meanwhile', async () => {
    const hub = new FakeHub()
    const a = new Peer(hub, saved)
    await a.connect()
    a.drop()
    a.shared.set('label', 'Tumour edge A')

    // Nobody had it open, so C starts a new copy from the saved value.
    const c = new Peer(hub, { label: 'Tumour edge', notes: 'from C' })
    await c.connect()

    const state = await a.connect()
    hub.deliverAll()

    expect(state?.seeded).toBe(false)
    // A's label wins because A changed it; the notes A never touched are C's.
    expect(a.shared.values()).toEqual({ label: 'Tumour edge A', notes: 'from C' })
    expect(c.shared.values()).toEqual({ label: 'Tumour edge A', notes: 'from C' })
  })

  it('holds updates that arrive while the open call is in flight', async () => {
    const hub = new FakeHub()
    const a = new Peer(hub, saved)
    await a.connect()

    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const b = new Peer(hub, saved)
    const opening = b.shared.connect({
      open: async (seed) => {
        const state = hub.open(b, seed)
        await gate
        return state
      },
      send: (update) => hub.send(b, update),
    })

    // A types after B's snapshot was taken but before B has it.
    a.shared.set('label', 'Tumour edge!')
    hub.deliverAll()
    release()
    await opening
    hub.deliverAll()

    expect(b.shared.get('label')).toBe('Tumour edge!')
  })

  it('tells listeners which changes were remote, with the delta', async () => {
    const hub = new FakeHub()
    const a = new Peer(hub, saved)
    const b = new Peer(hub, saved)
    await a.connect()
    await b.connect()

    const seen: FieldChange<Field>[] = []
    b.shared.subscribe((change) => seen.push(change))
    b.shared.set('notes', 'mine')
    a.shared.set('label', 'X Tumour edge')
    hub.deliverAll()

    expect(seen).toEqual([
      { field: 'notes', remote: false, delta: [{ insert: 'mine' }] },
      { field: 'label', remote: true, delta: [{ insert: 'X ' }] },
    ])
  })

  it('works on its own with no hub at all', () => {
    const solo = new SharedFields(FIELDS, saved)
    solo.set('notes', 'offline only')
    expect(solo.values()).toEqual({ label: 'Tumour edge', notes: 'offline only' })
  })

  it('ignores updates and sends nothing once disposed', async () => {
    const hub = new FakeHub()
    const a = new Peer(hub, saved)
    const b = new Peer(hub, saved)
    await a.connect()
    await b.connect()
    b.shared.dispose()
    hub.close(b)

    a.shared.set('label', 'changed')
    expect(() => hub.deliverAll()).not.toThrow()
  })
})

// Seeded so a failure can be replayed exactly.
function prng(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

describe('SharedFields convergence', () => {
  it('ends up identical for every peer after random concurrent edits', async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = prng(seed)
      const hub = new FakeHub()
      const peers = [0, 1, 2].map(() => new Peer(hub, saved))
      for (const peer of peers) await peer.connect()

      for (let step = 0; step < 150; step++) {
        const peer = peers[Math.floor(random() * peers.length)]
        const field = FIELDS[Math.floor(random() * FIELDS.length)]
        const current = peer.shared.get(field)
        const at = Math.floor(random() * (current.length + 1))
        const next =
          random() < 0.65 || current.length === 0
            ? current.slice(0, at) + 'xyz'[Math.floor(random() * 3)] + current.slice(at)
            : current.slice(0, at) + current.slice(at + 1 + Math.floor(random() * 3))
        peer.shared.set(field, next)

        // Deliver some of the backlog out of order, keep the rest back.
        if (random() < 0.3) {
          const i = Math.floor(random() * hub.queue.length)
          hub.queue.splice(i, 1)[0]?.()
        }
        if (random() < 0.2) hub.deliverAll()
      }
      hub.deliverAll()

      const [first, ...rest] = peers.map((peer) => peer.shared.values())
      for (const other of rest) expect(other, `seed ${seed}`).toEqual(first)
    }
  })
})
