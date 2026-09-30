import { describe, expect, it } from 'vitest'
import { clampToBounds, placeInColumns, PANEL_GAP, CASCADE_STEP } from './panelPlacement'

const bounds = { left: 8, top: 8, right: 1200, bottom: 700 }
const origin = { x: 256, y: 32 }
const size = { width: 320, height: 300 }

describe('clampToBounds', () => {
  it('leaves a position that already fits alone', () => {
    expect(clampToBounds({ x: 100, y: 100 }, size, bounds)).toEqual({ x: 100, y: 100 })
  })

  it('pulls a panel back in off the right and bottom edges', () => {
    expect(clampToBounds({ x: 1100, y: 600 }, size, bounds)).toEqual({ x: 1200 - 320, y: 700 - 300 })
  })

  it('pulls a panel back in off the left and top edges', () => {
    expect(clampToBounds({ x: -50, y: -50 }, size, bounds)).toEqual({ x: 8, y: 8 })
  })

  it('keeps the top-left on screen when the panel is bigger than the bounds', () => {
    expect(clampToBounds({ x: 100, y: 100 }, { width: 2000, height: 2000 }, bounds)).toEqual({ x: 8, y: 8 })
  })
})

describe('placeInColumns', () => {
  it('puts the first panel at the origin', () => {
    expect(placeInColumns(size, [], bounds, origin)).toEqual(origin)
  })

  it('stacks the next panel below the first when it fits', () => {
    const first = { ...origin, ...size, height: 200 }
    expect(placeInColumns(size, [first], bounds, origin)).toEqual({ x: 256, y: 32 + 200 + PANEL_GAP })
  })

  it('starts a new column when the next panel would run off the bottom', () => {
    const tall = { width: 320, height: 400 }
    const first = { ...origin, ...tall }
    expect(placeInColumns(tall, [first], bounds, origin)).toEqual({ x: 256 + 320 + PANEL_GAP, y: 32 })
  })

  it('reuses a gap left by a closed panel', () => {
    const lower = { x: 256, y: 400, ...size }
    expect(placeInColumns({ width: 320, height: 200 }, [lower], bounds, origin)).toEqual(origin)
  })

  it('ignores panels that were dragged away from the columns', () => {
    const elsewhere = { x: 900, y: 400, ...size }
    expect(placeInColumns(size, [elsewhere], bounds, origin)).toEqual(origin)
  })

  it('pulls the first column in on a screen narrower than the origin allows', () => {
    const narrow = { left: 8, top: 8, right: 500, bottom: 700 }
    expect(placeInColumns(size, [], narrow, origin)).toEqual({ x: 500 - 320, y: 32 })
  })

  it('cascades from the origin when nothing fits anywhere', () => {
    const small = { left: 8, top: 8, right: 700, bottom: 400 }
    const first = { ...origin, ...size }
    expect(placeInColumns(size, [first], small, origin)).toEqual({ x: 256 + CASCADE_STEP, y: 32 + CASCADE_STEP })
  })

  it('never cascades past the bounds', () => {
    const small = { left: 8, top: 8, right: 700, bottom: 400 }
    const many = Array.from({ length: 10 }, () => ({ ...origin, ...size }))
    expect(placeInColumns(size, many, small, origin)).toEqual({ x: 700 - 320, y: 400 - 300 })
  })
})
