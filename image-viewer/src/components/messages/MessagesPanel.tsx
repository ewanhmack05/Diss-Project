import { useEffect, useState } from 'react'
import { useCollectionContext } from '../../context/CollectionContext'
import { useMessagingContext } from '../../context/MessagingContext'
import { usePresenceContext } from '../../context/PresenceContext'
import { censorText } from '../../textFilter'
import ConversationList from './ConversationList'
import ConversationView from './ConversationView'
import { conversationName } from './messages'
import './MessagesPanel.css'

type MessagesTab = 'people' | 'session'

// People: your one to one conversations. Session: the chat of the session you're
// in, for everyone in it - the tab's only there while you're in one.
function MessagesPanel() {
  const { status, conversations, sessionChat, sessionChatProblem, openUserId, openRequests, closeConversation, refresh } = useMessagingContext()
  const { session } = useCollectionContext()
  const { users } = usePresenceContext()
  const [picked, setPicked] = useState<MessagesTab>('people')
  const tab = session ? picked : 'people'

  // Message on the Users tab lands on them, whichever tab this was on.
  useEffect(() => {
    if (openRequests > 0) setPicked('people')
  }, [openRequests])

  // Catches up on opening, in case the hub was away for anything.
  useEffect(() => {
    refresh()
  }, [refresh])

  if (status === 'off') {
    return <p className="messages-note messages-alone">Messages are for people with an account.</p>
  }

  const openConversation = openUserId ? conversations.find((c) => c.withUserId === openUserId) ?? null : null
  const openName = openUserId
    ? censorText(
        openConversation
          ? conversationName(openConversation, users)
          : users.find((u) => u.userId === openUserId)?.displayName || 'Someone'
      )
    : ''

  let body
  if (status === 'error') {
    body = <p className="messages-note messages-alone">Can't reach messaging. Everything else still works - trying again when you come back to this.</p>
  } else if (status === 'loading') {
    body = <p className="messages-note messages-alone">Loading…</p>
  } else if (tab === 'session' && session) {
    body = sessionChat ? (
      <ConversationView
        key={sessionChat.id}
        target={{ kind: 'session', sessionId: session.collectionId }}
        conversation={sessionChat}
        title={censorText(session.collectionName)}
        readOnlyNote={session.ended ? "This session's ended, so its chat is read only." : undefined}
        canDelete={session.myRole === 'owner'}
        deleteLabel="Delete this session's chat"
      />
    ) : (
      <p className="messages-note messages-alone">{sessionChatProblem ?? 'Loading…'}</p>
    )
  } else if (openUserId) {
    body = (
      <ConversationView
        key={openUserId}
        target={{ kind: 'direct', userId: openUserId }}
        conversation={openConversation}
        title={openName}
        canDelete
        deleteLabel={`Delete your conversation with ${openName}`}
        onBack={closeConversation}
        onDeleted={closeConversation}
      />
    )
  } else {
    body = (
      <div className="messages-panel">
        <ConversationList />
      </div>
    )
  }

  const directUnread = conversations.reduce((sum, c) => sum + c.unread, 0)
  return (
    <div className="messages-wrap">
      {session && (
        <div className="messages-tabs" role="tablist" aria-label="Messages">
          {(['people', 'session'] as const).map((option) => {
            const count = option === 'people' ? directUnread : (sessionChat?.unread ?? 0)
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={tab === option}
                className={`messages-tab${tab === option ? ' messages-tab--active' : ''}`}
                onClick={() => setPicked(option)}
              >
                {option === 'people' ? 'People' : 'Session'}
                {count > 0 && <span className="messages-unread">{count}</span>}
              </button>
            )
          })}
        </div>
      )}
      {body}
    </div>
  )
}

export default MessagesPanel
