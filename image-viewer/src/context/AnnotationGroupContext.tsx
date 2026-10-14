import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AnnotationGroup } from '../interfaces/AnnotationGroup'
import { useAuthContext } from './AuthContext'
import { useCollectionContext } from './CollectionContext'
import { useEmitEvent } from './EventContext'
import { useRealtimeContext } from './RealtimeContext'
import { useAnnotationStoreContext } from './AnnotationStoreContext'

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
  updateGroup: (groupId: string, patch: Partial<Pick<AnnotationGroup, 'name' | 'notes'>>) => Promise<void>
  // Everything in fromId moves into intoId, and fromId goes. Notes are joined.
  mergeGroup: (fromId: string, intoId: string) => Promise<void>
  // Ungroups what was in it - the annotations stay.
  deleteGroup: (groupId: string) => Promise<void>
  // Already saved, by a GeoJSON import - shown, and sent to everyone else.
  addImported: (groups: AnnotationGroup[]) => void
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
    async (path: string, method: string, body?: unknown) => {
      const response = await authFetch(`${baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (!response.ok) throw new Error(String(response.status))
      return response
    },
    [authFetch, baseUrl]
  )

  const createGroup = async (name: string, annotationIds: string[]) => {
    if (collectionId === null) throw new Error('No collection')
    const response = await send('/annotationgroups', 'POST', { collectionId, name, annotationIds })
    const { count: _count, ...group } = (await response.json()) as AnnotationGroup & { count: number }
    group.notes ??= ''
    setGroups((current) => [...current, group].sort(byName))
    sendOp({ kind: 'create', entity: 'annotationGroup', id: group.id, data: group })
    markGrouped(annotationIds, group.id)
    return group
  }

  const updateGroup = async (groupId: string, patch: Partial<Pick<AnnotationGroup, 'name' | 'notes'>>) => {
    const tidy = patch.name === undefined ? patch : { ...patch, name: patch.name.trim() }
    await send(`/annotationgroups/${groupId}`, 'PUT', tidy)
    setGroups((current) => current.map((g) => (g.id === groupId ? { ...g, ...tidy } : g)).sort(byName))
    sendOp({ kind: 'update', entity: 'annotationGroup', id: groupId, data: tidy })
  }

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
        createGroup: (name, ids) =>
          createGroup(name, ids).catch((error: unknown) => {
            emit('annotationgroup:error')
            throw error
          }),
        updateGroup: (id, patch) =>
          updateGroup(id, patch).catch((error: unknown) => {
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
