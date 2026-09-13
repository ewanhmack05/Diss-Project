import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ADJUSTMENTS,
  clampAdjustmentValues,
  parseAdjustments,
  serializeAdjustments,
  withUpdatedAdjustments,
  type ImageAdjustmentValues,
} from './adjustments'

describe('clampAdjustmentValues', () => {
  it('clamps brightness above and below its -1..1 range', () => {
    expect(clampAdjustmentValues({ brightness: 5 }).brightness).toBe(1)
    expect(clampAdjustmentValues({ brightness: -5 }).brightness).toBe(-1)
  })

  it('clamps contrast above and below its -1..1 range', () => {
    expect(clampAdjustmentValues({ contrast: 2 }).contrast).toBe(1)
    expect(clampAdjustmentValues({ contrast: -2 }).contrast).toBe(-1)
  })

  it('clamps gamma above and below its 0.1..3 range', () => {
    expect(clampAdjustmentValues({ gamma: 10 }).gamma).toBe(3)
    expect(clampAdjustmentValues({ gamma: 0 }).gamma).toBe(0.1)
  })

  it('clamps red above and below its 0..2 range', () => {
    expect(clampAdjustmentValues({ red: 9 }).red).toBe(2)
    expect(clampAdjustmentValues({ red: -1 }).red).toBe(0)
  })

  it('clamps green above and below its 0..2 range', () => {
    expect(clampAdjustmentValues({ green: 9 }).green).toBe(2)
    expect(clampAdjustmentValues({ green: -1 }).green).toBe(0)
  })

  it('clamps blue above and below its 0..2 range', () => {
    expect(clampAdjustmentValues({ blue: 9 }).blue).toBe(2)
    expect(clampAdjustmentValues({ blue: -1 }).blue).toBe(0)
  })

  it('leaves in-range values unchanged', () => {
    const values: ImageAdjustmentValues = { brightness: 0.5, contrast: -0.5, gamma: 2, red: 1.5, green: 0.5, blue: 1 }
    expect(clampAdjustmentValues(values)).toEqual(values)
  })

  it('falls back to each field own default when missing, not the whole object default', () => {
    const result = clampAdjustmentValues({ red: 1.8 })
    expect(result).toEqual({ ...DEFAULT_ADJUSTMENTS, red: 1.8 })
  })

  it('falls back to the field default for a non-finite value, without clamping it', () => {
    expect(clampAdjustmentValues({ gamma: NaN }).gamma).toBe(DEFAULT_ADJUSTMENTS.gamma)
    expect(clampAdjustmentValues({ brightness: Infinity }).brightness).toBe(DEFAULT_ADJUSTMENTS.brightness)
  })

  it('ignores extra unknown fields', () => {
    const result = clampAdjustmentValues({ red: 1.2, ...({ foo: 'bar' } as Partial<ImageAdjustmentValues>) })
    expect(result).toEqual({ ...DEFAULT_ADJUSTMENTS, red: 1.2 })
  })

  it('returns full defaults for an empty patch', () => {
    expect(clampAdjustmentValues({})).toEqual(DEFAULT_ADJUSTMENTS)
  })
})

describe('parseAdjustments', () => {
  it('returns fresh defaults on malformed JSON', () => {
    const result = parseAdjustments('not json')
    expect(result).toEqual(DEFAULT_ADJUSTMENTS)
    expect(result).not.toBe(DEFAULT_ADJUSTMENTS)
  })

  it('returns fresh defaults when the JSON is not an object', () => {
    expect(parseAdjustments('42')).toEqual(DEFAULT_ADJUSTMENTS)
    expect(parseAdjustments('null')).toEqual(DEFAULT_ADJUSTMENTS)
    expect(parseAdjustments('"red"')).toEqual(DEFAULT_ADJUSTMENTS)
  })

  it('fills in missing fields from valid JSON with only some fields set', () => {
    expect(parseAdjustments('{"red": 1.5}')).toEqual({ ...DEFAULT_ADJUSTMENTS, red: 1.5 })
  })

  it('clamps an out-of-range value found in otherwise valid JSON', () => {
    expect(parseAdjustments('{"gamma": 99}')).toEqual({ ...DEFAULT_ADJUSTMENTS, gamma: 3 })
  })

  it('round-trips a representative value through serialize/parse', () => {
    const values: ImageAdjustmentValues = { brightness: 0.25, contrast: -0.1, gamma: 1.8, red: 1.1, green: 0.9, blue: 1.4 }
    expect(parseAdjustments(serializeAdjustments(values))).toEqual(values)
  })
})

describe('withUpdatedAdjustments', () => {
  it('preserves every other field, only replacing adjustments', () => {
    const preset = {
      imageAdjustmentId: 'abc',
      slideId: 'slide-1',
      adjustmentName: 'My Preset',
      adjustments: serializeAdjustments(DEFAULT_ADJUSTMENTS),
      created: '2026-01-01T00:00:00.000Z',
    }
    const values: ImageAdjustmentValues = { ...DEFAULT_ADJUSTMENTS, red: 1.5 }

    const updated = withUpdatedAdjustments(preset, values)

    expect(updated.adjustmentName).toBe('My Preset')
    expect(updated.imageAdjustmentId).toBe('abc')
    expect(updated.slideId).toBe('slide-1')
    expect(updated.created).toBe('2026-01-01T00:00:00.000Z')
    expect(parseAdjustments(updated.adjustments)).toEqual(values)
  })
})
