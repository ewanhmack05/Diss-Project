import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { placeSheet, samePlacement, type SheetPlacement } from './sheetPlacement'
import { NO_FILTERS, NO_GROUP, PALETTE, activeFilterCount, toggled, type Either, type SavedFilters } from './filters'
import type { SavedFacets } from './useSavedFacets'
import './SavedFilterMenu.css'
import Icon from '../../icons/Icon'
import chevronLeftSvg from '../../icons/chevron-left.svg?raw'
import chevronRightSvg from '../../icons/chevron-right.svg?raw'
import chevronUpSvg from '../../icons/chevron-up.svg?raw'
import filterSvg from '../../icons/filter.svg?raw'

interface ShapeChoice {
  value: string
  label: string
  glyph: ReactNode
}

// A group and how many are in it - the last one is "No group".
interface GroupChoice {
  id: string
  name: string
  count: number
}

interface SavedFilterMenuProps {
  filters: SavedFilters
  onChange: (filters: SavedFilters) => void
  // From useSavedFacets - null while it loads.
  facets: SavedFacets | null
  myId: string
  // What this list can be filtered by beyond people, notes and dates -
  // annotations have shapes and colours, cell counts a region of interest.
  shapes?: ShapeChoice[]
  colours?: boolean
  // Annotations only - the collection's groups. Left out, there's no section.
  groups?: GroupChoice[]
  roi?: boolean
}

function panelOf(toggle: HTMLElement): HTMLElement {
  return toggle.closest<HTMLElement>('.draggable-panel') ?? toggle
}

// The sheet's place and the panel's text size, so it reads at the same scale.
interface Frame {
  placement: SheetPlacement
  fontSize: string
}

function frameFor(toggle: HTMLElement): Frame {
  const panel = panelOf(toggle)
  return {
    placement: placeSheet(panel.getBoundingClientRect(), toggle.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    }),
    fontSize: getComputedStyle(panel).fontSize,
  }
}

function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="saved-filter-section">
      <h3 className="saved-filter-section-title">{title}</h3>
      {children}
    </section>
  )
}

