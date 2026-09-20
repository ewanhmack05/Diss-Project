// Reconciles a freshly polled server list against this tab's own unconfirmed
// writes. Without this, a poll landing between an optimistic local add/delete
// and its POST/DELETE resolving would clobber the add or resurrect the
// delete. `pendingCreateIds` is what this tab has added locally but not yet
// had its POST confirm; `pendingDeleteIds` is the same for DELETE.
function mergePolledItems<T extends { id: string }>(
  serverItems: T[],
  localItems: T[],
  pendingCreateIds: ReadonlySet<string>,
  pendingDeleteIds: ReadonlySet<string>
): T[] {
  const serverIds = new Set(serverItems.map((item) => item.id))
  const visibleServerItems = serverItems.filter((item) => !pendingDeleteIds.has(item.id))
  const unconfirmedLocalCreates = localItems.filter(
    (item) => pendingCreateIds.has(item.id) && !serverIds.has(item.id)
  )
  return [...visibleServerItems, ...unconfirmedLocalCreates]
}

export { mergePolledItems }
