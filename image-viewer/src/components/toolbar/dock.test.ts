import { describe, expect, it } from 'vitest'
import {
  DOCK_SIDES,
  dockZoneId,
  emptyDockAssignments,
  dockPanel,
  undockPanel,
  sideOfPanel,
  resolvesToStart,
  computePreviewRect,
} from './dock'

describe('dockZoneId', () => {
  it('namespaces each side into its own droppable id', () => {
    expect(DOCK_SIDES.map(dockZoneId)).toEqual(['dock-left', 'dock-right', 'dock-top', 'dock-bottom'])
  })
})

describe('dockPanel', () => {
  it('docks a lone panel to an empty edge', () => {
    const result = dockPanel(emptyDockAssignments(), 'a', 'left', true)
    expect(result.left).toEqual(['a'])
  })

  it('splits an occupied edge, inserting the new panel at the start', () => {
    const occupied = dockPanel(emptyDockAssignments(), 'annotations', 'left', true)
    const result = dockPanel(occupied, 'cellcount', 'left', true)
    expect(result.left).toEqual(['cellcount', 'annotations'])
  })

  it('splits an occupied edge, inserting the new panel at the end', () => {
    const occupied = dockPanel(emptyDockAssignments(), 'annotations', 'left', true)
    const result = dockPanel(occupied, 'cellcount', 'left', false)
    expect(result.left).toEqual(['annotations', 'cellcount'])
  })

  it('moves a panel from one edge to another, leaving the old edge empty', () => {
    const onLeft = dockPanel(emptyDockAssignments(), 'a', 'left', true)
    const result = dockPanel(onLeft, 'a', 'right', true)
    expect(result.left).toEqual([])
    expect(result.right).toEqual(['a'])
  })

  it('is idempotent when re-dropped at the same position', () => {
    const once = dockPanel(emptyDockAssignments(), 'a', 'left', true)
    const twice = dockPanel(once, 'a', 'left', true)
    expect(twice.left).toEqual(['a'])
  })
})

describe('undockPanel', () => {
  it('removes a panel from whichever edge it was on', () => {
    const docked = dockPanel(emptyDockAssignments(), 'a', 'top', true)
    const result = undockPanel(docked, 'a')
    expect(result.top).toEqual([])
  })

  it('leaves a sibling on the same edge in place', () => {
    let assignments = dockPanel(emptyDockAssignments(), 'annotations', 'left', true)
    assignments = dockPanel(assignments, 'cellcount', 'left', false)
    const result = undockPanel(assignments, 'cellcount')
    expect(result.left).toEqual(['annotations'])
  })

  it('is a no-op for a panel that was never docked', () => {
    const result = undockPanel(emptyDockAssignments(), 'a')
    expect(result).toEqual(emptyDockAssignments())
  })
})

describe('sideOfPanel', () => {
  it('finds the edge a panel is docked to', () => {
    const assignments = dockPanel(emptyDockAssignments(), 'a', 'bottom', true)
    expect(sideOfPanel(assignments, 'a')).toBe('bottom')
  })

  it('returns null for a floating panel', () => {
    expect(sideOfPanel(emptyDockAssignments(), 'a')).toBeNull()
  })
})

describe('resolvesToStart', () => {
  const zoneRect = { top: 0, left: 0, width: 100, height: 400 }

  it('treats a drop in the top half of a left-edge zone as the start', () => {
    const activeRect = { top: 20, left: 0, width: 320, height: 40 }
    expect(resolvesToStart('left', activeRect, zoneRect)).toBe(true)
  })

  it('treats a drop in the bottom half of a right-edge zone as the end', () => {
    const activeRect = { top: 320, left: 0, width: 320, height: 40 }
    expect(resolvesToStart('right', activeRect, { ...zoneRect, left: 700 })).toBe(false)
  })

  it('treats a drop in the left half of a top-edge zone as the start', () => {
    const horizontalZone = { top: 0, left: 0, width: 800, height: 60 }
    const activeRect = { top: 0, left: 40, width: 320, height: 40 }
    expect(resolvesToStart('top', activeRect, horizontalZone)).toBe(true)
  })

  it('treats a drop in the right half of a bottom-edge zone as the end', () => {
    const horizontalZone = { top: 700, left: 0, width: 800, height: 60 }
    const activeRect = { top: 700, left: 600, width: 320, height: 40 }
    expect(resolvesToStart('bottom', activeRect, horizontalZone)).toBe(false)
  })
})

describe('computePreviewRect', () => {
  // The zone (DockZone's thin hit-test strip) is deliberately a different
  // size than edgeRect (the real docked panel, measured via App.tsx's edge
  // probes) - the preview must be sized/positioned from edgeRect, not the
  // strip used only to decide which half a drop resolves to.
  const zoneRect = { top: 0, left: 0, width: 48, height: 400 }
  const edgeRect = { top: 0, left: 0, width: 320, height: 400 }

  it('previews the full docked-panel size (not the hit-test strip) when nothing else is docked there', () => {
    const activeRect = { top: 300, left: 0, width: 320, height: 40 }
    expect(computePreviewRect('left', activeRect, zoneRect, edgeRect, false)).toEqual(edgeRect)
  })

  it('previews the top half of the docked-panel size when it already has an occupant and the drop is high', () => {
    const activeRect = { top: 20, left: 0, width: 320, height: 40 }
    expect(computePreviewRect('left', activeRect, zoneRect, edgeRect, true)).toEqual({
      top: 0,
      left: 0,
      width: 320,
      height: 200,
    })
  })

  it('previews the bottom half of the docked-panel size when it already has an occupant and the drop is low', () => {
    const activeRect = { top: 320, left: 0, width: 320, height: 40 }
    expect(computePreviewRect('left', activeRect, zoneRect, edgeRect, true)).toEqual({
      top: 200,
      left: 0,
      width: 320,
      height: 200,
    })
  })

  it('previews the left half of a top-edge docked-panel size when it already has an occupant and the drop is on the left', () => {
    const horizontalZone = { top: 0, left: 0, width: 800, height: 48 }
    const horizontalEdge = { top: 0, left: 0, width: 800, height: 256 }
    const activeRect = { top: 0, left: 40, width: 320, height: 40 }
    expect(computePreviewRect('top', activeRect, horizontalZone, horizontalEdge, true)).toEqual({
      top: 0,
      left: 0,
      width: 400,
      height: 256,
    })
  })

  it('previews the right half of a bottom-edge docked-panel size when it already has an occupant and the drop is on the right', () => {
    const horizontalZone = { top: 700, left: 0, width: 800, height: 48 }
    const horizontalEdge = { top: 644, left: 0, width: 800, height: 256 }
    const activeRect = { top: 700, left: 600, width: 320, height: 40 }
    expect(computePreviewRect('bottom', activeRect, horizontalZone, horizontalEdge, true)).toEqual({
      top: 644,
      left: 400,
      width: 400,
      height: 256,
    })
  })
})
