import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AnnotationGroup } from '../interfaces/AnnotationGroup'
import { useAuthContext } from './AuthContext'
import { useCollectionContext } from './CollectionContext'
import { useEmitEvent } from './EventContext'
import { useRealtimeContext } from './RealtimeContext'
import { useAnnotationStoreContext } from './AnnotationStoreContext'
import { changeSetHeaders, inBatches, jsonHeaders, newChangeSet } from '../components/annotation/bulk'
import { useToastContext } from './ToastContext'
import { conflictMessage, oneAtATime, readConflict } from '../components/realtime/editPolicy'

interface AnnotationGroupContextValue {
  // The active collection's groups, by name.
  groups: AnnotationGroup[]
  // Groups whose annotations are left off the map. Your own - not shared,
  // and only while the Select tab's open, where they're shown and hidden.
  hiddenGroupIds: Set<string>
  toggleHidden: (groupId: string) => void
  showAll: () => void
  // These reject if annotation-store says no. createGroup puts annotationIds
  // straight into it.
  createGroup: (name: string, annotationIds: string[]) => Promise<AnnotationGroup>
  // Name, notes, or both.
  // changeSet keeps every save of the notes as one change - see GroupPage.
  updateGroup: (groupId: string, patch: Partial<Pick<AnnotationGroup, 'name' | 'notes'>>, changeSet?: string) => Promise<void>
  // Everything in fromId moves into intoId, and fromId goes. Notes are joined.
  mergeGroup: (fromId: string, intoId: string) => Promise<void>
  // Ungroups what was in it - the annotations stay.
  deleteGroup: (groupId: string) => Promise<void>
  // Already saved, by a GeoJSON import - shown, and sent to everyone else.
  addImported: (groups: AnnotationGroup[]) => void
  // Put back by a restore - shown again, here only. Whoever restored them
  // tells everyone else.
  addRestored: (groups: AnnotationGroup[]) => void
}

const AnnotationGroupContext = createContext<AnnotationGroupContextValue | null>(null)

const byName = (a: AnnotationGroup, b: AnnotationGroup) => a.name.localeCompare(b.name)

