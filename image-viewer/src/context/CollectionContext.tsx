import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useImageViewerContext } from './ImageViewerContext'
import { useEmitEvent } from './EventContext'
import { useAuthContext } from './AuthContext'
import { useDialogContext } from './DialogContext'
import { useToastContext } from './ToastContext'

type Status = 'loading' | 'ready' | 'error'

type CollectionRole = 'viewer' | 'editor' | 'owner'

// personal - made automatically, one per person per slide, only ever theirs.
// session - started to work with others, joined through invite links.
type CollectionKind = 'personal' | 'session'

interface CollectionMember {
  userId: string
  displayName: string
  role: CollectionRole
}

// As annotation-store gives it - see its Collections/CollectionEndpoints.cs.
interface Collection {
  collectionId: string
  slideId: string
  collectionName: string
  created: string
  ownerId: string
  kind: CollectionKind
  // Sessions only - once ended it's read-only and has no room.
  ended: string | null
  // Personal only - the owner letting anyone signed in look at it. Someone
  // else's shared one comes in the list too, with myRole viewer.
  shared: boolean
  myRole: CollectionRole
  members: CollectionMember[]
  // What's in it, from the list - for the Collections tab.
  annotationCount: number
  cellCountCount: number
  lastAdded: string | null
}

interface Invite {
  code: string
  role: CollectionRole
  created: string
  expires: string
}

// What an invite link is for, before joining. status is open, expired,
// stopped (the host stopped the link) or ended (the session is over).
interface InvitePreview {
  code: string
  collectionId: string
  slideId: string
  collectionName: string
  hostName: string
  role: CollectionRole
  expires: string
  status: 'open' | 'expired' | 'stopped' | 'ended'
  alreadyMember: boolean
  people: string[]
}

interface CollectionContextValue {
  // The one being worked in - where annotations and cell counts are read
  // from and saved to. Your own, unless you're in a session.
  collectionId: string | null
  // Always your own - image adjustments are personal, so they stay here.
  personalCollectionId: string | null
  status: Status
  // Every collection on this slide you're in: your own, then sessions.
  collections: Collection[]
  active: Collection | null
  // The active one when it's a session, ended or not.
  session: Collection | null
  // The session's room, when there is one - only while it hasn't ended.
  roomId: string | null
  canEdit: boolean
  // The active session was opened just to look at, because nobody was in
  // it - read-only, and no room. reopen() takes it live again.
  dormant: boolean
  refresh: () => Promise<void>
  // Moves into a collection you're in - rejoining a session, or opening an
  // ended one to look back at it.
  open: (collectionId: string, options?: { viewOnly?: boolean }) => void
  reopen: () => void
  // Back to your own collection. You stay in the session to rejoin later.
  leaveSession: () => void
  // These reject if annotation-store says no. endSession needs a refresh
  // after - see it below.
  // One per slide - with one already going, that's the one you go into.
  startSession: (name?: string) => Promise<void>
  renameSession: (name: string) => Promise<void>
  endSession: () => Promise<void>
  // Ends one you host that you're not in - an older one from before only one
  // was allowed. Nobody's in it, so there's no room to tell.
  endOther: (collectionId: string) => Promise<void>
  loadInvites: () => Promise<Invite[]>
  // Goes up whenever a new invite is made, so anything showing the working
  // one knows to load it again - the Users tab can make one too.
  inviteChanges: number
  createInvite: (role: CollectionRole, hours: number) => Promise<Invite>
  // Changes a working link in place - same code, new role and expiry.
  updateInvite: (code: string, role: CollectionRole, hours: number) => Promise<Invite>
  stopInvite: (code: string) => Promise<void>
  previewInvite: (code: string) => Promise<InvitePreview | null>
  acceptInvite: (code: string) => Promise<void>
  setMemberRole: (userId: string, role: CollectionRole) => Promise<void>
  removeMember: (userId: string) => Promise<void>
  // Your own collection - letting others look at it, and its name.
  setShared: (shared: boolean) => Promise<void>
  renameCollection: (collectionId: string, name: string) => Promise<void>
  // From the Collections tab, for any session you're in - not just the
  // active one. Leaving takes you out for good; deleting is host only.
  leaveForGood: (collectionId: string) => Promise<void>
  deleteSession: (collectionId: string) => Promise<void>
}

