import { useCellCountStoreContext } from '../../context/CellCountStoreContext'
import { useCellCountDrawContext } from '../../context/CellCountDrawContext'
import { useCollectionContext } from '../../context/CollectionContext'
import { useToolbarContext } from '../../context/ToolbarContext'
import PresenterNote from '../realtime/PresenterNote'
import CellCounter from './CellCounter/CellCounter'
import SavedCountList from './Saved/SavedCountList'
import './CellCountPanel.css'

type CellCountTab = 'new' | 'saved'

function CellCountPanel() {
  const { cellCounts, setSelectedCellCountId, setViewedCellCountId } = useCellCountStoreContext()
  const { canEdit } = useCollectionContext()
  // In the toolbar's context so Present can follow the host's tab.
  const { panelTabs, setPanelTab } = useToolbarContext()
  const tab = (panelTabs.cellcount ?? 'new') as CellCountTab
  const setTab = (next: CellCountTab) => setPanelTab('cellcount', next)
  const { pending } = useCellCountDrawContext()

  const shownTab = canEdit ? tab : 'saved'
  return (
    <div className="cell-count-panel">
      <div className="cell-count-panel-tabs">
        {canEdit && <button
          type="button"
          className={`cell-count-panel-tab${shownTab === 'new' ? ' cell-count-panel-tab--active' : ''}`}
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
        </button>}
        <button
          type="button"
          className={`cell-count-panel-tab${shownTab === 'saved' ? ' cell-count-panel-tab--active' : ''}`}
          disabled={!!pending}
          onClick={() => setTab('saved')}
        >
          Saved{cellCounts.length > 0 ? ` (${cellCounts.length})` : ''}
        </button>
      </div>

      <div className="cell-count-panel-content themed-scroll">
        <PresenterNote panel="cellcount" />
        {shownTab === 'new' ? <CellCounter /> : <SavedCountList />}
      </div>
    </div>
  )
}

export default CellCountPanel
