import type { Annotation } from '../../interfaces/Annotation'
import type { CellCount } from '../../interfaces/CellCount'
import type { Viewport } from '../realtime/realtime'
import { newId } from '../../newId'
import type { FullCollection } from '../collections/collectionGeoJson'

// As messaging gives them - see messaging/README.md.
type ConversationKind = 'direct' | 'session'
type AttachmentKind = 'annotations' | 'group' | 'cellCount' | 'collection' | 'invite' | 'area'

interface Attachment {
  kind: AttachmentKind
  name: string
  slideId: string | null
  sourceCollectionId: string | null
  inviteCode: string | null
  bytes: number
  lastAddedByMe: string | null
}

interface Message {
  id: string
  conversationId: string
  fromUserId: string
  fromName: string
  body: string
  sent: string
  attachment: Attachment | null
}

interface Conversation {
  id: string
  kind: ConversationKind
  withUserId: string | null
  sessionId: string | null
  created: string
  lastMessage: Message | null
  unread: number
}

// What's kept in a message: the rows themselves, shaped so adding them is an
// import. Only messaging's size limit applies - it doesn't read them.
interface SentRows {
  annotations: Annotation[]
  cellCounts: CellCount[]
  groups: { name: string; notes?: string; annotationIds: string[] }[]
  cellCountGroups?: { name: string; notes?: string; cellCountIds: string[] }[]
}

interface NewAttachment {
  kind: AttachmentKind
  name: string
  slideId?: string
  sourceCollectionId?: string
  inviteCode?: string
  // The rows, or for an area where it is.
  payload?: SentRows | Viewport
}

interface SendMessage {
  id: string
  body: string
  attachment?: NewAttachment
}

// What's being sent, from a Send button where it's saved. The rows are read when
// it goes. A collection is the one you're in unless it says otherwise.
type SendPick =
  | { kind: 'annotations'; ids: string[] }
  | { kind: 'group'; id: string }
  | { kind: 'cellCount'; id: string }
  | { kind: 'cellCountGroup'; id: string }
  | { kind: 'collection'; collectionId?: string }

// What's going with a message, before it's sent.
type Staged = { label: string; pick: SendPick } | { label: string; invite: true } | { label: string; area: Viewport }

// Who a conversation's with, before there's necessarily a conversation.
type ChatTarget = { kind: 'direct'; userId: string } | { kind: 'session'; sessionId: string }

// What messaging's limits are - it checks them too.
const MAX_BODY = 4000
const MAX_NAME = 200
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024
// The body's counter only shows once it's getting close.
const BODY_COUNT_FROM = 3500

const NOUNS: Record<AttachmentKind, string> = {
  annotations: 'Annotations',
  group: 'Group',
  cellCount: 'Cell count',
  collection: 'Collection',
  invite: 'Invite',
  area: 'Area',
}

function attachmentNoun(kind: AttachmentKind): string {
  return NOUNS[kind] ?? 'Something'
}

// Direct conversations don't say who it's with by name, so it's from the Users
// tab's list - or their last message, for anyone it doesn't have.
function conversationName(conversation: Conversation, users: { userId: string; displayName: string }[]): string {
  const known = users.find((u) => u.userId === conversation.withUserId)?.displayName
  if (known) return known
  const last = conversation.lastMessage
  return last && last.fromUserId === conversation.withUserId ? last.fromName : 'Someone'
}

function totalUnread(direct: Conversation[], sessionChat: Conversation | null): number {
  return direct.reduce((sum, c) => sum + c.unread, sessionChat?.unread ?? 0)
}

// Oldest first, each once. Pages overlap when something arrives between two
// fetches, and a message answers both the send and the next load.
function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((m) => [m.id, m]))
  for (const message of incoming) byId.set(message.id, message)
  return [...byId.values()].sort((a, b) => a.sent.localeCompare(b.sent) || a.id.localeCompare(b.id))
}

