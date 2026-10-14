import { useAnnotationStoreContext } from '../../context/AnnotationStoreContext'
import { useCollectionContext } from '../../context/CollectionContext'
import { useDrawContext } from '../../context/DrawContext'
import { useToolbarContext } from '../../context/ToolbarContext'
import PresenterNote from '../realtime/PresenterNote'
import { useState } from 'react'
import { savedTabLabel, type ListTotal } from '../saved/useSavedTotal'
import FreeForm from './FreeForm/FreeForm'
import SavedAnnotationList from './Saved/SavedAnnotationList'
import SelectTab from './Select/SelectTab'
import './AnnotationsPanel.css'

type AnnotationsTab = 'free-form' | 'select' | 'saved'

function AnnotationsPanel() {
  const { total, setSelectedAnnotationId, setViewedAnnotationId } = useAnnotationStoreContext()
  const { canEdit } = useCollectionContext()
  // In the toolbar's context so Present can follow the host's tab.
  const { panelTabs, setPanelTab } = useToolbarContext()
  const tab = (panelTabs.annotations ?? 'free-form') as AnnotationsTab
  const setTab = (next: AnnotationsTab) => setPanelTab('annotations', next)
  const { pending } = useDrawContext()
  // The Saved list's own count while it's open - it follows the search and
  // filters, and takes deletes off straight away.
  const [listTotal, setListTotal] = useState<ListTotal | null>(null)

  // Viewers can't draw, but can still show and hide groups.
  const shownTab = canEdit || tab !== 'free-form' ? tab : 'saved'

  return (
    <div className="annotations-panel">
      <div className="annotations-panel-tabs">
        {canEdit && <button
          type="button"
          className={`annotations-panel-tab${shownTab === 'free-form' ? ' annotations-panel-tab--active' : ''}`}
          onClick={() => {
            // Selection and viewing are shared context state (so the map can
            // pan to them), not local to the list - leaving Saved should still
            // drop both, or coming back later reopens straight into whatever
            // was last edited, and the halo stays on one you've left behind.
            setSelectedAnnotationId(null)
            setViewedAnnotationId(null)
            setTab('free-form')
          }}
        >
          Free Form
        </button>}
        <button
          type="button"
          className={`annotations-panel-tab${shownTab === 'select' ? ' annotations-panel-tab--active' : ''}`}
          disabled={!!pending}
          onClick={() => {
            setSelectedAnnotationId(null)
            setViewedAnnotationId(null)
            setTab('select')
          }}
        >
          {canEdit ? 'Select' : 'Groups'}
        </button>
        <button
          type="button"
          className={`annotations-panel-tab${shownTab === 'saved' ? ' annotations-panel-tab--active' : ''}`}
          disabled={!!pending}
          onClick={() => setTab('saved')}
        >
          {savedTabLabel(total, shownTab === 'saved' ? listTotal : null)}
        </button>
      </div>

      <div className="annotations-panel-content themed-scroll">
        <PresenterNote panel="annotations" />
        {shownTab === 'free-form' ? <FreeForm /> : shownTab === 'select' ? <SelectTab /> : <SavedAnnotationList onTotal={setListTotal} />}
      </div>
    </div>
  )
}

export default AnnotationsPanel
