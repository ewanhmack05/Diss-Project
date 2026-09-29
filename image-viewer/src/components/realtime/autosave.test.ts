import { describe, expect, it } from 'vitest'
import { nextSave } from './autosave'

const saved = { label: 'Tumour edge', notes: 'old', colour: '#FB0909' }

describe('nextSave', () => {
  it('saves trimmed changes', () => {
    expect(nextSave({ label: ' Tumour margin ', notes: ' new ', colour: '#FB0909' }, saved)).toEqual({
      label: 'Tumour margin',
      notes: 'new',
      colour: '#FB0909',
    })
  })

  it('skips a save that would change nothing', () => {
    expect(nextSave({ ...saved, label: 'Tumour edge  ' }, saved)).toBeNull()
  })

  it('keeps the last label while the box is empty, but still saves the rest', () => {
    expect(nextSave({ label: '   ', notes: 'old', colour: '#000000' }, saved)).toEqual({
      label: 'Tumour edge',
      notes: 'old',
      colour: '#000000',
    })
    expect(nextSave({ ...saved, label: '' }, saved)).toBeNull()
  })

  it('clamps merged text that runs past the field limits', () => {
    const next = nextSave({ label: 'a'.repeat(100), notes: 'b'.repeat(300), colour: saved.colour }, saved)
    expect(next?.label).toHaveLength(64)
    expect(next?.notes).toHaveLength(256)
  })
})

describe('nextSave for a cell count', () => {
  const count = { label: 'Mitoses', notes: '', withAnnotation: true, withRoi: false, count: 12, dotSize: 6 }

  it('passes the counted facts through untouched', () => {
    expect(nextSave({ ...count, notes: 'hot spot' }, count)).toEqual({ ...count, notes: 'hot spot' })
  })

  it('skips a save that would change nothing', () => {
    expect(nextSave({ ...count, label: ' Mitoses ' }, count)).toBeNull()
  })
})
