import { useEffect, useRef } from 'react'
import { useAuthContext } from '../../../context/AuthContext'
import { useCollectionContext } from '../../../context/CollectionContext'
import { useAnnotationStoreContext } from '../../../context/AnnotationStoreContext'
import { useCellCountStoreContext } from '../../../context/CellCountStoreContext'
import { useRealtimeContext } from '../../../context/RealtimeContext'
import { useToastContext } from '../../../context/ToastContext'
import { restoredOps, type Restored } from './history'
import { goBackPath, nameAfter, wentBackMessage, type Item } from './itemVersions'

// name is what it's called once it's gone back.
type WentBack = { status: 'done'; name: string | null } | { status: 'changed' } | { status: 'failed' }

// Puts one row back to a point on its timeline, for everyone: annotation-store
// does it, the row it answers with goes in the map and the Saved lists here,
// and everyone else gets an op. 'changed' means someone's changed it since you
// opened it, so nothing happened and the timeline wants loading again.
function useGoBackItem(): (item: Item, version: number, latest: number | null) => Promise<WentBack> {
  const { authFetch } = useAuthContext()
  const { collectionId } = useCollectionContext()
  const annotationStore = useAnnotationStoreContext()
  const cellCountStore = useCellCountStoreContext()
  const { sendOp } = useRealtimeContext()
  const { addToast } = useToastContext()
  // Moving to another collection while it's on its way mustn't put its row
  // in that one's lists.
  const collectionIdRef = useRef(collectionId)
  useEffect(() => {
    collectionIdRef.current = collectionId
  }, [collectionId])

  return async (item, version, latest) => {
    const askedIn = collectionIdRef.current
    let restored: Restored
    try {
      const response = await authFetch(`${annotationStore.baseUrl}${goBackPath(item, version, latest)}`, { method: 'POST' })
      if (response.status === 409) {
        addToast("It's changed since you opened it - have another look", 'info')
        return { status: 'changed' }
      }
      if (!response.ok) throw new Error(String(response.status))
      restored = (await response.json()) as Restored
    } catch {
      addToast("Couldn't put that back - try again", 'error')
      return { status: 'failed' }
    }

    if (collectionIdRef.current === askedIn) {
      annotationStore.addRestored([...restored.annotations, ...restored.changedAnnotations])
      cellCountStore.addRestored([...restored.cellCounts, ...(restored.changedCellCounts ?? [])])
      for (const op of restoredOps(restored)) sendOp(op)
    }
    addToast(wentBackMessage(item.entity, item.name, restored), 'success')
    return { status: 'done', name: nameAfter(item.name, restored) }
  }
}

export default useGoBackItem
