// What the Saved lists' filter popout can narrow a list by, besides the
// search box. annotation-store does the filtering (see its SavedFilter);
// this is the same thing on this side, for the query string and for live
// saves that haven't been fetched yet.

import { PreDefinedColours } from '../annotation/Tools'

// The colour picker's swatches, lower case. Anything else is a custom colour.
const PALETTE = PreDefinedColours.map((colour) => colour.toLowerCase())

type Either = 'any' | 'yes' | 'no'

// In the groups filter, for annotations that aren't in one.
const NO_GROUP = 'none'

interface SavedFilters {
  // Keycloak ids - anyone's when empty, otherwise any of these people's.
  createdBy: string[]
  // Annotations only - the shape tool names, "rectangle" and so on.
  shapes: string[]
  // Annotations only - palette colours, hex, lower case - and whether
  // custom colours (anything off the palette) are in too.
  colours: string[]
  customColour: boolean
  // Annotations only - group ids, and NO_GROUP for ones not in a group.
  groups: string[]
  notes: Either
  // Cell counts only - with a region of interest or without.
  roi: Either
  // Days as the date input gives them, "2026-10-14", in local time. Both
  // ends included.
  from: string | null
  to: string | null
}

const NO_FILTERS: SavedFilters = {
  createdBy: [],
  shapes: [],
  colours: [],
  customColour: false,
  groups: [],
  notes: 'any',
  roi: 'any',
  from: null,
  to: null,
}

// The fields a live save is checked against - what both annotations and
// cell counts have, plus each one's own.
interface Filterable {
  created: string
  label?: string
  createdById?: string
  notes?: string
  shape?: string
  colour?: string
  groupId?: string | null
  withRoi?: boolean
}

// Midnight at the start of a local day.
function dayStart(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date)
}

// Midnight at the end of a local day - the start of the next one.
function dayEnd(day: string): Date {
  const start = dayStart(day)
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
}

function passesEither(filter: Either, value: boolean): boolean {
  return filter === 'any' || (filter === 'yes') === value
}

function passes(item: Filterable, filters: SavedFilters): boolean {
  const { createdBy, shapes, colours, customColour, groups, notes, roi, from, to } = filters
  if (createdBy.length > 0 && !createdBy.includes(item.createdById ?? '')) return false
  if (shapes.length > 0 && !shapes.includes(item.shape ?? '')) return false
  if (colours.length > 0 || customColour) {
    const colour = (item.colour ?? '').toLowerCase()
    if (!colours.includes(colour) && !(customColour && !PALETTE.includes(colour))) return false
  }
  if (groups.length > 0 && !groups.includes(item.groupId ?? NO_GROUP)) return false
  if (!passesEither(notes, (item.notes ?? '') !== '')) return false
  if (!passesEither(roi, item.withRoi ?? false)) return false
  const created = Date.parse(item.created)
  if (from && !(created >= dayStart(from).getTime())) return false
  if (to && !(created < dayEnd(to).getTime())) return false
  return true
}

// Same as annotation-store's Matching - label, notes or shape, ignoring
// case. Cell counts have no shape, so it's just label and notes for them.
function matchesSearch(item: Filterable, search: string): boolean {
  const term = search.trim().toLowerCase()
  if (!term) return true
  return [item.label, item.notes, item.shape].some((field) => (field ?? '').toLowerCase().includes(term))
}

// The filters as annotation-store's query string - repeated keys for the
// lists, instants for the days.
function filterParams(filters: SavedFilters, query: URLSearchParams): void {
  filters.createdBy.forEach((id) => query.append('createdBy', id))
  filters.shapes.forEach((shape) => query.append('shape', shape))
  filters.colours.forEach((colour) => query.append('colour', colour))
  // Custom is "anything not on the palette".
  if (filters.customColour) PALETTE.forEach((colour) => query.append('otherThan', colour))
  filters.groups.forEach((group) => query.append('group', group))
  if (filters.notes !== 'any') query.set('hasNotes', String(filters.notes === 'yes'))
  if (filters.roi !== 'any') query.set('withRoi', String(filters.roi === 'yes'))
  if (filters.from) query.set('from', dayStart(filters.from).toISOString())
  if (filters.to) query.set('to', dayEnd(filters.to).toISOString())
}

// How many filters are narrowing things, for the badge on the Filter button.
// A date range counts once.
function activeFilterCount(filters: SavedFilters): number {
  return (
    (filters.createdBy.length > 0 ? 1 : 0) +
    (filters.shapes.length > 0 ? 1 : 0) +
    (filters.colours.length > 0 || filters.customColour ? 1 : 0) +
    (filters.groups.length > 0 ? 1 : 0) +
    (filters.notes !== 'any' ? 1 : 0) +
    (filters.roi !== 'any' ? 1 : 0) +
    (filters.from || filters.to ? 1 : 0)
  )
}

// One string per set of filters, so an effect can tell when they've changed
// without the object's identity.
function filterKey(filters: SavedFilters): string {
  return JSON.stringify(filters)
}

// Adds or takes away one value from a multi-pick filter.
function toggled(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}

export { PALETTE, NO_GROUP, NO_FILTERS, passes, matchesSearch, filterParams, activeFilterCount, filterKey, toggled }
export type { SavedFilters, Either, Filterable }