function AnnotationGroupContextProvider({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const { authFetch } = useAuthContext()
  const { collectionId } = useCollectionContext()
  const { sendOp, onOp } = useRealtimeContext()
  const { annotations, markGrouped, forgetGroup } = useAnnotationStoreContext()
  const emit = useEmitEvent()
  const [groups, setGroups] = useState<AnnotationGroup[]>([])
  const [hiddenGroupIds, setHiddenGroupIds] = useState<Set<string>>(new Set())
  const { addToast } = useToastContext()
  // Groups here only change once annotation-store has them, so they're what
  // it has - what a save says it started from. Read when the save goes,
  // which is after this render. Saves to one group go one at a time, so
  // notes typed in bursts never conflict with each other.
  const groupsRef = useRef(groups)
  useEffect(() => {
    groupsRef.current = groups
  })
  const queueRef = useRef(oneAtATime())

  useEffect(() => {
    let cancelled = false
    setGroups([])
    setHiddenGroupIds(new Set())
    if (collectionId === null) return
    authFetch(`${baseUrl}/annotationgroups?collectionId=${encodeURIComponent(collectionId)}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<AnnotationGroup[]>
      })
      .then((loaded) => {
        if (!cancelled) setGroups(loaded)
      })
      .catch(() => {
        // Groups just don't show - the annotations themselves still load.
      })
    return () => {
      cancelled = true
    }
  }, [authFetch, baseUrl, collectionId])

  // Someone else's change to a group, already saved by them.
  useEffect(
    () =>
      onOp(({ op }) => {
        if (op.entity !== 'annotationGroup') return
        if (op.kind === 'delete') forgetGroup(op.id)
        setGroups((current) => {
          if (op.kind === 'delete') return current.filter((g) => g.id !== op.id)
          if (op.kind === 'create')
            return current.some((g) => g.id === op.id) ? current : [...current, op.data as AnnotationGroup].sort(byName)
          return current.map((g) => (g.id === op.id ? { ...g, ...(op.data as Partial<AnnotationGroup>) } : g)).sort(byName)
        })
      }),
    [onOp, forgetGroup]
  )

  const send = useCallback(
    // changeSet puts several requests in one change set - see bulk.ts.
    async (path: string, method: string, body?: unknown, changeSet?: string) => {
      const response = await authFetch(`${baseUrl}${path}`, {
        method,
        headers: changeSet ? changeSetHeaders(changeSet) : body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(String(response.status))
      return response
    },
    [authFetch, baseUrl]
  )

  const createGroup = async (name: string, annotationIds: string[]) => {
    if (collectionId === null) throw new Error('No collection')
    const [first = [], ...rest] = inBatches(annotationIds)
    const changeSet = newChangeSet()
    const response = await send('/annotationgroups', 'POST', { collectionId, name, annotationIds: first }, changeSet)
    const { count: _count, ...group } = (await response.json()) as AnnotationGroup & { count: number }
    group.notes ??= ''
    setGroups((current) => [...current, group].sort(byName))
    sendOp({ kind: 'create', entity: 'annotationGroup', id: group.id, data: group })
    markGrouped(first, group.id)
    // The group's made by now, so a batch that fails after this still
    // leaves it listed with whatever got in.
    await Promise.all(
      rest.map(async (ids) => {
        await send('/annotations/bulk', 'PUT', { collectionId, ids, setGroup: true, groupId: group.id }, changeSet)
        markGrouped(ids, group.id)
      })
    )
    return group
  }

  // Name and notes go with what they were, so in a first change wins session
  // a save over someone else's change is turned down (see editPolicy.ts) -
  // theirs is shown, and "Use mine" saves ours again over it.
  const updateGroup = (groupId: string, patch: Partial<Pick<AnnotationGroup, 'name' | 'notes'>>, changeSet?: string): Promise<void> =>
    queueRef.current(groupId, async () => {
      const tidy = patch.name === undefined ? patch : { ...patch, name: patch.name.trim() }
      const was = groupsRef.current.find((g) => g.id === groupId)
      const response = await authFetch(`${baseUrl}/annotationgroups/${groupId}`, {
        method: 'PUT',
        headers: jsonHeaders(changeSet),
        body: JSON.stringify({
          ...tidy,
          wasName: tidy.name !== undefined ? was?.name : undefined,
          wasNotes: tidy.notes !== undefined ? was?.notes : undefined,
        }),
      })
      if (response.status === 409) {
        const conflict = readConflict(await response.json())
        if (!conflict) throw new Error('409')
        const theirs = conflict.current as Partial<AnnotationGroup>
        setGroups((current) =>
          current.map((g) => (g.id === groupId ? { ...g, name: theirs.name ?? g.name, notes: theirs.notes ?? g.notes } : g)).sort(byName)
        )
        addToast(conflictMessage(conflict, theirs.name ?? 'this group'), 'error', {
          duration: null,
          actions: [
            { label: 'Use mine', primary: true, onClick: () => void updateGroup(groupId, tidy, changeSet).catch(() => emit('annotationgroup:error')) },
            { label: 'Keep theirs', onClick: () => {} },
          ],
        })
        return
      }
      if (!response.ok) throw new Error(String(response.status))
      // Not changing a field leaves what's stored - someone else's, if they
      // got there first - so what goes out is what was saved.
      const saved = (await response.json()) as AnnotationGroup
      const data = {
        ...(tidy.name !== undefined ? { name: saved.name } : {}),
        ...(tidy.notes !== undefined ? { notes: saved.notes } : {}),
      }
      setGroups((current) => current.map((g) => (g.id === groupId ? { ...g, ...data } : g)).sort(byName))
      sendOp({ kind: 'update', entity: 'annotationGroup', id: groupId, data })
    })

  // The moves go out before the delete, so nobody ungroups them first.
  const mergeGroup = async (fromId: string, intoId: string) => {
    const response = await send(`/annotationgroups/${fromId}/merge`, 'POST', { intoId })
    const { notes } = (await response.json()) as AnnotationGroup
    markGrouped(
      annotations.filter((a) => a.groupId === fromId).map((a) => a.id),
      intoId
    )
    setGroups((current) => current.filter((g) => g.id !== fromId).map((g) => (g.id === intoId ? { ...g, notes } : g)))
    sendOp({ kind: 'update', entity: 'annotationGroup', id: intoId, data: { notes } })
    sendOp({ kind: 'delete', entity: 'annotationGroup', id: fromId })
  }

  const deleteGroup = async (groupId: string) => {
    await send(`/annotationgroups/${groupId}`, 'DELETE')
    setGroups((current) => current.filter((g) => g.id !== groupId))
    forgetGroup(groupId)
    sendOp({ kind: 'delete', entity: 'annotationGroup', id: groupId })
  }

  const addImported = (imported: AnnotationGroup[]) => {
    const fresh = imported.filter((g) => !groups.some((known) => known.id === g.id))
    if (fresh.length === 0) return
    setGroups((current) => [...current, ...fresh.filter((g) => !current.some((c) => c.id === g.id))].sort(byName))
    for (const group of fresh) sendOp({ kind: 'create', entity: 'annotationGroup', id: group.id, data: group })
  }

  const addRestored = (restored: AnnotationGroup[]) => {
    if (restored.length === 0) return
    // The store sends a member count too - not kept, same as a made one.
    const tidy = restored.map(({ id, collectionId, name, notes, created }) => ({ id, collectionId, name, notes: notes ?? '', created }))
    setGroups((current) => [...current, ...tidy.filter((g) => !current.some((c) => c.id === g.id))].sort(byName))
  }

  const showAll = useCallback(() => setHiddenGroupIds((current) => (current.size === 0 ? current : new Set())), [])

  const toggleHidden = (groupId: string) =>
    setHiddenGroupIds((current) => {
      const next = new Set(current)
      if (!next.delete(groupId)) next.add(groupId)
      return next
    })

  return (
    <AnnotationGroupContext.Provider
      value={{
        groups,
        hiddenGroupIds,
        toggleHidden,
        showAll,
        addImported,
        addRestored,
        createGroup: (name, ids) =>
          createGroup(name, ids).catch((error: unknown) => {
            emit('annotationgroup:error')
            throw error
          }),
        updateGroup: (id, patch, changeSet) =>
          updateGroup(id, patch, changeSet).catch((error: unknown) => {
            emit('annotationgroup:error')
            throw error
          }),
        mergeGroup: (fromId, intoId) =>
          mergeGroup(fromId, intoId).catch((error: unknown) => {
            emit('annotationgroup:error')
            throw error
          }),
        deleteGroup: (id) =>
          deleteGroup(id).catch((error: unknown) => {
            emit('annotationgroup:error')
            throw error
          }),
      }}
    >
      {children}
    </AnnotationGroupContext.Provider>
  )
}

function useAnnotationGroupContext(): AnnotationGroupContextValue {
  const context = useContext(AnnotationGroupContext)
  if (!context) {
    throw new Error('useAnnotationGroupContext must be used within an AnnotationGroupContextProvider')
  }
  return context
}

export { AnnotationGroupContextProvider, useAnnotationGroupContext }