function Chip({
  on,
  onClick,
  children,
  label,
  className = '',
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
  label?: string
  className?: string
}) {
  return (
    <button
      type="button"
      className={`saved-filter-chip${on ? ' saved-filter-chip--on' : ''} ${className}`}
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

// Any / With / Without as one joined control, for notes and the region of
// interest.
function EitherPicker({ value, onChange, label }: { value: Either; onChange: (value: Either) => void; label: string }) {
  const choices: [Either, string][] = [
    ['any', 'Any'],
    ['yes', 'With'],
    ['no', 'Without'],
  ]
  return (
    <div className="saved-filter-either" role="group" aria-label={label}>
      {choices.map(([choice, text]) => (
        <button
          key={choice}
          type="button"
          className={`saved-filter-either-option${value === choice ? ' saved-filter-either-option--on' : ''}`}
          aria-pressed={value === choice}
          onClick={() => onChange(choice)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

// The Filter button beside a Saved list's search box, and the sheet it
// opens against the panel's side - who saved it, shape, colour, notes,
// region of interest and when. Changes apply as they're made, with the list
// still in view; the badge says how many are on.
function SavedFilterMenu({ filters, onChange, facets, myId, shapes, colours, groups, roi }: SavedFilterMenuProps) {
  const [frame, setFrame] = useState<Frame | null>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const open = frame !== null
  const active = activeFilterCount(filters)
  const set = (patch: Partial<SavedFilters>) => onChange({ ...filters, ...patch })
  const close = () => setFrame(null)

  // Follows the panel while it's open - dragged, resized, docked somewhere
  // else or the window resized. Checked each frame rather than with
  // observers, since a drag moves the panel without resizing anything.
  useEffect(() => {
    if (!open) return
    let raf = 0
    const follow = () => {
      const toggle = toggleRef.current
      if (toggle) {
        const next = frameFor(toggle)
        setFrame((current) =>
          current && samePlacement(current.placement, next.placement) && current.fontSize === next.fontSize ? current : next
        )
      }
      raf = requestAnimationFrame(follow)
    }
    raf = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(raf)
  }, [open])

  // An outside click or Escape closes it. The panel counts as inside - the
  // point of having it beside the list is being able to use the list too.
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      const toggle = toggleRef.current
      if (popupRef.current?.contains(target) || (toggle && panelOf(toggle).contains(target))) return
      setFrame(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFrame(null)
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const authors = facets?.authors ?? []
  const me = authors.find((a) => a.id === myId)
  const people = [
    ...(me ? [{ id: me.id, name: 'You', count: me.count }] : []),
    ...authors.filter((a) => a.id !== myId).map((a) => ({ ...a, name: a.name || 'Unnamed' })),
    // Someone picked whose last save has since gone - still listed, so they
    // can be unpicked.
    ...filters.createdBy
      .filter((id) => !authors.some((a) => a.id === id))
      .map((id) => ({ id, name: id === myId ? 'You' : 'Someone', count: 0 })),
  ]
  const used = new Map((facets?.colours ?? []).map((c) => [c.colour, c.count]))
  const customCount = (facets?.colours ?? []).filter((c) => !PALETTE.includes(c.colour)).reduce((sum, c) => sum + c.count, 0)

  const placement = frame?.placement
  const popupStyle: CSSProperties = placement
    ? {
        left: placement.left,
        top: placement.top,
        width: placement.width,
        minHeight: placement.minHeight ?? undefined,
        maxHeight: placement.maxHeight,
        fontSize: frame.fontSize,
      }
    : {}

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className={`saved-filter-toggle${active > 0 ? ' saved-filter-toggle--active' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setFrame(frameFor(toggleRef.current!)))}
      >
        <Icon svg={filterSvg} size={12} />
        Filter
        {active > 0 && <span className="saved-filter-badge">{active}</span>}
      </button>

      {open &&
        createPortal(
          <div
            ref={popupRef}
            className={`saved-filter-popup saved-filter-popup--${placement?.side}`}
            style={popupStyle}
            role="dialog"
            aria-label="Filters"
          >
            <header className="saved-filter-popup-header">
              Filters
              <button type="button" className="saved-filter-popup-close" aria-label="Close filters" onClick={close}>
                <Icon svg={placement?.side === 'left' ? chevronRightSvg : placement?.side === 'below' ? chevronUpSvg : chevronLeftSvg} size={12} />
              </button>
            </header>
            <div className="saved-filter-popup-body themed-scroll">
              <FilterSection title="Saved by">
                {people.length === 0 ? (
                  <p className="saved-filter-empty">{facets ? 'Nobody yet.' : 'Loading...'}</p>
                ) : (
                  <div className="saved-filter-chips">
                    {people.map((person) => (
                      <Chip
                        key={person.id}
                        on={filters.createdBy.includes(person.id)}
                        onClick={() => set({ createdBy: toggled(filters.createdBy, person.id) })}
                      >
                        {person.name}
                        <span className="saved-filter-count">{person.count.toLocaleString()}</span>
                      </Chip>
                    ))}
                  </div>
                )}
              </FilterSection>

              {shapes && (
                <FilterSection title="Shape">
                  <div className="saved-filter-shapes">
                    {shapes.map((shape) => (
                      <Chip
                        key={shape.value}
                        label={shape.label}
                        className="saved-filter-chip--icon"
                        on={filters.shapes.includes(shape.value)}
                        onClick={() => set({ shapes: toggled(filters.shapes, shape.value) })}
                      >
                        {shape.glyph}
                      </Chip>
                    ))}
                  </div>
                </FilterSection>
              )}

              {colours && (
                <FilterSection title="Colour">
                  <div className="saved-filter-swatches">
                    {PALETTE.map((colour) => {
                      const on = filters.colours.includes(colour)
                      const count = used.get(colour) ?? 0
                      return (
                        <button
                          key={colour}
                          type="button"
                          className={`saved-filter-swatch${on ? ' saved-filter-swatch--on' : ''}${count === 0 ? ' saved-filter-swatch--unused' : ''}`}
                          style={{ backgroundColor: colour }}
                          aria-pressed={on}
                          aria-label={`${colour.toUpperCase()}, ${count.toLocaleString()} saved`}
                          title={`${colour.toUpperCase()} - ${count.toLocaleString()}`}
                          onClick={() => set({ colours: toggled(filters.colours, colour) })}
                        />
                      )
                    })}
                    <button
                      type="button"
                      className={`saved-filter-swatch saved-filter-swatch--custom${filters.customColour ? ' saved-filter-swatch--on' : ''}${customCount === 0 ? ' saved-filter-swatch--unused' : ''}`}
                      aria-pressed={filters.customColour}
                      aria-label={`Custom colours, ${customCount.toLocaleString()} saved`}
                      title={`Custom - anything not in the palette - ${customCount.toLocaleString()}`}
                      onClick={() => set({ customColour: !filters.customColour })}
                    />
                  </div>
                </FilterSection>
              )}

              {groups && (
                <FilterSection title="Group">
                  {groups.length === 1 ? (
                    <p className="saved-filter-empty">No groups yet - make them on the Select tab.</p>
                  ) : (
                    <div className="saved-filter-chips">
                      {groups.map((group) => (
                        <Chip
                          key={group.id}
                          className={group.id === NO_GROUP ? 'saved-filter-chip--plain' : ''}
                          on={filters.groups.includes(group.id)}
                          onClick={() => set({ groups: toggled(filters.groups, group.id) })}
                        >
                          {group.name}
                          <span className="saved-filter-count">{group.count.toLocaleString()}</span>
                        </Chip>
                      ))}
                    </div>
                  )}
                </FilterSection>
              )}

              <FilterSection title="Notes">
                <EitherPicker label="Notes" value={filters.notes} onChange={(notes) => set({ notes })} />
              </FilterSection>

              {roi && (
                <FilterSection title="Region of interest">
                  <EitherPicker label="Region of interest" value={filters.roi} onChange={(value) => set({ roi: value })} />
                </FilterSection>
              )}

              <FilterSection title="Saved">
                <div className="saved-filter-dates">
                  <label>
                    From
                    <input
                      type="date"
                      value={filters.from ?? ''}
                      max={filters.to ?? undefined}
                      onChange={(e) => set({ from: e.target.value || null })}
                    />
                  </label>
                  <label>
                    To
                    <input
                      type="date"
                      value={filters.to ?? ''}
                      min={filters.from ?? undefined}
                      onChange={(e) => set({ to: e.target.value || null })}
                    />
                  </label>
                </div>
              </FilterSection>
            </div>

            <footer className="saved-filter-popup-footer">
              <button
                type="button"
                className="saved-filter-footer-button"
                disabled={active === 0}
                onClick={() => onChange(NO_FILTERS)}
              >
                Clear all
              </button>
              <button
                type="button"
                className="saved-filter-footer-button saved-filter-footer-button--primary"
                onClick={close}
              >
                Done
              </button>
            </footer>
          </div>,
          document.body
        )}
    </>
  )
}

export default SavedFilterMenu
