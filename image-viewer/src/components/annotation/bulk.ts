import { newId } from '../../newId'

// annotation-store takes at most this many ids per bulk request (MaxBulkIds
// in Annotations/AnnotationGroupEndpoints.cs). Anything bigger is a 400 and
// nothing changes, so bigger selections go in batches of this size.
const MAX_BULK_IDS = 20_000

function inBatches<T>(items: T[], size = MAX_BULK_IDS): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

// Every batch of one change goes with the same id, so annotation-store keeps
// it as one change set - a 21k delete is one thing to put back, not two. See
// annotation-store's History/.
const CHANGE_SET_HEADER = 'Change-Set-Id'

function newChangeSet(): string {
  return newId()
}

function changeSetHeaders(changeSet: string): Record<string, string> {
  return { 'Content-Type': 'application/json', [CHANGE_SET_HEADER]: changeSet }
}

// Puts back everything the change set deleted, for everyone.
function restorePath(changeSet: string): string {
  return `/changesets/${encodeURIComponent(changeSet)}/restore`
}

interface OneChangeDelete {
  // Settles once every batch has been answered - rejects if any was turned down.
  deleted: Promise<void>
  // Restores it, after the delete's in - otherwise the restore could get
  // there first and find nothing to put back. Only runs once, however often
  // it's called. Rejects if the restore was turned down.
  undo: () => Promise<void>
}

// A bulk delete as one change set, in batches, and its undo. The requests
// are passed in so this doesn't need a store to test against.
function deleteAsOneChange(
  ids: string[],
  sendBatch: (batch: string[], headers: Record<string, string>) => Promise<Response>,
  restore: (path: string) => Promise<Response>
): OneChangeDelete {
  const changeSet = newChangeSet()
  const deleted = Promise.all(
    inBatches(ids).map((batch) =>
      sendBatch(batch, changeSetHeaders(changeSet)).then((response) => {
        if (!response.ok) throw new Error(String(response.status))
      })
    )
  ).then(() => {})
  let undoing: Promise<void> | null = null
  const undo = () =>
    (undoing ??= deleted
      .catch(() => {})
      .then(() => restore(restorePath(changeSet)))
      .then((response) => {
        // 404 is no such change set - every batch was turned down, so
        // nothing was deleted and there's nothing to restore.
        if (!response.ok && response.status !== 404) throw new Error(String(response.status))
      }))
  return { deleted, undo }
}

export { MAX_BULK_IDS, CHANGE_SET_HEADER, inBatches, newChangeSet, changeSetHeaders, restorePath, deleteAsOneChange }
