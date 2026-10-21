import { describe, expect, it } from 'vitest'

// Read the way the app reads them - as text, through Vite.
const svgs: Record<string, string> = import.meta.glob('./**/*.svg', { query: '?raw', import: 'default', eager: true })
const components: Record<string, string> = import.meta.glob('../components/**/*.tsx', { query: '?raw', import: 'default', eager: true })

// Drawn from live values, so they can't be a fixed file: the line preview
// is the annotation's own thickness, colour and dashes, and the rotation
// dial's needle and handle move with the angle.
const DRAWN_INLINE = ['../components/annotation/ShapeGlyph.tsx', '../components/rotation/RotationPanel.tsx']

// Its colour means something - the dashed cyan box is what an ROI looks
// like on the map.
const OWN_COLOUR = ['./roi.svg']

describe('icons', () => {
  const files = Object.entries(svgs)

  it('are all here as files', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it.each(files)('%s is one svg with a viewBox', (_, text) => {
    const svg = text.trim()
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg.match(/<svg[\s>]/g)).toHaveLength(1)
    expect(svg).toMatch(/<svg[^>]*\sviewBox="-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+"/)
  })

  it.each(files.filter(([path]) => !OWN_COLOUR.includes(path)))('%s draws in the colour around it', (_, text) => {
    expect(text).toContain('currentColor')
    expect(text).not.toMatch(/(stroke|fill)="#/)
  })

  it('no component draws a fixed svg inline - it goes in icons/ instead', () => {
    const inline = Object.entries(components)
      .filter(([, text]) => text.includes('<svg'))
      .map(([path]) => path)
      .sort()
    expect(inline).toEqual(DRAWN_INLINE)
  })
})
