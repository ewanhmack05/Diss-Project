import { describe, expect, it } from 'vitest'
import { mergePolledItems } from './pollMerge'

interface Item {
  id: string
  value: string
}

function item(id: string, value = id): Item {
  return { id, value }
}

describe('mergePolledItems', () => {
  it('returns the server list unchanged when nothing is pending', () => {
    const server = [item('a'), item('b')]
    expect(mergePolledItems(server, [item('a'), item('b')], new Set(), new Set())).toEqual(server)
  })

  it('keeps an in-flight local create the poll has not seen yet', () => {
    const server = [item('a')]
    const local = [item('a'), item('pending-1')]
    const result = mergePolledItems(server, local, new Set(['pending-1']), new Set())
    expect(result).toEqual([item('a'), item('pending-1')])
  })

  it('drops a pending create once the server list actually contains it, instead of duplicating it', () => {
    const server = [item('a'), item('pending-1')]
    const local = [item('a'), item('pending-1')]
    const result = mergePolledItems(server, local, new Set(['pending-1']), new Set())
    expect(result).toEqual(server)
  })

  it('excludes a server item whose delete is still in flight', () => {
    const server = [item('a'), item('b')]
    const local = [item('a')]
    const result = mergePolledItems(server, local, new Set(), new Set(['b']))
    expect(result).toEqual([item('a')])
  })

  it('drops a local-only item that is not pending, e.g. a create whose POST already failed', () => {
    const server = [item('a')]
    const local = [item('a'), item('stale')]
    const result = mergePolledItems(server, local, new Set(), new Set())
    expect(result).toEqual([item('a')])
  })

  it('handles a simultaneous pending create and a pending delete in one poll', () => {
    const server = [item('a'), item('b')]
    const local = [item('a'), item('new-1')]
    const result = mergePolledItems(server, local, new Set(['new-1']), new Set(['b']))
    expect(result).toEqual([item('a'), item('new-1')])
  })

  it('returns an empty list for empty inputs', () => {
    expect(mergePolledItems([], [], new Set(), new Set())).toEqual([])
  })
})
