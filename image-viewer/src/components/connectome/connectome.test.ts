import { describe, expect, it } from 'vitest'
import {
  SUPER_CLASS_PALETTE,
  colourForSuperClass,
  toSceneSpace,
  hexToRgb01,
  buildNeuronBuffers,
  buildConnectionBuffers,
  connectionKey,
  parseBotEvent,
  toWebSocketUrl,
  pulseProgress,
  pulseIntensity,
  easeInOutQuad,
  lerp,
  travelPoint,
} from './connectome'
import type { SeedConnection, SeedNeuron } from './types'

describe('colourForSuperClass', () => {
  it('returns the exact fixed palette entry for a known super class', () => {
    expect(colourForSuperClass('central')).toBe('#8B5CF6')
    expect(colourForSuperClass('optic')).toBe('#F59E0B')
  })

  it('falls back to a palette colour, deterministically, for an unknown super class', () => {
    const first = colourForSuperClass('some_finer_grained_class')
    const second = colourForSuperClass('some_finer_grained_class')
    expect(first).toBe(second)
    expect(Object.values(SUPER_CLASS_PALETTE)).toContain(first)
  })

  it('does not collide-crash across a spread of unknown classes', () => {
    const classes = ['a', 'ab', 'abc', 'foo_bar', 'zzzzzzzz', '', 'CENTRAL']
    for (const superClass of classes) {
      expect(() => colourForSuperClass(superClass)).not.toThrow()
      expect(typeof colourForSuperClass(superClass)).toBe('string')
    }
  })
})

describe('toSceneSpace', () => {
  it('maps the [0,1] range onto [-extent/2, extent/2]', () => {
    expect(toSceneSpace(0)).toBe(-100)
    expect(toSceneSpace(1)).toBe(100)
    expect(toSceneSpace(0.5)).toBe(0)
  })

  it('honours a custom extent', () => {
    expect(toSceneSpace(0, 10)).toBe(-5)
    expect(toSceneSpace(1, 10)).toBe(5)
  })
})

describe('hexToRgb01', () => {
  it('converts a hex colour into normalised [0,1] channels', () => {
    expect(hexToRgb01('#8B5CF6')).toEqual([
      0x8b / 255,
      0x5c / 255,
      0xf6 / 255,
    ])
  })

  it('handles pure black and white', () => {
    expect(hexToRgb01('#000000')).toEqual([0, 0, 0])
    expect(hexToRgb01('#FFFFFF')).toEqual([1, 1, 1])
  })
})

function neuron(id: string, superClass: string, x: number, y: number, z: number): SeedNeuron {
  return { id, label: id, superClass, side: null, neurotransmitter: null, x, y, z }
}

describe('buildNeuronBuffers', () => {
  const neurons = [neuron('n1', 'central', 0, 0, 0), neuron('n2', 'optic', 1, 1, 1)]

  it('scales each neuron into scene space at its own index', () => {
    const { positions, indexById } = buildNeuronBuffers(neurons)
    expect(indexById.get('n1')).toBe(0)
    expect(indexById.get('n2')).toBe(1)
    expect(Array.from(positions.slice(0, 3))).toEqual([-100, -100, -100])
    expect(Array.from(positions.slice(3, 6))).toEqual([100, 100, 100])
  })

  it('colours each neuron by its super class', () => {
    const { colors } = buildNeuronBuffers(neurons)
    // Both sides are rounded to float32 precision before comparing - colors
    // is a Float32Array, so the plain float64 values from hexToRgb01 would
    // otherwise differ in their last couple of decimal digits.
    expect(Array.from(colors.slice(0, 3))).toEqual(Array.from(new Float32Array(hexToRgb01('#8B5CF6'))))
    expect(Array.from(colors.slice(3, 6))).toEqual(Array.from(new Float32Array(hexToRgb01('#F59E0B'))))
  })
})

describe('buildConnectionBuffers', () => {
  const neurons = [neuron('n1', 'central', 0, 0, 0), neuron('n2', 'optic', 1, 1, 1)]
  const { positions: neuronPositions, indexById } = buildNeuronBuffers(neurons)

  it('lays out one segment (two vertices) per connection, matching its neurons positions', () => {
    const connections: SeedConnection[] = [{ preId: 'n1', postId: 'n2', synapses: 4, neurotransmitter: null }]
    const { positions, segmentIndexByKey } = buildConnectionBuffers(connections, neuronPositions, indexById)
    expect(Array.from(positions)).toEqual([-100, -100, -100, 100, 100, 100])
    expect(segmentIndexByKey.get(connectionKey('n1', 'n2'))).toBe(0)
  })

  it('drops a connection referencing a neuron id outside the seed rather than throwing', () => {
    const connections: SeedConnection[] = [
      { preId: 'n1', postId: 'ghost', synapses: 1, neurotransmitter: null },
      { preId: 'n1', postId: 'n2', synapses: 1, neurotransmitter: null },
    ]
    const { positions, segmentIndexByKey } = buildConnectionBuffers(connections, neuronPositions, indexById)
    expect(positions.length).toBe(6)
    expect(segmentIndexByKey.has(connectionKey('n1', 'ghost'))).toBe(false)
    expect(segmentIndexByKey.get(connectionKey('n1', 'n2'))).toBe(0)
  })
})