// The line under a conversation's name.
function previewOf(message: Message | null, myId: string): string {
  if (!message) return 'No messages yet'
  const who = message.fromUserId === myId ? 'You: ' : ''
  if (message.body) return who + message.body
  return who + (message.attachment ? `${attachmentNoun(message.attachment.kind)} - ${message.attachment.name}` : '')
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`
}

// Groups by name, as an import takes them, with only the rows being sent.
function groupsFor(full: FullCollection, annotations: Annotation[]): SentRows['groups'] {
  return (full.groups ?? []).flatMap((group) => {
    const annotationIds = annotations.filter((a) => a.groupId === group.id).map((a) => a.id)
    return annotationIds.length > 0 ? [{ name: group.name, notes: group.notes, annotationIds }] : []
  })
}

function countGroupsFor(full: FullCollection, cellCounts: CellCount[]): NonNullable<SentRows['cellCountGroups']> {
  return (full.cellCountGroups ?? []).flatMap((group) => {
    const cellCountIds = cellCounts.filter((c) => c.groupId === group.id).map((c) => c.id)
    return cellCountIds.length > 0 ? [{ name: group.name, notes: group.notes, cellCountIds }] : []
  })
}

// The rows for what was picked, from the whole collection, and what to call
// it. Null if there's nothing there to send, like a group that's been emptied.
function buildPayload(full: FullCollection, pick: SendPick): { name: string; payload: SentRows } | null {
  let annotations: Annotation[] = []
  let cellCounts: CellCount[] = []
  let name: string
  if (pick.kind === 'annotations') {
    const ids = new Set(pick.ids)
    annotations = full.annotations.filter((a) => ids.has(a.id))
    name = annotations.length === 1 && annotations[0].label ? annotations[0].label : plural(annotations.length, 'annotation', 'annotations')
  } else if (pick.kind === 'group') {
    annotations = full.annotations.filter((a) => a.groupId === pick.id)
    name = full.groups?.find((g) => g.id === pick.id)?.name ?? 'A group'
  } else if (pick.kind === 'cellCount') {
    cellCounts = full.cellCounts.filter((c) => c.id === pick.id)
    name = cellCounts[0]?.label || 'Cell count'
  } else if (pick.kind === 'cellCountGroup') {
    cellCounts = full.cellCounts.filter((c) => c.groupId === pick.id)
    name = full.cellCountGroups?.find((g) => g.id === pick.id)?.name ?? 'A group'
  } else {
    annotations = full.annotations
    cellCounts = full.cellCounts
    name = full.collectionName
  }
  if (annotations.length === 0 && cellCounts.length === 0) return null
  return { name: name.slice(0, MAX_NAME), payload: { annotations, cellCounts, groups: groupsFor(full, annotations), cellCountGroups: countGroupsFor(full, cellCounts) } }
}

// Its size if it's over the limit, so it can be turned down before the upload.
function overLimit(payload: SentRows): number | null {
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length
  return bytes > MAX_PAYLOAD_BYTES ? bytes : null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

// Where it came from - annotation-store keeps this on the change.
interface ImportSource {
  messageId: string
  fromUserId: string
  fromName: string
  kind: AttachmentKind
  name: string
  collectionId: string | null
  slideId: string | null
  rows: { entity: 'annotation' | 'cellCount'; from: string; to: string }[]
}

// What adding it sends to annotation-store: new ids, so adding twice adds it
// twice, and a note of which row each came from.
function addRequest(rows: SentRows, message: Pick<Message, 'id' | 'fromUserId' | 'fromName'>, attachment: Pick<Attachment, 'kind' | 'name' | 'sourceCollectionId' | 'slideId'>) {
  const newIds = new Map<string, string>()
  const annotations = rows.annotations.map((annotation) => {
    const id = newId()
    newIds.set(annotation.id, id)
    return { ...annotation, id, groupId: null }
  })
  const cellCounts = rows.cellCounts.map((cellCount) => {
    const id = newId()
    newIds.set(cellCount.id, id)
    const region = cellCount.regionOfInterest
    return { ...cellCount, id, groupId: null, regionOfInterest: region ? { ...region, id: newId() } : null }
  })
  const source: ImportSource = {
    messageId: message.id,
    fromUserId: message.fromUserId,
    fromName: message.fromName,
    kind: attachment.kind,
    name: attachment.name,
    collectionId: attachment.sourceCollectionId,
    slideId: attachment.slideId,
    rows: [
      ...rows.annotations.map((a) => ({ entity: 'annotation' as const, from: a.id, to: newIds.get(a.id)! })),
      ...rows.cellCounts.map((c) => ({ entity: 'cellCount' as const, from: c.id, to: newIds.get(c.id)! })),
    ],
  }
  const groups = rows.groups.map((group) => ({
    ...group,
    annotationIds: group.annotationIds.flatMap((id) => {
      const moved = newIds.get(id)
      return moved ? [moved] : []
    }),
  }))
  const cellCountGroups = (rows.cellCountGroups ?? []).map((group) => ({
    ...group,
    cellCountIds: group.cellCountIds.flatMap((id) => {
      const moved = newIds.get(id)
      return moved ? [moved] : []
    }),
  }))
  return { annotations, cellCounts, groups, cellCountGroups, skipped: [], source }
}

// Whether this message gets a name and time, or carries on from the last one:
// the same person, the same day, and within a few minutes.
const RUN_WITHIN_MS = 5 * 60 * 1000

function startsRun(before: Message | undefined, message: Message): boolean {
  if (!before || before.fromUserId !== message.fromUserId) return true
  const gap = new Date(message.sent).getTime() - new Date(before.sent).getTime()
  return !(gap >= 0 && gap <= RUN_WITHIN_MS)
}

// Below this there's no room for the list beside a thread you can read. A side
// dock is 20em. Only when docked: floating, the panel's own width follows the
// list, so folding it mustn't then stop you unfolding it.
const ROOM_FOR_THE_LIST_EM = 26

function isCramped(docked: boolean, widthPx: number, fontSizePx: number): boolean {
  return docked && widthPx > 0 && widthPx / fontSizePx < ROOM_FOR_THE_LIST_EM
}

// What to tell someone when a call to messaging fails.
function problemText(status: number, detail: string): string {
  if (status === 0) return "Can't reach messaging - try again"
  if (status === 413) return detail || 'Too big to send'
  if (status === 409) return detail || "This session's ended, so its chat is read only"
  if (status === 404) return "That's gone, or you're not in it any more"
  if (status === 503) return "Can't check you're in the session right now - try again"
  if (status === 400 && detail) return detail
  return "Couldn't do that - try again"
}

export {
  BODY_COUNT_FROM,
  MAX_BODY,
  MAX_PAYLOAD_BYTES,
  addRequest,
  attachmentNoun,
  buildPayload,
  conversationName,
  formatBytes,
  isCramped,
  mergeMessages,
  overLimit,
  previewOf,
  problemText,
  startsRun,
  totalUnread,
}
export type {
  Attachment,
  AttachmentKind,
  ChatTarget,
  Conversation,
  ImportSource,
  Message,
  NewAttachment,
  SendMessage,
  SendPick,
  SentRows,
  Staged,
}
