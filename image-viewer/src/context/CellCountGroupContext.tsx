import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { jsonHeaders } from '../components/annotation/bulk'
import { bulkConflictMessage, conflictMessage, oneAtATime, readConflict } from '../components/realtime/editPolicy'
import { isRollbackOp } from '../components/realtime/realtime'
import type { CellCountGroup } from '../interfaces/CellCountGroup'
import { useAuthContext } from './AuthContext'
import { useCellCountStoreContext } from './CellCountStoreContext'
import { useCollectionContext } from './CollectionContext'
import { useEmitEvent } from './EventContext'
import { useRealtimeContext } from './RealtimeContext'
import { useToastContext } from './ToastContext'

interface CellCountGroupContextValue {
  // The active collection's groups, by name.
  groups: CellCountGroup[]
  // These reject if annotation-store says no. createGroup puts cellCountIds
  // straight into it.
  createGroup: (name: string, cellCountIds?: string[]) => Promise<CellCountGroup>
  updateGroup: (groupId: string, patch: Partial<Pick<CellCountGroup, 'name' | 'notes'>>) => Promise<void>
  // Everything in fromId moves into intoId, and fromId goes. Notes are joined.
  mergeGroup: (fromId: string, intoId: string) => Promise<void>
  // Ungroups what was in it - the counts stay.
  deleteGroup: (groupId: string) => Promise<void>
  // Into a group, or out of any with null.
  moveToGroup: (cellCountIds: string[], groupId: string | null) => Promise<void>
  // Already saved by an import - shown, and sent to everyone else.
  addImported: (groups: Omit<CellCountGroup, 'count'>[]) => void
  // Put back by a restore - shown again, here only. Whoever restored them
  // tells everyone else.
  addRestored: (groups: CellCountGroup[]) => void
  reload: () => void
}

const CellCountGroupContext = createContext<CellCountGroupContextValue | null>(null)

const byName = (a: CellCountGroup, b: CellCountGroup) => a.name.localeCompare(b.name)