const CollectionContext = createContext<CollectionContextValue | null>(null)

interface CollectionContextProviderProps {
  baseUrl: string
  children: ReactNode
}

// Remembered per tab, so a reload stays in the same session - and still
// just looking, if that's how it was opened.
const activeKey = (slideId: string) => `active-collection:${slideId}`
const viewOnlyKey = (slideId: string) => `active-collection-view-only:${slideId}`

function readStoredActive(slideId: string): { id: string | null; viewOnly: boolean } {
  try {
    return { id: sessionStorage.getItem(activeKey(slideId)), viewOnly: sessionStorage.getItem(viewOnlyKey(slideId)) === '1' }
  } catch {
    return { id: null, viewOnly: false }
  }
}

function storeActive(slideId: string, id: string | null, viewOnly: boolean) {
  try {
    if (id) sessionStorage.setItem(activeKey(slideId), id)
    else sessionStorage.removeItem(activeKey(slideId))
    if (id && viewOnly) sessionStorage.setItem(viewOnlyKey(slideId), '1')
    else sessionStorage.removeItem(viewOnlyKey(slideId))
  } catch {
    // Just not remembered across a reload.
  }
}

function hostName(session: Collection): string {
  return session.members.find((m) => m.role === 'owner')?.displayName || 'The host'
}

