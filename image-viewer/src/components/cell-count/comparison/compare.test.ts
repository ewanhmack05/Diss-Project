import { describe, expect, it } from 'vitest'
import { compareCounts, matchCells } from './compare'

const at = (...points: [number, number][]) => points.map(([x, y]) => ({ x, y }))

describe('matchCells', () => {
  it('puts dots within the radius on the same cell, at their middle', () => {
    const cells = matchCells(
      [
        { connectionId: 'a', dots: at([0, 0]) },
        { connectionId: 'b', dots: at([4, 0]) },
      ],
      5
    )
    expect(cells).toEqual([{ x: 2, y: 0, foundBy: ['a', 'b'] }])
  })

  it('keeps dots further apart than the radius as separate cells', () => {
    const cells = matchCells(
      [
        { connectionId: 'a', dots: at([0, 0]) },
        { connectionId: 'b', dots: at([6, 0]) },
      ],
      5
    )
    expect(cells.map((cell) => cell.foundBy)).toEqual([['a'], ['b']])
  })

  it('never puts two of the same counter’s dots on one cell', () => {
    const cells = matchCells(
      [
        { connectionId: 'a', dots: at([0, 0]) },
        { connectionId: 'b', dots: at([1, 0], [2, 0]) },
      ],
      5
    )
    expect(cells.map((cell) => cell.foundBy)).toEqual([['a', 'b'], ['b']])
  })

  it('matches nearest first rather than in click order', () => {
    // b's first dot is in range of both cells, but the second cell is
    // only in range of b's second dot, which sits right on it.
    const cells = matchCells(
      [
        { connectionId: 'a', dots: at([0, 0], [8, 0]) },
        { connectionId: 'b', dots: at([4, 0], [8, 0]) },
      ],
      5
    )
    expect(cells.map((cell) => cell.foundBy)).toEqual([['a', 'b'], ['a', 'b']])
    expect(cells[1]).toMatchObject({ x: 8, y: 0 })
  })
})

describe('compareCounts', () => {
  it('scores full agreement when everyone clicked the same cells', () => {
    const dots = at([0, 0], [10, 10], [20, 20])
    const summary = compareCounts(
      [
        { connectionId: 'a', dots },
        { connectionId: 'b', dots },
      ],
      3
    )
    expect(summary.agreed).toBe(3)
    expect(summary.agreement).toBe(1)
    expect(summary.counters).toEqual([
      { connectionId: 'a', count: 3, agreed: 3, missed: 0, onlyThem: 0 },
      { connectionId: 'b', count: 3, agreed: 3, missed: 0, onlyThem: 0 },
    ])
  })

  it('counts what each person missed and found on their own', () => {
    const summary = compareCounts(
      [
        { connectionId: 'a', dots: at([0, 0], [10, 10], [50, 50]) },
        { connectionId: 'b', dots: at([1, 0], [10, 11]) },
        { connectionId: 'c', dots: at([0, 1], [90, 90]) },
      ],
      3
    )
    // [0,0] everyone, [10,10] a+b, [50,50] a only, [90,90] c only.
    expect(summary.cells).toHaveLength(4)
    expect(summary.agreed).toBe(1)
    expect(summary.agreement).toBe(0.25)
    expect(summary.counters).toEqual([
      { connectionId: 'a', count: 3, agreed: 1, missed: 1, onlyThem: 1 },
      { connectionId: 'b', count: 2, agreed: 1, missed: 2, onlyThem: 0 },
      { connectionId: 'c', count: 2, agreed: 1, missed: 2, onlyThem: 1 },
    ])
  })

  it('treats nothing counted as agreeing', () => {
    const summary = compareCounts(
      [
        { connectionId: 'a', dots: [] },
        { connectionId: 'b', dots: [] },
      ],
      3
    )
    expect(summary.agreement).toBe(1)
    expect(summary.cells).toEqual([])
  })
})
