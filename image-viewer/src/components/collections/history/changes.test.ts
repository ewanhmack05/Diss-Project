import { describe, expect, it } from 'vitest'
import { changeLines, deletedLine, type ChangeSetChanges, type FieldChange } from './changes'

const none: ChangeSetChanges = { changes: [], created: 0, deleted: 0, deletedNames: [], groups: {} }

const change = (overrides: Partial<FieldChange>): FieldChange => ({
  entity: 'annotation',
  column: 'Label',
  before: '',
  after: '',
  count: 1,
  names: ['Region 4'],
  ...overrides,
})

describe('changeLines', () => {
  it('says what an edit changed on one row, from and to', () => {
    const [line] = changeLines({ ...none, changes: [change({ before: 'Region 4', after: 'Region 4 (checked)', names: ['Region 4 (checked)'] })] })
    expect(line).toEqual({
      field: 'Label',
      rows: 'Region 4 (checked)',
      kind: 'text',
      from: [{ text: 'Region 4', empty: false }],
      to: { text: 'Region 4 (checked)', empty: false },
    })
  })

  it('shows nothing as (empty), so notes added to a blank show where they came from', () => {
    const [line] = changeLines({ ...none, changes: [change({ column: 'Notes', before: '', after: 'Looked at again' })] })
    expect(line.field).toBe('Notes')
    expect(line.from).toEqual([{ text: '(empty)', empty: true }])
  })

  it('says how many for a change to many rows, and gives colours as swatches', () => {
    const [line] = changeLines({ ...none, changes: [change({ column: 'Colour', before: '#ff0000', after: '#0913FB', count: 2140, names: ['a', 'b'] })] })
    expect(line.rows).toBe('2,140 annotations')
    expect(line.kind).toBe('colour')
    expect(line.from).toEqual([{ text: '#FF0000', empty: false, colour: '#ff0000' }])
    expect(line.to.colour).toBe('#0913FB')
  })

  it('names groups, gone ones included, and no group as empty', () => {
    const result = {
      ...none,
      groups: { g1: 'Stroma', g2: 'Tumour margin' },
      changes: [
        change({ column: 'GroupId', before: 'g1', after: 'g2', count: 8 }),
        change({ column: 'GroupId', before: null, after: 'g1' }),
        change({ column: 'GroupId', before: 'g3', after: null }),
      ],
    }
    const [moved, grouped, ungrouped] = changeLines(result)
    expect([moved.field, moved.from[0].text, moved.to.text]).toEqual(['Group', 'Stroma', 'Tumour margin'])
    expect(grouped.from).toEqual([{ text: 'No group', empty: true }])
    expect(ungrouped.from[0].text).toBe('a deleted group')
  })

  it('says yes or no for a flag, and numbers with separators', () => {
    const lines = changeLines({
      ...none,
      changes: [
        change({ entity: 'cellCount', column: 'WithRoi', before: false, after: true }),
        change({ entity: 'cellCount', column: 'Count', before: 1200, after: 12000 }),
        change({ entity: 'cellCount', column: 'DotSize', before: 6, after: 8 }),
      ],
    })
    expect(lines.map((l) => [l.field, l.from[0].text, l.to.text])).toEqual([
      ['With ROI', 'No', 'Yes'],
      ['Count', '1,200', '12,000'],
      ['Dot size', '6', '8'],
    ])
  })

  it("gives each image adjustment setting that changed a line, and leaves out ones that didn't", () => {
    const lines = changeLines({
      ...none,
      changes: [
        change({
          entity: 'imageAdjustment',
          column: 'Adjustments',
          before: '{"brightness":0,"contrast":0.2,"gamma":1}',
          after: '{"brightness":0.35,"contrast":0.2,"gamma":1.5}',
        }),
      ],
    })
    expect(lines.map((l) => [l.field, l.from[0].text, l.to.text])).toEqual([
      ['Brightness', '0', '0.35'],
      ['Gamma', '1', '1.5'],
    ])
  })

  it('puts rows that all went to the same thing on one line, with where each started', () => {
    const lines = changeLines({
      ...none,
      changes: [
        change({ column: 'Colour', before: '#000000', after: '#0913FB', count: 3, names: ['a', 'b', 'c'] }),
        change({ column: 'Colour', before: '#168304', after: '#0913FB', count: 3 }),
        change({ column: 'Colour', before: '#FB0909', after: '#0913FB', count: 1, names: [null] }),
        change({ column: 'Colour', before: '#0913FB', after: '#000000', count: 2 }),
      ],
    })
    expect(lines).toHaveLength(2)
    expect(lines[0].rows).toBe('7 annotations')
    expect(lines[0].from.map((f) => f.text)).toEqual(['#000000', '#168304', '#FB0909'])
    expect(lines[0].to.text).toBe('#0913FB')
    expect([lines[1].rows, lines[1].to.text]).toEqual(['2 annotations', '#000000'])
  })

  it("names a row that's gone since by what it was", () => {
    const [line] = changeLines({ ...none, changes: [change({ entity: 'cellCount', names: [null] })] })
    expect(line.rows).toBe('a deleted cell count')
  })

  it("shows a column it doesn't know as it is", () => {
    const [line] = changeLines({ ...none, changes: [change({ column: 'Shape', before: 'Box', after: 'Circle' })] })
    expect([line.field, line.kind, line.to.text]).toEqual(['Shape', 'other', 'Circle'])
  })

  it('is nothing for a change that changed nothing', () => {
    expect(changeLines(none)).toEqual([])
  })
})

describe('deletedLine', () => {
  it('names what went, with an and before the last', () => {
    expect(deletedLine({ ...none, deleted: 1, deletedNames: ['Region 7'] })).toBe('Region 7')
    expect(deletedLine({ ...none, deleted: 2, deletedNames: ['Region 7', 'Count 2'] })).toBe('Region 7 and Count 2')
  })

  it('says how many more past the ones it names', () => {
    expect(deletedLine({ ...none, deleted: 2140, deletedNames: ['a', 'b', 'c', 'd', 'e'] })).toBe('a, b, c, d, e and 2,135 more')
  })

  it('still says something for one with no name', () => {
    expect(deletedLine({ ...none, deleted: 1, deletedNames: [''] })).toBe('one with no name')
  })

  it('is nothing when nothing was deleted', () => {
    expect(deletedLine(none)).toBeNull()
  })
})