describe('parseBotEvent', () => {
  it('parses a valid annotation event', () => {
    const raw = JSON.stringify({ type: 'annotation', tick: 3, neuronId: 'n1', timestamp: '2026-01-01T00:00:00Z' })
    expect(parseBotEvent(raw)).toEqual({
      type: 'annotation',
      tick: 3,
      neuronId: 'n1',
      timestamp: '2026-01-01T00:00:00Z',
    })
  })

  it('parses a valid cellCount event', () => {
    const raw = JSON.stringify({ type: 'cellCount', tick: 7, neuronId: 'n2', timestamp: '2026-01-01T00:00:01Z' })
    expect(parseBotEvent(raw)?.type).toBe('cellCount')
  })

  it('parses a valid pathway event', () => {
    const raw = JSON.stringify({
      type: 'pathway',
      tick: 9,
      preId: 'n1',
      postId: 'n2',
      timestamp: '2026-01-01T00:00:02Z',
    })
    expect(parseBotEvent(raw)).toEqual({
      type: 'pathway',
      tick: 9,
      preId: 'n1',
      postId: 'n2',
      timestamp: '2026-01-01T00:00:02Z',
    })
  })

  it('returns null for malformed JSON rather than throwing', () => {
    expect(() => parseBotEvent('{not json')).not.toThrow()
    expect(parseBotEvent('{not json')).toBeNull()
  })

  it('returns null for valid JSON that is not an object', () => {
    expect(parseBotEvent('42')).toBeNull()
    expect(parseBotEvent('"hello"')).toBeNull()
    expect(parseBotEvent('null')).toBeNull()
    expect(parseBotEvent('[]')).toBeNull()
  })

  it('returns null for an unknown event type', () => {
    const raw = JSON.stringify({ type: 'mystery', tick: 1, timestamp: 'x' })
    expect(parseBotEvent(raw)).toBeNull()
  })

  it('returns null when a required field is missing or the wrong type', () => {
    expect(parseBotEvent(JSON.stringify({ type: 'annotation', tick: 1, timestamp: 'x' }))).toBeNull()
    expect(parseBotEvent(JSON.stringify({ type: 'annotation', tick: '1', neuronId: 'n1', timestamp: 'x' }))).toBeNull()
    expect(parseBotEvent(JSON.stringify({ type: 'pathway', tick: 1, preId: 'n1', timestamp: 'x' }))).toBeNull()
  })
})

describe('toWebSocketUrl', () => {
  it('converts http to ws', () => {
    expect(toWebSocketUrl('http://localhost:5300')).toBe('ws://localhost:5300')
  })

  it('converts https to wss', () => {
    expect(toWebSocketUrl('https://example.com:5300')).toBe('wss://example.com:5300')
  })

  it('leaves an already-websocket url unchanged', () => {
    expect(toWebSocketUrl('ws://localhost:5300')).toBe('ws://localhost:5300')
  })
})

describe('pulseProgress', () => {
  it('is 0 at the start and 1 once the duration has fully elapsed', () => {
    expect(pulseProgress(0, 500)).toBe(0)
    expect(pulseProgress(500, 500)).toBe(1)
  })

  it('clamps rather than overshooting past the duration', () => {
    expect(pulseProgress(900, 500)).toBe(1)
  })

  it('clamps negative elapsed time to 0', () => {
    expect(pulseProgress(-50, 500)).toBe(0)
  })
})

describe('pulseIntensity', () => {
  it('is 0 at both ends of the animation', () => {
    expect(pulseIntensity(0)).toBeCloseTo(0, 10)
    expect(pulseIntensity(1)).toBeCloseTo(0, 10)
  })

  it('peaks at 1 in the middle', () => {
    expect(pulseIntensity(0.5)).toBeCloseTo(1, 10)
  })
})

describe('easeInOutQuad', () => {
  it('anchors both ends', () => {
    expect(easeInOutQuad(0)).toBe(0)
    expect(easeInOutQuad(1)).toBe(1)
  })

  it('is exactly the midpoint at t=0.5', () => {
    expect(easeInOutQuad(0.5)).toBe(0.5)
  })

  it('never overshoots [0,1] for out-of-range input', () => {
    expect(easeInOutQuad(-1)).toBe(0)
    expect(easeInOutQuad(2)).toBe(1)
  })
})

describe('lerp', () => {
  it('interpolates linearly between two values', () => {
    expect(lerp(0, 10, 0.5)).toBe(5)
    expect(lerp(-10, 10, 0)).toBe(-10)
    expect(lerp(-10, 10, 1)).toBe(10)
  })
})

describe('travelPoint', () => {
  const pre: [number, number, number] = [0, 0, 0]
  const post: [number, number, number] = [10, 20, 30]

  it('starts exactly at the presynaptic neuron', () => {
    expect(travelPoint(pre, post, 0)).toEqual([0, 0, 0])
  })

  it('ends exactly at the postsynaptic neuron', () => {
    expect(travelPoint(pre, post, 1)).toEqual([10, 20, 30])
  })

  it('sits at the exact midpoint at progress 0.5, since easeInOutQuad(0.5) is 0.5', () => {
    expect(travelPoint(pre, post, 0.5)).toEqual([5, 10, 15])
  })
})