// The same as AnnotationGroupContext, for cell counts. Counts aren't all loaded
// the way annotations are, so how many are in each comes from the store, and
// it's asked again whenever that may have changed.
function CellCountGroupContextProvider({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const { authFetch } = useAuthContext()
  const { collectionId } = useCollectionContext()
  const { sendOp, onOp } = useRealtimeContext()
  const { cellCounts, revision, markGrouped, forgetGroup, theirGroups } = useCellCountStoreContext()
  const emit = useEmitEvent()
  const { addToast } = useToastContext()
  const [groups, setGroups] = useState<CellCountGroup[]>([])
  // What a save says it started from, read when the save goes. Saves to one group
  // go one at a time, so they never conflict with each other.
  const groupsRef = useRef(groups)
  useEffect(() => {
    groupsRef.current = groups
  })
  const queueRef = useRef(oneAtATime())
  const [reloads, setReloads] = useState(0)
  const reload = useCallback(() => setReloads((current) => current + 1), [])

  useEffect(() => {
    let cancelled = false
    if (collectionId === null) {
      setGroups([])
      return
    }
    authFetch(`${baseUrl}/cellcountgroups?collectionId=${encodeURIComponent(collectionId)}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<CellCountGroup[]>
      })
      .then((loaded) => {
        if (!cancelled) setGroups(loaded)
      })
      .catch(() => {
        // Groups just don't show - the counts themselves still load.
      })
    return () => {
      cancelled = true
    }
  }, [authFetch, baseUrl, collectionId, reloads, revision])

  // Someone else's change, already saved by them. Asked for again rather than
  // worked out, since what's in each may have changed too.
  useEffect(
    () =>
      onOp(({ op }) => {
        if (isRollbackOp(op)) reload()
        if (op.entity !== 'cellCountGroup') return
        if (op.kind === 'delete') forgetGroup(op.id, (op.data as { mergedInto?: string } | undefined)?.mergedInto ?? null)
        reload()
      }),
    [onOp, forgetGroup, reload]
  )

  const send = useCallback(
    async (path: string, method: string, body?: unknown) => {
      const response = await authFetch(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : jsonHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(String(response.status))
      return response
    },
    [authFetch, baseUrl]
  )

  const reported = <T,>(action: Promise<T>): Promise<T> =>
    action.catch((error: unknown) => {
      emit('cellcountgroup:error')
      throw error
    })

  const createGroup = async (name: string, cellCountIds: string[] = []) => {
    if (collectionId === null) throw new Error('No collection')
    const response = await send('/cellcountgroups', 'POST', { collectionId, name, cellCountIds })
    const group = (await response.json()) as CellCountGroup
    setGroups((current) => [...current, group].sort(byName))
    markGrouped(cellCountIds, group.id)
    sendOp({ kind: 'create', entity: 'cellCountGroup', id: group.id, data: group })
    return group
  }

  // Name and notes go with what they were, so in a first change wins session a
  // save over someone else's change is turned down - theirs is shown, and "Use
  // mine" saves ours again over it.
  const updateGroup = (groupId: string, patch: Partial<Pick<CellCountGroup, 'name' | 'notes'>>): Promise<void> =>
    queueRef.current(groupId, async () => {
      const was = groupsRef.current.find((g) => g.id === groupId)
      const response = await authFetch(`${baseUrl}/cellcountgroups/${groupId}`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({
          ...patch,
          wasName: patch.name !== undefined ? was?.name : undefined,
          wasNotes: patch.notes !== undefined ? was?.notes : undefined,
        }),
      })
      if (response.status === 409) {
        const conflict = readConflict(await response.json())
        if (!conflict) throw new Error('409')
        const theirs = conflict.current as Partial<CellCountGroup>
        setGroups((current) => current.map((g) => (g.id === groupId ? { ...g, ...theirs } : g)).sort(byName))
        addToast(conflictMessage(conflict, theirs.name ?? 'this group'), 'error', {
          duration: null,
          actions: [
            { label: 'Use mine', primary: true, onClick: () => void updateGroup(groupId, patch).catch(() => emit('cellcountgroup:error')) },
            { label: 'Keep theirs', onClick: () => {} },
          ],
        })
        return
      }
      if (!response.ok) throw new Error(String(response.status))
      const saved = (await response.json()) as CellCountGroup
      setGroups((current) => current.map((g) => (g.id === groupId ? saved : g)).sort(byName))
      sendOp({ kind: 'update', entity: 'cellCountGroup', id: groupId, data: saved })
    })

  // The delete says where they went, so nobody ungroups them.
  const mergeGroup = async (fromId: string, intoId: string) => {
    const response = await send(`/cellcountgroups/${fromId}/merge`, 'POST', { intoId })
    const saved = (await response.json()) as CellCountGroup
    setGroups((current) => current.filter((g) => g.id !== fromId).map((g) => (g.id === intoId ? saved : g)))
    forgetGroup(fromId, intoId)
    sendOp({ kind: 'update', entity: 'cellCountGroup', id: intoId, data: saved })
    sendOp({ kind: 'delete', entity: 'cellCountGroup', id: fromId, data: { mergedInto: intoId } })
  }

  const deleteGroup = async (groupId: string) => {
    await send(`/cellcountgroups/${groupId}`, 'DELETE')
    setGroups((current) => current.filter((g) => g.id !== groupId))
    forgetGroup(groupId)
    sendOp({ kind: 'delete', entity: 'cellCountGroup', id: groupId })
  }

  const moveToGroup = async (cellCountIds: string[], groupId: string | null) => {
    if (collectionId === null) throw new Error('No collection')
    // Each one's group as it's known here. One not loaded isn't checked.
    const wasGroups = Object.fromEntries(
      cellCounts.filter((c) => cellCountIds.includes(c.id)).map((c) => [c.id, c.groupId ?? null])
    )
    const response = await send('/cellcounts/group', 'PUT', { collectionId, ids: cellCountIds, groupId, wasGroups })
    const { conflicts } = (await response.json()) as { conflicts?: { id: string; groupId: string | null; changedBy: string | null }[] | null }
    const left = new Set((conflicts ?? []).map((c) => c.id))
    markGrouped(cellCountIds.filter((id) => !left.has(id)), groupId)
    if (conflicts && conflicts.length > 0) {
      theirGroups(conflicts)
      addToast(bulkConflictMessage(conflicts, cellCountIds.length), 'error')
      reload()
    }
    // Tells everyone else what's in each has changed.
    for (const group of groups.filter((g) => g.id === groupId)) sendOp({ kind: 'update', entity: 'cellCountGroup', id: group.id, data: group })
    if (groupId === null) reload()
  }

  const addImported = (imported: Omit<CellCountGroup, 'count'>[]) => {
    if (imported.length === 0) return
    for (const group of imported) sendOp({ kind: 'create', entity: 'cellCountGroup', id: group.id, data: group })
    reload()
  }

  const addRestored = (restored: CellCountGroup[]) => {
    if (restored.length === 0) return
    setGroups((current) => [...current, ...restored.filter((g) => !current.some((c) => c.id === g.id))].sort(byName))
  }

  return (
    <CellCountGroupContext.Provider
      value={{
        groups,
        createGroup: (name, ids) => reported(createGroup(name, ids)),
        updateGroup: (id, patch) => reported(updateGroup(id, patch)),
        mergeGroup: (fromId, intoId) => reported(mergeGroup(fromId, intoId)),
        deleteGroup: (id) => reported(deleteGroup(id)),
        moveToGroup: (ids, groupId) => reported(moveToGroup(ids, groupId)),
        addImported,
        addRestored,
        reload,
      }}
    >
      {children}
    </CellCountGroupContext.Provider>
  )
}

function useCellCountGroupContext(): CellCountGroupContextValue {
  const context = useContext(CellCountGroupContext)
  if (!context) {
    throw new Error('useCellCountGroupContext must be used within a CellCountGroupContextProvider')
  }
  return context
}

export { CellCountGroupContextProvider, useCellCountGroupContext }
