import { useCallback } from 'react'
import { useAnnotationStoreContext } from '../../context/AnnotationStoreContext'
import { useAuthContext } from '../../context/AuthContext'
import { useCollectionContext } from '../../context/CollectionContext'
import { useEmitEvent } from '../../context/EventContext'
import { useImageViewerContext } from '../../context/ImageViewerContext'
import { useMessagingContext } from '../../context/MessagingContext'
import type { FullCollection } from '../collections/collectionGeoJson'
import { useCollectionFiles } from '../collections/useCollectionFiles'
import type { Viewport } from '../realtime/realtime'
import { addRequest, buildPayload, formatBytes, overLimit, type Attachment, type Message, type NewAttachment, type SendPick } from './messages'
import { readRows, shownFromArea, shownFromRows, type ShownArea } from './sentArea'

// What's sent never changes, so it's only worked out once for each message -
// the preview and View both want it.
const shownByMessage = new Map<string, ShownArea | null>()

// Same as the Users tab's, for when the session has no working invite yet.
const NEW_INVITE = { role: 'editor', hours: 24 } as const

// Reading what's being sent from annotation-store, and adding what's been
// received to it. Both with your own token, so you can only send what you can
// read, and only add to what you can edit.
function useSentThings() {
  const { authFetch } = useAuthContext()
  const { baseUrl } = useAnnotationStoreContext()
  const { collectionId: activeId, personalCollectionId, loadInvites, createInvite, session } = useCollectionContext()
  const { source } = useImageViewerContext()
  const { loadAttachment, markAdded, showArea } = useMessagingContext()
  const { importInto } = useCollectionFiles()
  const emit = useEmitEvent()

  // Read when it goes rather than when it's picked, so it's what's there then.
  const rowsFor = useCallback(
    async (pick: SendPick): Promise<NewAttachment> => {
      const from = (pick.kind === 'collection' && pick.collectionId) || activeId
      if (!from) throw new Error('Nothing to send from yet')
      const response = await authFetch(`${baseUrl}/collections/${from}/export`)
      if (!response.ok) throw new Error("Couldn't read that from your collection")
      const built = buildPayload((await response.json()) as FullCollection, pick)
      if (!built) throw new Error("There's nothing in that to send")
      const tooBig = overLimit(built.payload)
      if (tooBig) throw new Error(`That's ${formatBytes(tooBig)}, and a message can take 5MB. Share a session instead`)
      return {
        // Either kind of group is a group to whoever gets it.
        kind: pick.kind === 'cellCountGroup' ? 'group' : pick.kind,
        name: built.name,
        slideId: source.slideId,
        sourceCollectionId: from,
        payload: built.payload,
      }
    },
    [activeId, authFetch, baseUrl, source.slideId]
  )

  // The working link if there is one - making a new one stops the old one, and
  // whoever already has it.
  const inviteFor = useCallback(async (): Promise<NewAttachment> => {
    if (!session) throw new Error("You're not in a session")
    const code = (await loadInvites())[0]?.code ?? (await createInvite(NEW_INVITE.role, NEW_INVITE.hours)).code
    return { kind: 'invite', name: session.collectionName, slideId: session.slideId, sourceCollectionId: session.collectionId, inviteCode: code }
  }, [session, loadInvites, createInvite])

  const areaFor = useCallback(
    (viewport: Viewport): NewAttachment => ({
      kind: 'area',
      name: `Area of slide ${source.slideId}`,
      slideId: source.slideId,
      sourceCollectionId: activeId ?? undefined,
      payload: viewport,
    }),
    [activeId, source.slideId]
  )

  // What it looks like on the map. Null if there's nothing in it to show.
  const shownFor = useCallback(
    async (message: Message) => {
      const cached = shownByMessage.get(message.id)
      if (cached !== undefined) return cached
      const { payload } = await loadAttachment(message.id)
      const shown = message.attachment?.kind === 'area' ? shownFromArea(message.id, payload) : shownFromRows(message.id, payload)
      shownByMessage.set(message.id, shown)
      return shown
    },
    [loadAttachment]
  )

  // Takes the map there and draws it, without adding it to anything.
  const viewOnMap = useCallback(
    async (message: Message) => {
      const shown = await shownFor(message)
      if (!shown) throw new Error("There's nothing in that to show")
      showArea(shown)
      emit('message:viewed', { messageId: message.id, kind: message.attachment?.kind })
    },
    [shownFor, showArea, emit]
  )

  // Your own collection for the slide it's from, which needn't be this one.
  const collectionFor = useCallback(
    async (slideId: string | null) => {
      if (personalCollectionId && (!slideId || slideId === source.slideId)) return personalCollectionId
      const response = await authFetch(`${baseUrl}/collections/ensure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slideId: slideId ?? source.slideId }),
      })
      if (!response.ok) throw new Error("Couldn't find your collection")
      return ((await response.json()) as { collectionId: string }).collectionId
    },
    [authFetch, baseUrl, personalCollectionId, source.slideId]
  )

  // Into your collection as new rows, with a note of where they came from.
  // Answers the card as it now is - the same as before if only saying it was
  // added failed, since the rows are in by then and that's what matters.
  const addToMine = useCallback(
    async (message: Message): Promise<Attachment> => {
      const attachment = message.attachment
      if (!attachment) throw new Error('Nothing to add')
      const rows = readRows((await loadAttachment(message.id)).payload)
      if (!rows) throw new Error("There's nothing in that to add")
      const target = await collectionFor(attachment.slideId)
      await importInto(target, addRequest(rows, message, attachment))
      emit('message:added', { messageId: message.id, kind: attachment.kind })
      return markAdded(message.id).catch(() => attachment)
    },
    [loadAttachment, collectionFor, importInto, emit, markAdded]
  )

  return { rowsFor, inviteFor, areaFor, shownFor, viewOnMap, addToMine }
}

export { useSentThings }
