import { useState } from 'react'
import { pageCount, typedPage } from './paging'
import './SavedPager.css'

interface SavedPagerProps {
  page: number
  total: number
  pageSize: number
  loading: boolean
  onPage: (page: number) => void
}

// « ‹ [page] of 1,021 › » under a Saved list. Type a page number and press
// Enter (or click away) to go straight there. Hidden while everything fits
// on one page.
function SavedPager({ page, total, pageSize, loading, onPage }: SavedPagerProps) {
  const pages = pageCount(total, pageSize)
  // What's in the box while it's being typed in - null shows the page
  // you're on, so paging with the buttons keeps it up to date.
  const [draft, setDraft] = useState<string | null>(null)
  if (pages <= 1) return null
  const first = page * pageSize + 1
  const last = Math.min(total, (page + 1) * pageSize)

  const commit = () => {
    if (draft === null) return
    const next = typedPage(draft, pages)
    setDraft(null)
    if (next !== null && next !== page) onPage(next)
  }

  return (
    <nav
      className="saved-pager"
      aria-label="Pages"
      title={`${first.toLocaleString()}-${last.toLocaleString()} of ${total.toLocaleString()}`}
    >
      <button
        type="button"
        className="saved-pager-button"
        onClick={() => onPage(0)}
        disabled={page === 0}
        aria-label="First page"
      >
        «
      </button>
      <button
        type="button"
        className="saved-pager-button"
        onClick={() => onPage(page - 1)}
        disabled={page === 0}
        aria-label="Previous page"
      >
        ‹
      </button>
      <span className={`saved-pager-status${loading ? ' saved-pager-status--loading' : ''}`}>
        <input
          className="saved-pager-input"
          type="text"
          inputMode="numeric"
          aria-label={`Page, of ${pages.toLocaleString()}`}
          value={draft ?? String(page + 1)}
          // Wide enough for the last page's number, so it doesn't jump.
          size={String(pages).length}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setDraft(null)
          }}
        />
        <span aria-live="polite">of {pages.toLocaleString()}</span>
      </span>
      <button
        type="button"
        className="saved-pager-button"
        onClick={() => onPage(page + 1)}
        disabled={page >= pages - 1}
        aria-label="Next page"
      >
        ›
      </button>
      <button
        type="button"
        className="saved-pager-button"
        onClick={() => onPage(pages - 1)}
        disabled={page >= pages - 1}
        aria-label="Last page"
      >
        »
      </button>
    </nav>
  )
}

export default SavedPager