function CollectionContextProvider({ baseUrl, children }: CollectionContextProviderProps) {
  const { source } = useImageViewerContext()
  const { slideId } = source
  const emit = useEmitEvent()
  const { authFetch, user } = useAuthContext()
  const { showDialog } = useDialogContext()
  const { addToast } = useToastContext()

  const [personalCollectionId, setPersonalCollectionId] = useState<string | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [viewOnly, setViewOnly] = useState(false)
  const [status, setStatus] = useState<Status>('loading')
  const [inviteChanges, setInviteChanges] = useState(0)
  const activeIdRef = useRef(activeId)
  const collectionsRef = useRef(collections)
  useEffect(() => {
    activeIdRef.current = activeId
    collectionsRef.current = collections
  })

  // Throws with the status code if annotation-store says no.
  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await authFetch(`${baseUrl}${path}`, init)
      if (!response.ok) throw new Error(String(response.status))
      return (response.status === 204 ? undefined : await response.json()) as T
    },
    [authFetch, baseUrl]
  )

  const send = useCallback(
    <T,>(path: string, method: string, body?: unknown) =>
      request<T>(path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    [request]
  )

  const setActive = useCallback(
    (id: string | null, lookOnly = false) => {
      // Straight away, not after the render, so a list load right after
      // this knows it's moved on.
      activeIdRef.current = id
      setActiveId(id)
      setViewOnly(!!id && lookOnly)
      storeActive(slideId, id, lookOnly)
    },
    [slideId]
  )

  const loadCollections = useCallback(async () => {
    const list = await request<Collection[]>(`/collections?slideId=${encodeURIComponent(slideId)}`)
    const before = collectionsRef.current.find((c) => c.collectionId === activeIdRef.current)
    const after = list.find((c) => c.collectionId === activeIdRef.current)
    if (before?.kind === 'session' && !before.ended && after?.ended && after.myRole !== 'owner') {
      emit('session:ended', { collectionId: after.collectionId })
      showDialog({
        title: `${after.collectionName} has ended`,
        message: `${hostName(after)} ended the session. It's read-only now - you can stay and look back at it, or go back to your own work.`,
        actions: [{ label: 'Back to my own work', onClick: () => setActive(null) }, { label: 'Stay and look' }],
      })
    }
    // The host changed what you can do.
    if (before?.kind === 'session' && after && !after.ended && before.myRole !== after.myRole && after.myRole !== 'owner') {
      emit('session:role-changed', { collectionId: after.collectionId, role: after.myRole })
      addToast(
        after.myRole === 'viewer'
          ? `${hostName(after)} changed you to view only - you can look, but not change anything`
          : `${hostName(after)} changed you to can edit - you can add and change things now`,
        'info'
      )
    }
    setCollections(list)
    // Taken out of the session you were in - back to your own.
    const current = activeIdRef.current
    if (current && !list.some((c) => c.collectionId === current)) {
      setActive(null)
      // Someone else's you were looking at, and they've stopped sharing it.
      if (before?.kind === 'personal') {
        emit('collection:unshared', { collectionId: current })
        showDialog({
          title: `${before.collectionName} isn't shared any more`,
          message: `${hostName(before)} stopped sharing it, so you're back in your own collection.`,
          actions: [{ label: 'OK' }],
        })
        return
      }
      emit('session:removed', { collectionId: current })
      showDialog({
        title: before ? `You've been removed from ${before.collectionName}` : "You're no longer in that session",
        message: `${before ? hostName(before) : 'The host'} took you out of the session. You're back working on your own - anything you added there stays with the session.`,
        actions: [{ label: 'OK' }],
      })
    }
  }, [request, slideId, emit, setActive, showDialog, addToast])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setPersonalCollectionId(null)
    setCollections([])
    const stored = readStoredActive(slideId)
    setActiveId(stored.id)
    setViewOnly(!!stored.id && stored.viewOnly)

    send<Collection>('/collections/ensure', 'POST', { slideId })
      .then(async (own) => {
        if (cancelled) return
        setPersonalCollectionId(own.collectionId)
        await loadCollections()
        if (!cancelled) setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error')
          emit('collection:load-error', { slideId })
        }
      })

    return () => {
      cancelled = true
    }
  }, [slideId, send, loadCollections, emit])

  const active =
    collections.find((c) => c.collectionId === activeId) ??
    collections.find((c) => c.collectionId === personalCollectionId) ??
    null
  const session = active?.kind === 'session' ? active : null
  const collectionId = status === 'ready' ? (active?.collectionId ?? personalCollectionId) : null
  const sessionId = session?.collectionId ?? null

  const startSession = useCallback(
    async (name?: string) => {
      // 409 is annotation-store handing back the one you've already got.
      const response = await authFetch(`${baseUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slideId, collectionName: name }),
      })
      if (!response.ok && response.status !== 409) throw new Error(String(response.status))
      const session = (await response.json()) as Collection
      await loadCollections()
      setActive(session.collectionId)
    },
    [authFetch, baseUrl, slideId, loadCollections, setActive]
  )

  const endOther = useCallback(
    async (id: string) => {
      await send(`/collections/${id}/end`, 'POST')
      await loadCollections()
    },
    [send, loadCollections]
  )

  const renameSession = useCallback(
    async (name: string) => {
      if (!sessionId) return
      await send(`/collections/${sessionId}`, 'PUT', { collectionName: name })
      await loadCollections()
    },
    [send, sessionId, loadCollections]
  )

  // Doesn't fetch the list again itself - once it shows as ended, the room
  // closes, so the caller tells everyone in it first, then calls refresh.
  const endSession = useCallback(async () => {
    if (!sessionId) return
    await send(`/collections/${sessionId}/end`, 'POST')
  }, [send, sessionId])

  const loadInvites = useCallback(
    () => (sessionId ? request<Invite[]>(`/collections/${sessionId}/invites`) : Promise.resolve([])),
    [request, sessionId]
  )

  const createInvite = useCallback(
    (role: CollectionRole, hours: number) => {
      if (!sessionId) return Promise.reject(new Error('Not in a session'))
      return send<Invite>(`/collections/${sessionId}/invites`, 'POST', { role, hours }).then((invite) => {
        setInviteChanges((n) => n + 1)
        return invite
      })
    },
    [send, sessionId]
  )

  const updateInvite = useCallback(
    (code: string, role: CollectionRole, hours: number) => {
      if (!sessionId) return Promise.reject(new Error('Not in a session'))
      return send<Invite>(`/collections/${sessionId}/invites/${encodeURIComponent(code)}`, 'PUT', { role, hours })
    },
    [send, sessionId]
  )

  const stopInvite = useCallback(
    async (code: string) => {
      if (sessionId) await send(`/collections/${sessionId}/invites/${encodeURIComponent(code)}`, 'DELETE')
    },
    [send, sessionId]
  )

  const previewInvite = useCallback(
    async (code: string) => {
      try {
        return await request<InvitePreview>(`/invites/${encodeURIComponent(code)}`)
      } catch {
        return null
      }
    },
    [request]
  )

  const acceptInvite = useCallback(
    async (code: string) => {
      const joined = await send<Collection>(`/invites/${encodeURIComponent(code)}/accept`, 'POST')
      await loadCollections()
      setActive(joined.collectionId)
    },
    [send, loadCollections, setActive]
  )

  const setMemberRole = useCallback(
    async (userId: string, role: CollectionRole) => {
      if (!sessionId) return
      await send(`/collections/${sessionId}/members/${encodeURIComponent(userId)}`, 'PUT', { displayName: '', role })
      await loadCollections()
    },
    [send, sessionId, loadCollections]
  )

  const removeMember = useCallback(
    async (userId: string) => {
      if (!sessionId) return
      await send(`/collections/${sessionId}/members/${encodeURIComponent(userId)}`, 'DELETE')
      await loadCollections()
    },
    [send, sessionId, loadCollections]
  )

  const setShared = useCallback(
    async (shared: boolean) => {
      if (!personalCollectionId) return
      await send(`/collections/${personalCollectionId}/sharing`, 'PUT', { shared })
      await loadCollections()
    },
    [send, personalCollectionId, loadCollections]
  )

  const renameCollection = useCallback(
    async (id: string, name: string) => {
      await send(`/collections/${id}`, 'PUT', { collectionName: name })
      await loadCollections()
    },
    [send, loadCollections]
  )

  // Out of the one you're in first, so the list coming back without it
  // isn't taken as being removed.
  const leaveForGood = useCallback(
    async (id: string) => {
      if (activeIdRef.current === id) setActive(null)
      await send(`/collections/${id}/members/${encodeURIComponent(user.id)}`, 'DELETE')
      await loadCollections()
    },
    [send, user.id, setActive, loadCollections]
  )

  const deleteSession = useCallback(
    async (id: string) => {
      if (activeIdRef.current === id) setActive(null)
      await send(`/collections/${id}`, 'DELETE')
      await loadCollections()
    },
    [send, setActive, loadCollections]
  )

  const refresh = useCallback(() => loadCollections().catch(() => {}), [loadCollections])

  return (
    <CollectionContext.Provider
      value={{
        collectionId,
        personalCollectionId: status === 'ready' ? personalCollectionId : null,
        status,
        collections,
        active,
        session,
        roomId: session && !session.ended && !viewOnly ? session.collectionId : null,
        canEdit: !!active && active.myRole !== 'viewer' && !active.ended && !(session && viewOnly),
        dormant: !!session && !session.ended && viewOnly,
        refresh,
        open: (id, options) => setActive(id, options?.viewOnly ?? false),
        reopen: () => {
          if (activeIdRef.current) setActive(activeIdRef.current, false)
        },
        leaveSession: () => setActive(null),
        startSession,
        renameSession,
        endSession,
        endOther,
        loadInvites,
        inviteChanges,
        createInvite,
        updateInvite,
        stopInvite,
        previewInvite,
        acceptInvite,
        setMemberRole,
        removeMember,
        setShared,
        renameCollection,
        leaveForGood,
        deleteSession,
      }}
    >
      {children}
    </CollectionContext.Provider>
  )
}

function useCollectionContext(): CollectionContextValue {
  const context = useContext(CollectionContext)
  if (!context) {
    throw new Error('useCollectionContext must be used within a CollectionContextProvider')
  }
  return context
}

export { CollectionContextProvider, useCollectionContext }
export type { Collection, CollectionMember, CollectionRole, CollectionKind, Invite, InvitePreview }
