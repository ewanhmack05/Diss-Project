import * as Y from 'yjs'
import type { DocState } from './realtime'

// A handful of named text fields (an annotation's label and notes) that
// several people can type into at once. Each field is a Y.Text, so edits
// merge character by character instead of the last save winning. The hub
// only relays and keeps the raw updates - see realtime-hub/README.md.

type Delta = Y.YTextEvent['delta']

interface FieldChange<F extends string> {
  field: F
  remote: boolean
  // What changed, for moving the caret. Null when the whole field was
  // swapped out, e.g. after adopting the hub's copy.
  delta: Delta | null
}

interface DocTransport {
  // Null when it couldn't be opened (not connected).
  open: (seed: Uint8Array) => Promise<DocState | null>
  send: (update: Uint8Array) => void
}

// Marks updates that came from the hub, so they aren't sent back.
const REMOTE = Symbol('remote')

// The smallest single splice that turns `from` into `to`. Typing, pasting
// and deleting a selection are all one splice, which is all an input event
// can do.
function textDiff(from: string, to: string): { index: number; remove: number; insert: string } {
  const max = Math.min(from.length, to.length)
  let start = 0
  while (start < max && from[start] === to[start]) start++
  let end = 0
  while (end < max - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++
  return { index: start, remove: from.length - start - end, insert: to.slice(start, to.length - end) }
}

// Where a caret at `index` ends up after someone else's change. Text they
// insert exactly at the caret goes after it, so your next keystroke still
// lands where you were typing.
function transformIndex(index: number, delta: Delta): number {
  let oldPos = 0
  let result = index
  for (const op of delta) {
    if (oldPos > index) break
    if (op.retain !== undefined) {
      oldPos += op.retain
    } else if (op.insert !== undefined) {
      if (oldPos < index) result += typeof op.insert === 'string' ? op.insert.length : 1
    } else if (op.delete !== undefined) {
      if (oldPos < index) result -= Math.min(op.delete, index - oldPos)
      oldPos += op.delete
    }
  }
  return result
}

class SharedFields<F extends string> {
  private doc: Y.Doc
  private readonly fields: readonly F[]
  private readonly listeners = new Set<(change: FieldChange<F>) => void>()
  private unbind: () => void
  private transport: DocTransport | null = null
  // Which copy of the doc on the hub our history came from. A new one is
  // made each time the doc is dropped and re-seeded, and histories from two
  // different copies can't be merged - the seed text would appear twice.
  private instanceId: string | null = null
  // Fields typed in while not synced, so they can be put back on top of
  // the hub's copy if we have to adopt it.
  private readonly dirty = new Set<F>()
  // Updates that arrive while the open call is in flight.
  private buffered: Uint8Array[] | null = null
  private generation = 0
  private disposed = false

  constructor(fields: readonly F[], initial: Record<F, string>) {
    this.fields = fields
    this.doc = new Y.Doc()
    this.doc.transact(() => {
      for (const field of fields) this.doc.getText(field).insert(0, initial[field])
    }, REMOTE)
    this.unbind = this.bind(this.doc)
  }

  get(field: F): string {
    return this.doc.getText(field).toString()
  }

  values(): Record<F, string> {
    return Object.fromEntries(this.fields.map((field) => [field, this.get(field)])) as Record<F, string>
  }

  set(field: F, value: string): void {
    const text = this.doc.getText(field)
    const { index, remove, insert } = textDiff(text.toString(), value)
    if (!remove && !insert) return
    this.doc.transact(() => {
      if (remove) text.delete(index, remove)
      if (insert) text.insert(index, insert)
    })
  }

  subscribe(listener: (change: FieldChange<F>) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // Joins the shared copy. Safe to call again after a reconnect - whatever
  // was typed while offline is merged back in.
  async connect(transport: DocTransport): Promise<DocState | null> {
    const generation = ++this.generation
    this.transport = null
    this.buffered = []
    let state: DocState | null
    try {
      state = await transport.open(Y.encodeStateAsUpdate(this.doc))
    } catch {
      state = null
    }
    if (this.disposed || generation !== this.generation) return null
    const buffered = this.buffered
    this.buffered = null
    if (!state) return null

    if (state.seeded) {
      // The hub's copy is our doc as it was when we asked. Anything typed
      // since then still needs sending.
      this.instanceId = state.instanceId
      this.transport = transport
      if (this.dirty.size) transport.send(Y.encodeStateAsUpdate(this.doc))
    } else if (state.instanceId === this.instanceId) {
      // Same history, so a plain merge both ways. Our full state goes up in
      // case something we sent was lost when the connection dropped.
      this.applyRemote(state.updates)
      this.transport = transport
      transport.send(Y.encodeStateAsUpdate(this.doc))
    } else {
      this.adopt(state, transport)
    }
    this.applyRemote(buffered)
    this.dirty.clear()
    return state
  }

  // Stops sending. Edits carry on locally until the next connect.
  disconnect(): void {
    this.generation++
    this.transport = null
    this.buffered = null
  }

  receive(update: Uint8Array): void {
    if (this.buffered) this.buffered.push(update)
    else if (this.transport) Y.applyUpdate(this.doc, update, REMOTE)
  }

  dispose(): void {
    this.disposed = true
    this.disconnect()
    this.unbind()
    this.doc.destroy()
    this.listeners.clear()
  }

  // Someone else already has the doc open with a history we don't share.
  // Take theirs, then redo whatever we typed on our own copy as edits on
  // top, so it reaches them without doubling the text. Fields we didn't
  // touch just take their version, including their unsaved typing.
  private adopt(state: DocState, transport: DocTransport): void {
    const mine = this.values()
    const next = new Y.Doc()
    for (const update of state.updates) Y.applyUpdate(next, update, REMOTE)

    this.unbind()
    this.doc.destroy()
    this.doc = next
    this.unbind = this.bind(next)
    this.instanceId = state.instanceId
    this.transport = transport

    for (const field of this.fields) {
      if (this.dirty.has(field)) this.set(field, mine[field])
      this.emit({ field, remote: true, delta: null })
    }
  }

  private applyRemote(updates: Uint8Array[]): void {
    for (const update of updates) Y.applyUpdate(this.doc, update, REMOTE)
  }

  private bind(doc: Y.Doc): () => void {
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return
      if (this.transport) this.transport.send(update)
    }
    doc.on('update', onUpdate)

    const observers = this.fields.map((field) => {
      const text = doc.getText(field)
      const observer = (event: Y.YTextEvent) => {
        const remote = event.transaction.origin === REMOTE
        if (!remote && !this.transport) this.dirty.add(field)
        this.emit({ field, remote, delta: event.delta })
      }
      text.observe(observer)
      return () => text.unobserve(observer)
    })

    return () => {
      doc.off('update', onUpdate)
      observers.forEach((off) => off())
    }
  }

  private emit(change: FieldChange<F>): void {
    this.listeners.forEach((listener) => listener(change))
  }
}

export { SharedFields, textDiff, transformIndex }
export type { FieldChange, DocTransport }
