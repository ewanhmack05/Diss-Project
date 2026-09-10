import { useState } from 'react'
import { useAnnotationStoreContext } from '../../context/AnnotationStoreContext'
import { useDrawContext } from '../../context/DrawContext'
import FreeForm from './FreeForm/FreeForm'
import SavedAnnotationList from './Saved/SavedAnnotationList'
import './AnnotationsPanel.css'

type AnnotationsTab = 'free-form' | 'saved'

function AnnotationsPanel() {
  const [tab, setTab] = useState<AnnotationsTab>('free-form')
  const { annotations, setSelectedAnnotationId } = useAnnotationStoreContext()
  const { pending } = useDrawContext()

  return (
    <div className="annotations-panel">
      <div className="annotations-panel-tabs">
        <button
          type="button"
          className={`annotations-panel-tab${tab === 'free-form' ? ' annotations-panel-tab--active' : ''}`}
          onClick={() => {
            // Selection is shared context state (so the map can pan to it),
            // not local to the list - leaving Saved should still drop it, or
            // coming back later reopens straight into whatever was last edited.
            setSelectedAnnotationId(null)
            setTab('free-form')
          }}
        >
          Free Form
        </button>
        <button
          type="button"
          className={`annotations-panel-tab${tab === 'saved' ? ' annotations-panel-tab--active' : ''}`}
          disabled={!!pending}
          onClick={() => setTab('saved')}
        >
          Saved{annotations.length > 0 ? ` (${annotations.length})` : ''}
        </button>
      </div>

      <div className="annotations-panel-content">
        {tab === 'free-form' ? <FreeForm /> : <SavedAnnotationList />}
      </div>
    </div>
  )
}

export default AnnotationsPanel
