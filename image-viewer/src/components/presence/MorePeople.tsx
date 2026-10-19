import { useEffect, useRef, useState } from 'react'
import { pointerProps, useViewportsContext } from '../../context/ViewportsContext'
import { viewportShown, type Participant } from '../realtime/realtime'
import { matchesName, peopleByName } from './chips'

interface MorePeopleProps {
  // Everyone else in the session, not just the ones without a chip - the
  // list is the whole session, so it's somewhere to find anyone.
  others: Participant[]
  hiddenCount: number
  large: boolean
}

// "+N more" at the end of a large session's chips, and the list it opens:
// everyone, searchable, each with their viewport box on or off. Pointing at
// a name picks their box out, the same as a chip.
function MorePeople({ others, hiddenCount, large }: MorePeopleProps) {
  const { pointedAt, pointAt, shown, setShown, setManyShown } = useViewportsContext()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  // Clicking anywhere else, or Escape, closes it.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  // Nobody stays picked out once the list's gone.
  useEffect(() => {
    if (!open) pointAt(null)
  }, [open, pointAt])

  const people = peopleByName(others)
  const found = people.filter((p) => matchesName(p, search))
  const onCount = people.filter((p) => viewportShown(p.userId, shown, large)).length

  return (
    <div className="presence-more" ref={rootRef}>
      <button
        type="button"
        className={`presence-chip presence-more-button${open ? ' presence-more-button--open' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        +{hiddenCount.toLocaleString()} more
      </button>
      {open && (
        <div className="presence-more-panel" role="dialog" aria-label="Everyone in this session">
          <div className="presence-more-head">
            <input
              type="search"
              className="presence-more-search"
              placeholder={`Search ${people.length.toLocaleString()} people`}
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="presence-more-actions">
              <span className="presence-more-count">
                {onCount.toLocaleString()} of {people.length.toLocaleString()} shown
              </span>
              {/* Only the ones the search finds, so a search then Show all
                  shows just them. */}
              <button type="button" className="presence-more-action" onClick={() => setManyShown(found.map((p) => p.userId), true)}>
                Show all
              </button>
              <button type="button" className="presence-more-action" onClick={() => setManyShown(found.map((p) => p.userId), false)}>
                Hide all
              </button>
            </div>
          </div>
          {found.length === 0 ? (
            <p className="presence-more-empty">Nobody called that.</p>
          ) : (
            <ul className="presence-more-list themed-scroll">
              {found.map((person) => {
                const on = viewportShown(person.userId, shown, large)
                return (
                  <li key={person.userId}>
                    <button
                      type="button"
                      className={`presence-more-row${on ? '' : ' presence-more-row--off'}${pointedAt === person.userId ? ' presence-more-row--pointed' : ''}`}
                      aria-pressed={on}
                      title={on ? `Hide where ${person.displayName} is looking` : `Show where ${person.displayName} is looking`}
                      onClick={() => setShown(person.userId, !on)}
                      {...pointerProps(person.userId, pointAt)}
                    >
                      <span className="presence-dot presence-dot--toggle" style={{ color: person.colour }} />
                      <span className="presence-more-name">{person.displayName}</span>
                      <span className="presence-more-role">{person.host ? 'host' : person.canEdit ? 'editing' : 'view only'}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default MorePeople
