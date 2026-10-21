// What one change did, as GET /changesets/{id}/changes gives it - see
// annotation-store's History/ChangeSetChanges.cs - and turned into the lines
// the History detail page shows: "Label  Region 4 -> Region 4 (checked)".

// One column going from one value to another, on count rows of one kind.
// names are the first few of those rows, null for one that's gone since.
interface FieldChange {
  entity: string
  column: string
  before: unknown
  after: unknown
  count: number
  names: (string | null)[]
}

interface ChangeSetChanges {
  changes: FieldChange[]
  created: number
  deleted: number
  deletedNames: (string | null)[]
  // Every group a GroupId in changes points at, by name.
  groups: Record<string, string>
}

type ValueKind = 'text' | 'colour' | 'group' | 'other'

// A value as shown. empty is for one with nothing in it - "(empty)", or no
// group - so the page can grey it out.
interface Shown {
  text: string
  empty: boolean
  // Colour values only: the hex, for a swatch.
  colour?: string
}

interface ChangeLine {
  field: string
  // Which rows: a name for one, "48 annotations" for many.
  rows: string
  kind: ValueKind
  // More than one when rows that started out different all went to the
  // same thing - a recolour of red, green and blue shapes to black.
  from: Shown[]
  to: Shown
}

const NOUNS: Record<string, [string, string]> = {
  annotation: ['annotation', 'annotations'],
  group: ['group', 'groups'],
  cellCount: ['cell count', 'cell counts'],
  imageAdjustment: ['image adjustment', 'image adjustments'],
}

// What each column's called on the page. Anything else is shown as it is.
const FIELDS: Record<string, string> = {
  Label: 'Label',
  Notes: 'Notes',
  Colour: 'Colour',
  GroupId: 'Group',
  Name: 'Name',
  AdjustmentName: 'Name',
  WithAnnotation: 'With annotation',
  WithRoi: 'With ROI',
  Count: 'Count',
  DotSize: 'Dot size',
}

// An image adjustment's settings are one JSON column - each one in it that
// changed gets a line of its own.
const SETTINGS: Record<string, string> = {
  brightness: 'Brightness',
  contrast: 'Contrast',
  gamma: 'Gamma',
  red: 'Red',
  green: 'Green',
  blue: 'Blue',
}

const number = (n: number) => n.toLocaleString('en-GB', { maximumFractionDigits: 2 })

function nounFor(entity: string): [string, string] {
  return NOUNS[entity] ?? ['row', 'rows']
}

function rowsFor(entity: string, count: number, name: string | null): string {
  const [one, many] = nounFor(entity)
  if (count > 1) return `${number(count)} ${many}`
  return name ?? `a deleted ${one}`
}

function show(column: string, value: unknown, groups: Record<string, string>): Shown {
  if (column === 'GroupId')
    return typeof value === 'string' ? { text: groups[value] ?? 'a deleted group', empty: false } : { text: 'No group', empty: true }
  if (column === 'Colour' && typeof value === 'string') return { text: value.toUpperCase(), empty: false, colour: value }
  if (typeof value === 'boolean') return { text: value ? 'Yes' : 'No', empty: false }
  if (typeof value === 'number') return { text: number(value), empty: false }
  if (value === null || value === undefined || value === '') return { text: '(empty)', empty: true }
  return { text: String(value), empty: false }
}

function kindOf(column: string): ValueKind {
  if (column === 'Colour') return 'colour'
  if (column === 'GroupId') return 'group'
  if (column === 'Label' || column === 'Notes' || column === 'Name' || column === 'AdjustmentName') return 'text'
  return 'other'
}

function settings(json: unknown): Record<string, unknown> {
  if (typeof json !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

interface Together {
  change: FieldChange
  befores: unknown[]
  count: number
}

// Changes to the same column that ended up the same, together - the store
// keeps them apart by where each one started. An image adjustment's
// settings are one JSON column, so those stay apart.
function together(changes: FieldChange[]): Together[] {
  const merged = new Map<string, Together>()
  for (const change of changes) {
    const ended = change.column === 'Adjustments' ? [change.before, change.after] : change.after
    const key = JSON.stringify([change.entity, change.column, ended])
    const found = merged.get(key)
    if (found) {
      found.befores.push(change.before)
      found.count += change.count
    } else merged.set(key, { change, befores: [change.before], count: change.count })
  }
  return [...merged.values()]
}

// Every line, in the order the store sent them - most rows first.
function changeLines(result: ChangeSetChanges): ChangeLine[] {
  return together(result.changes).flatMap(({ change, befores, count }): ChangeLine[] => {
    const rows = rowsFor(change.entity, count, change.names[0] ?? null)
    if (change.column === 'Adjustments') {
      const was = settings(change.before)
      const now = settings(change.after)
      return [...new Set([...Object.keys(was), ...Object.keys(now)])]
        .filter((key) => was[key] !== now[key])
        .map((key) => ({
          field: SETTINGS[key] ?? key,
          rows,
          kind: 'other',
          from: [show(key, was[key], result.groups)],
          to: show(key, now[key], result.groups),
        }))
    }
    return [
      {
        field: FIELDS[change.column] ?? change.column,
        rows,
        kind: kindOf(change.column),
        from: befores.map((before) => show(change.column, before, result.groups)),
        to: show(change.column, change.after, result.groups),
      },
    ]
  })
}

// "Region 7, Count 2 and 2,138 more" - what it took out, by name.
function deletedLine(result: ChangeSetChanges): string | null {
  if (result.deleted === 0) return null
  const names = result.deletedNames.map((n) => n || 'one with no name')
  const more = result.deleted - names.length
  if (more <= 0) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${names.join(', ')} and ${number(more)} more`
}

export { changeLines, deletedLine }
export type { ChangeSetChanges, ChangeLine, FieldChange, Shown }
