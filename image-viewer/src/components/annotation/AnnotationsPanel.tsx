import { useAnnotationStoreContext } from '../../context/AnnotationStoreContext'
import { useCollectionContext } from '../../context/CollectionContext'
import { useDrawContext } from '../../context/DrawContext'
import { useToolbarContext } from '../../context/ToolbarContext'
import PresenterNote from '../realtime/PresenterNote'
import FreeForm from './FreeForm/FreeForm'
import SavedAnnotationList from './Saved/SavedAnnotationList'
import './AnnotationsPanel.css'

type AnnotationsTab = 'free-form' | 'saved'

function AnnotationsPanel() {
  const { annotations, setSelectedAnnotationId } = useAnnotationStoreContext()
  const { canEdit } = useCollectionContext()
  // In the toolbar's context so Present can follow the host's tab.
  const { panelTabs, setPanelTab } = useToolbarContext()
  const tab = (panelTabs.annotations ?? 'free-form') as AnnotationsTab
  const setTab = (next: AnnotationsTab) => setPanelTab('annotations', next)
  const { pending } = useDrawContext()

  const shownTab = canEdit ? tab : 'saved'

  return (
    <div className="annotations-panel">
      <div className="annotations-panel-tabs">
        {canEdit && <button
          type="button"
          className={`annotations-panel-tab${shownTab === 'free-form' ? ' annotations-panel-tab--active' : ''}`}
          onClick={() => {
            // Selection is shared context state (so the map can pan to it),
            // not local to the list - leaving Saved should still drop it, or
            // coming back later reopens straight into whatever was last edited.
            setSelectedAnnotationId(null)
            setTab('free-form')
          }}
        >
          Free Form
        </button>}
        <button
          type="button"
          className={`annotations-panel-tab${shownTab === 'saved' ? ' annotations-panel-tab--active' : ''}`}
          disabled={!!pending}
          onClick={() => setTab('saved')}
        >
          Saved{annotations.length > 0 ? ` (${annotations.length})` : ''}
        </button>
      </div>

      <div className="annotations-panel-content themed-scroll">
        <PresenterNote panel="annotations" />
        {shownTab === 'free-form' ? <FreeForm /> : <SavedAnnotationList />}
      </div>
    </div>
  )
}

export default AnnotationsPanel
