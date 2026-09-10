import { useState } from 'react'
import { useAnnotationStoreContext } from '../../context/AnnotationStoreContext'
import FreeForm from './FreeForm/FreeForm'
import SavedAnnotationList from './Saved/SavedAnnotationList'
import './AnnotationsPanel.css'

type AnnotationsTab = 'free-form' | 'saved'

function AnnotationsPanel() {
  const [tab, setTab] = useState<AnnotationsTab>('free-form')
  const { annotations } = useAnnotationStoreContext()

  return (
    <div className="annotations-panel">
      <div className="annotations-panel-tabs">
        <button
          type="button"
          className={`annotations-panel-tab${tab === 'free-form' ? ' annotations-panel-tab--active' : ''}`}
          onClick={() => setTab('free-form')}
        >
          Free Form
        </button>
        <button
          type="button"
          className={`annotations-panel-tab${tab === 'saved' ? ' annotations-panel-tab--active' : ''}`}
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
