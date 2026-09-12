import { useState } from 'react'
import { useCellCountStoreContext } from '../../context/CellCountStoreContext'
import { useCellCountDrawContext } from '../../context/CellCountDrawContext'
import CellCounter from './CellCounter/CellCounter'
import SavedCountList from './Saved/SavedCountList'
import './CellCountPanel.css'

type CellCountTab = 'new' | 'saved'

function CellCountPanel() {
  const [tab, setTab] = useState<CellCountTab>('new')
  const { cellCounts, setSelectedCellCountId, setViewedCellCountId } = useCellCountStoreContext()
  const { pending } = useCellCountDrawContext()

  return (
    <div className="cell-count-panel">
      <div className="cell-count-panel-tabs">
        <button
          type="button"
          className={`cell-count-panel-tab${tab === 'new' ? ' cell-count-panel-tab--active' : ''}`}
          onClick={() => {
            // Selection and viewing are shared context state (mirrors
            // AnnotationStoreContext) - leaving Saved should drop both, so
            // coming back later reopens into the plain list, and the map
            // doesn't keep showing a count you've left behind.
            setSelectedCellCountId(null)
            setViewedCellCountId(null)
            setTab('new')
          }}
        >
          New
        </button>
        <button
          type="button"
          className={`cell-count-panel-tab${tab === 'saved' ? ' cell-count-panel-tab--active' : ''}`}
          disabled={!!pending}
          onClick={() => setTab('saved')}
        >
          Saved{cellCounts.length > 0 ? ` (${cellCounts.length})` : ''}
        </button>
      </div>

      <div className="cell-count-panel-content">
        {tab === 'new' ? <CellCounter /> : <SavedCountList />}
      </div>
    </div>
  )
}

export default CellCountPanel
