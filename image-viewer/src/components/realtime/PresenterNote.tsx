import { useCollectionContext } from '../../context/CollectionContext'
import { useNavigationContext } from '../../context/NavigationContext'
import { useAnnotationStoreContext } from '../../context/AnnotationStoreContext'
import { useCellCountStoreContext } from '../../context/CellCountStoreContext'
import type { ToolId } from '../../context/ToolbarContext'
import { sketchFor } from './realtime'
import './PresenterNote.css'

// First tab of each panel - what it's on when the host hasn't picked one.
const FIRST_TAB: Partial<Record<ToolId, string>> = { annotations: 'free-form', cellcount: 'new' }

// View-only watchers only get the Saved tab, so while the host presents
// from a tab they can't open - drawing, counting, editing - this says what
// the host is doing instead.
function PresenterNote({ panel }: { panel: 'annotations' | 'cellcount' }) {
  const { canEdit } = useCollectionContext()
  const { leader, hostScreen } = useNavigationContext()
  const { annotations } = useAnnotationStoreContext()
  const { cellCounts } = useCellCountStoreContext()

  if (canEdit || !leader || !hostScreen || !hostScreen.panels.includes(panel)) return null
  const name = leader.displayName
  const tab = hostScreen.tabs[panel] ?? FIRST_TAB[panel]

  let text: string | null = null
  if (panel === 'annotations') {
    const editing = hostScreen.editingAnnotationId && annotations.find((a) => a.id === hostScreen.editingAnnotationId)
    if (tab === 'free-form') {
      text =
        sketchFor(leader, 'annotation')
          ? `${name} is drawing - follow along on the map.`
          : `${name} is on Free Form - anything they draw shows on your map.`
    } else if (editing) {
      text = `${name} is editing ${editing.label || 'an annotation'} - you'll see the changes once they save.`
    }
  } else {
    const editing = hostScreen.editingCellCountId && cellCounts.find((c) => c.id === hostScreen.editingCellCountId)
    const counting = sketchFor(leader, 'cellCount')
    if (tab === 'new') {
      text = counting
        ? `${name} is counting - ${counting.data.count} so far. Follow along on the map.`
        : `${name} is setting up a count - it shows on your map once they start.`
    } else if (editing) {
      text = `${name} is editing ${editing.label || 'a count'} - you'll see the changes once they save.`
    }
  }

  if (!text) return null
  return (
    <p className="presenter-note" style={{ borderLeftColor: leader.colour }}>
      {text}
    </p>
  )
}

export default PresenterNote
