import Feature from 'ol/Feature'
import LineString from 'ol/geom/LineString'
import Polygon, { fromExtent } from 'ol/geom/Polygon'
import { describe, expect, it } from 'vitest'
import { featureAt, idsInside, isInside, isPanKey, isTyping } from './selection'

const feature = (id: string, geometry: LineString | Polygon) => {
  const f = new Feature({ geometry })
  f.setId(id)
  return f
}

describe('isInside', () => {
  const box = fromExtent([0, -100, 100, 0])

  it('takes a shape that sits wholly in the area', () => {
    expect(isInside(fromExtent([10, -50, 40, -10]), box)).toBe(true)
    expect(isInside(new LineString([[5, -5], [95, -95]]), box)).toBe(true)
  })

  it('leaves one that pokes out', () => {
    expect(isInside(fromExtent([50, -50, 150, -10]), box)).toBe(false)
  })

  it('follows a lasso, not just its box', () => {
    // An L shape - the top right corner is outside it.
    const lasso = new Polygon([[[0, 0], [100, 0], [100, -40], [40, -40], [40, -100], [0, -100], [0, 0]]])
    expect(isInside(new LineString([[10, -10], [90, -20]]), lasso)).toBe(true)
    expect(isInside(new LineString([[60, -60], [90, -90]]), lasso)).toBe(false)
  })
})

describe('idsInside', () => {
  it('gives the ids of what is inside', () => {
    const features = [
      feature('in', fromExtent([10, -20, 20, -10])),
      feature('out', fromExtent([200, -20, 210, -10])),
      feature('half', fromExtent([90, -20, 110, -10])),
    ]
    expect(idsInside(features, fromExtent([0, -100, 100, 0]))).toEqual(['in'])
  })
})

describe('featureAt', () => {
  const big = feature('big', fromExtent([0, -100, 100, 0]))
  const small = feature('small', fromExtent([40, -60, 60, -40]))
  const line = feature('line', new LineString([[200, -50], [300, -50]]))

  it('picks the smallest shape under the click', () => {
    expect(featureAt([big, small], [50, -50], 1)?.getId()).toBe('small')
    expect(featureAt([big, small], [10, -10], 1)?.getId()).toBe('big')
  })

  it('picks a line within the tolerance', () => {
    expect(featureAt([line], [250, -53], 5)?.getId()).toBe('line')
    expect(featureAt([line], [250, -60], 5)).toBeNull()
  })
})

describe('isPanKey', () => {
  it('is Space with the pointer over the map', () => {
    // Box and lasso took every drag, so there was no way to move the map
    // with the Select tab open.
    expect(isPanKey('Space', 'BODY', true)).toBe(true)
    expect(isPanKey('Space', 'BUTTON', true)).toBe(true)
  })

  it("leaves Space alone off the map, so a focused button still works", () => {
    expect(isPanKey('Space', 'BUTTON', false)).toBe(false)
  })

  it('never takes a space being typed', () => {
    expect(isPanKey('Space', 'INPUT', true)).toBe(false)
    expect(isPanKey('Space', 'TEXTAREA', true)).toBe(false)
  })

  it('is only Space', () => {
    expect(isPanKey('KeyA', 'BODY', true)).toBe(false)
    expect(isPanKey('ShiftLeft', 'BODY', true)).toBe(false)
  })
})

describe('isTyping', () => {
  it('is a text field, not anything else', () => {
    expect(isTyping('INPUT')).toBe(true)
    expect(isTyping('SELECT')).toBe(true)
    expect(isTyping('DIV')).toBe(false)
    expect(isTyping(undefined)).toBe(false)
  })
})
