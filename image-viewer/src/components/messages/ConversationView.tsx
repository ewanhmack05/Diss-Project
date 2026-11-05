import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { useDialogContext } from '../../context/DialogContext'
import { useMessagingContext } from '../../context/MessagingContext'
import { useToastContext } from '../../context/ToastContext'
import Icon from '../../icons/Icon'
import chevronLeftSvg from '../../icons/chevron-left.svg?raw'
import { newId } from '../../newId'
import { censorText } from '../../textFilter'
import { dayHeading, formatTime } from '../saved/savedDates'
import AttachmentCard from './AttachmentCard'
import SendMenu, { type Staged } from './SendMenu'
import { BODY_COUNT_FROM, MAX_BODY, mergeMessages, type Attachment, type ChatTarget, type Conversation, type Message } from './messages'
import { useSentThings } from './useSentThings'

const PAGE = 50

interface ConversationViewProps {
  target: ChatTarget
  // Null until the first message, for someone you've not written to.
  conversation: Conversation | null
  title: string
  // Why you can't write, when you can't - an ended session.
  readOnlyNote?: string
  canDelete: boolean
  deleteLabel: string
  onBack?: () => void
  onDeleted?: () => void
}

// One conversation: its messages, oldest at the top, and the box to write in.
function ConversationView({ target, conversation, title, readOnlyNote, canDelete, deleteLabel, onBack, onDeleted }: ConversationViewProps) {
  const { user } = useAuthContext()
  const { loadMessages, send, markRead, deleteConversation, lastWaiting } = useMessagingContext()
  const { rowsFor, inviteFor } = useSentThings()
  const { addToast } = useToastContext()
  const { showDialog } = useDialogContext()
  const [messages, setMessages] = useState<Message[]>([])
  const [total, setTotal] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [staged, setStaged] = useState<Staged | null>(null)
  const [sending, setSending] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Kept until it's gone through, so sending again after a dropped connection
  // is the same message.
  const draftId = useRef(newId())
  // Reading further back shouldn't jump to the bottom, and nor should something
  // arriving when you've scrolled up.
  const stickToBottom = useRef(true)

  const conversationId = conversation?.id ?? null

  const loadNewest = useCallback(() => {
    if (!conversationId) return
    loadMessages(conversationId, 0, PAGE)
      .then((page) => {
        setMessages((current) => mergeMessages(current, page.messages))
        setTotal(page.total)
        setProblem(null)
      })
      .catch((error: Error) => setProblem(error.message))
  }, [conversationId, loadMessages])

  useEffect(loadNewest, [loadNewest])

  // Fetched rather than taken from the hub, which only says something's there.
  useEffect(() => {
    if (lastWaiting && lastWaiting.conversationId === conversationId) loadNewest()
  }, [lastWaiting, conversationId, loadNewest])

  // Being open is reading it. The answer brings unread back to 0, so this settles.
  const unread = conversation?.unread ?? 0
  useEffect(() => {
    if (conversationId && unread > 0) markRead(conversationId).catch(() => {})
  }, [conversationId, unread, markRead])

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller && stickToBottom.current) scroller.scrollTop = scroller.scrollHeight
  }, [messages])

  const older = () => {
    if (!conversationId) return
    stickToBottom.current = false
    const scroller = scrollRef.current
    const fromBottom = scroller ? scroller.scrollHeight - scroller.scrollTop : 0
    loadMessages(conversationId, messages.length, PAGE)
      .then((page) => {
        setMessages((current) => mergeMessages(current, page.messages))
        setTotal(page.total)
        // Stays on the same message once the older ones are above it.
        requestAnimationFrame(() => {
          if (scroller) scroller.scrollTop = scroller.scrollHeight - fromBottom
        })
      })
      .catch((error: Error) => addToast(error.message, 'error'))
  }

  const canSend = !sending && (body.trim().length > 0 || !!staged) && body.length <= MAX_BODY

  const submit = async () => {
    if (!canSend) return
    setSending(true)
    try {
      const attachment = !staged ? undefined : 'invite' in staged ? await inviteFor() : await rowsFor(staged.pick)
      const saved = await send(target, { id: draftId.current, body: body.trim(), attachment })
      stickToBottom.current = true
      setMessages((current) => mergeMessages(current, [saved]))
      setTotal((n) => n + 1)
      setBody('')
      setStaged(null)
      draftId.current = newId()
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Couldn't send that", 'error')
    } finally {
      setSending(false)
    }
  }

  const confirmDelete = () => {
    if (!conversationId) return
    showDialog({
      title: deleteLabel,
      message:
        target.kind === 'direct'
          ? 'It goes from your list. They keep their copy, and it comes back if either of you writes again.'
          : 'This removes the chat for everyone in the session, and nothing can bring it back.',
      actions: [
        {
          label: 'Delete',
          onClick: () => {
            deleteConversation(conversationId)
              .then(() => onDeleted?.())
              .catch((error: Error) => addToast(error.message, 'error'))
          },
        },
        { label: 'Cancel' },
      ],
    })
  }

  const updateAttachment = (messageId: string, attachment: Attachment) =>
    setMessages((current) => current.map((m) => (m.id === messageId ? { ...m, attachment } : m)))

  return (
    <div className="messages-chat">
      <header className="messages-chat-top">
        {onBack && (
          <button type="button" className="messages-icon-button" aria-label="Back to your messages" onClick={onBack}>
            <Icon svg={chevronLeftSvg} size={12} />
          </button>
        )}
        <h3 className="messages-chat-title" title={title}>
          {title}
        </h3>
        {canDelete && conversationId && (
          <button type="button" className="messages-button" onClick={confirmDelete}>
            Delete
          </button>
        )}
      </header>

      <div
        ref={scrollRef}
        className="messages-scroll"
        onScroll={(e) => {
          const scroller = e.currentTarget
          stickToBottom.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40
        }}
      >
        {messages.length < total && (
          <button type="button" className="messages-button messages-older" onClick={older}>
            Older messages
          </button>
        )}
        {problem && <p className="messages-note">{problem}</p>}
        {!problem && messages.length === 0 && (
          <p className="messages-note">{conversationId ? 'No messages yet.' : `Write something to start talking to ${title}.`}</p>
        )}
        {messages.map((message, index) => {
          const mine = message.fromUserId === user.id
          const before = messages[index - 1]
          const newDay = !before || dayHeading(before.sent) !== dayHeading(message.sent)
          const sameSender = !newDay && before.fromUserId === message.fromUserId
          return (
            <div key={message.id} className="messages-entry">
              {newDay && <p className="messages-day">{dayHeading(message.sent)}</p>}
              <div className={`messages-message${mine ? ' messages-message--mine' : ''}`}>
                {!mine && !sameSender && <span className="messages-from">{censorText(message.fromName)}</span>}
                {message.body && <p className="messages-body">{censorText(message.body)}</p>}
                {message.attachment && (
                  <AttachmentCard message={message} attachment={message.attachment} mine={mine} onChanged={(a) => updateAttachment(message.id, a)} />
                )}
                <time className="messages-time" dateTime={message.sent}>
                  {formatTime(message.sent)}
                </time>
              </div>
            </div>
          )
        })}
      </div>

      {readOnlyNote ? (
        <p className="messages-note messages-read-only">{readOnlyNote}</p>
      ) : (
        <div className="messages-write">
          {menuOpen && <SendMenu offerInvite={target.kind === 'direct'} onPick={setStaged} onClose={() => setMenuOpen(false)} />}
          {staged && (
            <div className="messages-staged">
              <span className="messages-staged-label" title={staged.label}>
                {staged.label}
              </span>
              <button type="button" className="messages-icon-button" aria-label="Don't send this" onClick={() => setStaged(null)}>
                ×
              </button>
            </div>
          )}
          <textarea
            className="messages-input"
            rows={2}
            aria-label="Write a message"
            placeholder="Write a message"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <div className="messages-write-row">
            <button type="button" className="messages-button" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
              Attach…
            </button>
            {body.length >= BODY_COUNT_FROM && (
              <span className={`messages-count${body.length > MAX_BODY ? ' messages-count--over' : ''}`}>
                {body.length.toLocaleString('en-GB')} / {MAX_BODY.toLocaleString('en-GB')}
              </span>
            )}
            <button type="button" className="messages-button messages-button--accent messages-send" disabled={!canSend} onClick={submit}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default ConversationView
