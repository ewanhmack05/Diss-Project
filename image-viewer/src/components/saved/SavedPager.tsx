import { pageCount } from './paging'
import './SavedPager.css'

interface SavedPagerProps {
  page: number
  total: number
  pageSize: number
  loading: boolean
  onPage: (page: number) => void
}

// Prev / "Page 2 of 40" / Next under a Saved list. Hidden while everything
// fits on one page.
function SavedPager({ page, total, pageSize, loading, onPage }: SavedPagerProps) {
  const pages = pageCount(total, pageSize)
  if (pages <= 1) return null
  const first = page * pageSize + 1
  const last = Math.min(total, (page + 1) * pageSize)

  return (
    <nav className="saved-pager" aria-label="Pages">
      <button
        type="button"
        className="saved-pager-button"
        onClick={() => onPage(page - 1)}
        disabled={page === 0}
        aria-label="Previous page"
      >
        ‹
      </button>
      <span className="saved-pager-status" aria-live="polite" title={`${first.toLocaleString()}-${last.toLocaleString()} of ${total.toLocaleString()}`}>
        {loading ? 'Loading...' : `Page ${(page + 1).toLocaleString()} of ${pages.toLocaleString()}`}
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
    </nav>
  )
}

export default SavedPager
