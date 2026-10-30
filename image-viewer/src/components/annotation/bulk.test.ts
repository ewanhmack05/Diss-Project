import { describe, expect, it } from 'vitest'
import { CHANGE_SET_HEADER, MAX_BULK_IDS, changeSetHeaders, deleteAsOneChange, inBatches, jsonHeaders, newChangeSet, restorePath } from './bulk'

describe('inBatches', () => {
  it('splits a selection bigger than the cap so every request is under it', () => {
    // 21k selected and deleted used to go as one request, which the store
    // turned down, and the Saved tab kept counting all of them.
    const ids = Array.from({ length: 21_000 }, (_, i) => `a${i}`)
    const batches = inBatches(ids)
    expect(batches.map((b) => b.length)).toEqual([MAX_BULK_IDS, 1_000])
    expect(batches.every((b) => b.length <= MAX_BULK_IDS)).toBe(true)
    expect(batches.flat()).toEqual(ids)
  })

  it('keeps a selection at or under the cap in one request', () => {
    expect(inBatches(['a', 'b'])).toEqual([['a', 'b']])
    expect(inBatches(Array.from({ length: MAX_BULK_IDS }, (_, i) => i))).toHaveLength(1)
  })

  it('sends nothing for nothing', () => {
    expect(inBatches([])).toEqual([])
  })

  it('splits exactly on the size given', () => {
    expect(inBatches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})

describe('change sets', () => {
  it('sends the same id with every batch of one change', () => {
    const changeSet = newChangeSet()
    const headers = inBatches(Array.from({ length: 21_000 }, (_, i) => i)).map(() => changeSetHeaders(changeSet))
    expect(headers).toHaveLength(2)
    expect(headers.every((h) => h[CHANGE_SET_HEADER] === changeSet)).toBe(true)
    expect(headers[0]['Content-Type']).toBe('application/json')
  })

  it('gives each change its own id, in the GUID shape the store takes', () => {
    const a = newChangeSet()
    expect(a).not.toBe(newChangeSet())
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it("sends an edit form's change set with each save, and nothing extra without one", () => {
    const edit = newChangeSet()
    expect(jsonHeaders(edit)).toEqual({ 'Content-Type': 'application/json', [CHANGE_SET_HEADER]: edit })
    expect(jsonHeaders()).toEqual({ 'Content-Type': 'application/json' })
  })

  it('restores through the change set it was sent in', () => {
    expect(restorePath('3f2a')).toBe('/changesets/3f2a/restore')
  })
})

describe('deleteAsOneChange', () => {
  const ok = () => Promise.resolve(new Response(null, { status: 200 }))
  const status = (code: number) => () => Promise.resolve(new Response(null, { status: code }))

  // A request that answers when told to.
  function later() {
    let answer: (response: Response) => void = () => {}
    const promise = new Promise<Response>((resolve) => (answer = resolve))
    return { promise, answer: (code = 200) => answer(new Response(null, { status: code })) }
  }

  it('sends every batch with the same change set', async () => {
    const sent: { batch: string[]; headers: Record<string, string> }[] = []
    const ids = Array.from({ length: 21_000 }, (_, i) => `a${i}`)
    const { deleted } = deleteAsOneChange(ids, (batch, headers) => (sent.push({ batch, headers }), ok()), ok)
    await deleted
    expect(sent.map((s) => s.batch.length)).toEqual([MAX_BULK_IDS, 1_000])
    expect(new Set(sent.map((s) => s.headers[CHANGE_SET_HEADER])).size).toBe(1)
  })

  it("doesn't restore until the delete is in, and restores its change set", async () => {
    const batch = later()
    const restored: string[] = []
    let changeSet = ''
    const { undo } = deleteAsOneChange(
      ['a', 'b', 'c'],
      (_, headers) => ((changeSet = headers[CHANGE_SET_HEADER]), batch.promise),
      (path) => (restored.push(path), ok())
    )
    const undone = undo()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(restored).toEqual([])
    batch.answer()
    await undone
    expect(restored).toEqual([restorePath(changeSet)])
  })

  it('waits for every batch of a big one', async () => {
    const pending = [later(), later()]
    const answers = [...pending]
    const restored: string[] = []
    const { undo } = deleteAsOneChange(
      Array.from({ length: MAX_BULK_IDS + 1 }, (_, i) => `a${i}`),
      () => pending.shift()!.promise,
      (path) => (restored.push(path), ok())
    )
    const undone = undo()
    answers[0].answer()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(restored).toEqual([])
    answers[1].answer()
    await undone
    expect(restored).toHaveLength(1)
  })

  it('only restores once, however often undo is called', async () => {
    let restores = 0
    const { undo } = deleteAsOneChange(['a'], ok, () => (restores++, ok()))
    await Promise.all([undo(), undo(), undo()])
    await undo()
    expect(restores).toBe(1)
  })

  it('still restores what got in when a batch was turned down', async () => {
    const answers = [ok, status(500)]
    let restores = 0
    const { deleted, undo } = deleteAsOneChange(
      Array.from({ length: MAX_BULK_IDS + 1 }, (_, i) => `a${i}`),
      () => answers.shift()!(),
      () => (restores++, ok())
    )
    await expect(deleted).rejects.toThrow('500')
    await undo()
    expect(restores).toBe(1)
  })

  it('counts no such change set as nothing to put back, and anything else as a failure', async () => {
    await expect(deleteAsOneChange(['a'], status(403), status(404)).undo()).resolves.toBeUndefined()
    await expect(deleteAsOneChange(['a'], ok, status(409)).undo()).rejects.toThrow('409')
  })
})
