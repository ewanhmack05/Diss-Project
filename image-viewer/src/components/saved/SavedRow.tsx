import { useId, type ReactNode } from 'react'
import './SavedRow.css'

interface SavedRowProps {
  open: boolean
  onToggle: () => void
  // Swatch or icon before the label.
  leading: ReactNode
  label: string
  // Right of the label - the count, the shape.
  trailing: ReactNode
  // The second line of facts.
  meta: ReactNode
  // Third line, only when there are any.
  notes?: string
  // What opens underneath - see SavedDetails.
  children: ReactNode
}

// One row of a saved list: two lines of facts at a glance, and a click
// opens the rest underneath. Shared by saved cell counts and annotations.
function SavedRow({ open, onToggle, leading, label, trailing, meta, notes, children }: SavedRowProps) {
  const detailsId = useId()

  return (
    <li className={`saved-row${open ? ' saved-row--open' : ''}`}>
      <button
        type="button"
        className="saved-row-summary"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        <span className="saved-row-line">
          <span className="saved-row-leading">{leading}</span>
          <span className="saved-row-label">{label}</span>
          <span className="saved-row-trailing">{trailing}</span>
          <svg className="saved-row-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </span>
        <span className="saved-row-meta">{meta}</span>
        {notes && <span className="saved-row-notes">{notes}</span>}
      </button>
      {open && (
        <div id={detailsId} className="saved-row-details">
          {children}
        </div>
      )}
    </li>
  )
}

// Label/value pairs, then the row's buttons.
function SavedDetails({ items, actions }: { items: [string, ReactNode][]; actions: ReactNode }) {
  return (
    <>
      <dl className="saved-row-facts">
        {items.map(([term, value]) => (
          <div key={term} className="saved-row-fact">
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="saved-row-actions">{actions}</div>
    </>
  )
}

export default SavedRow
export { SavedDetails }
