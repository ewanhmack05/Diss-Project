import { useEffect, useRef } from 'react'
import { useAuthContext } from '../../../context/AuthContext'
import { useCollectionContext } from '../../../context/CollectionContext'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import { useCellCountStoreContext } from '../../../context/CellCountStoreContext'
import { useAnnotationGroupContext } from '../../../context/AnnotationGroupContext'
import { useAdjustmentsContext } from '../../../context/AdjustmentsContext'
import { useRealtimeContext } from '../../../context/RealtimeContext'
import { useEmitEvent } from '../../../context/EventContext'
import { useToastContext } from '../../../context/ToastContext'
import { restorePath } from '../../annotation/bulk'
import { restoredMessage, restoredOps, type ChangeSet, type Restored } from './history'

// Puts back what a change set deleted, for everyone: annotation-store
// restores it, the rows it answers with go back on the map and in the
// Saved lists here, and everyone else gets a create per row. Resolves once
// it's done, toast and all - rejects if annotation-store said no.
function useRestoreChangeSet(): (changeSet: ChangeSet) => Promise<void> {
  const { authFetch } = useAuthContext()
  const { collectionId, refresh } = useCollectionContext()
  const annotationStore = useAnnotationStoreContext()
  const cellCountStore = useCellCountStoreContext()
  const groups = useAnnotationGroupContext()
  const adjustments = useAdjustmentsContext()
  const { sendOp } = useRealtimeContext()
  const emit = useEmitEvent()
  const { addToast } = useToastContext()
  // Moving to another collection while it's on its way mustn't put its
  // rows in that one's lists.
  const collectionIdRef = useRef(collectionId)
  useEffect(() => {
    collectionIdRef.current = collectionId
  }, [collectionId])

  return async (changeSet: ChangeSet) => {
    let restored: Restored
    try {
      const response = await authFetch(`${annotationStore.baseUrl}${restorePath(changeSet.id)}`, { method: 'POST' })
      if (!response.ok) throw new Error(String(response.status))
      restored = (await response.json()) as Restored
    } catch (error) {
      emit('annotations:restored:error', { count: changeSet.deleted })
      throw error
    }

    if (collectionIdRef.current === changeSet.collectionId) {
      groups.addRestored(restored.groups)
      annotationStore.addRestored([...restored.annotations, ...(restored.changedAnnotations ?? [])])
      cellCountStore.addRestored(restored.cellCounts)
      adjustments.addRestored(restored.imageAdjustments)
      for (const op of restoredOps(restored)) sendOp(op)
    }
    if (restored.counts.collection) refresh()
    emit('changeset:restored', { id: changeSet.id, counts: restored.counts })
    addToast(restoredMessage(restored.counts), 'success')
  }
}

export default useRestoreChangeSet
