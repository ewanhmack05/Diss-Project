import { useState } from 'react'
import { useAuthContext } from '../../context/AuthContext'
import { useMessagingContext } from '../../context/MessagingContext'
import { usePresenceContext } from '../../context/PresenceContext'
import { censorText } from '../../textFilter'
import { formatShortDate } from '../saved/savedDates'
import { conversationName, previewOf } from './messages'

// Your conversations, most recent first, and starting one with anyone with an
// account - offline or not, since it's saved until they're back.
function ConversationList() {
  const { user } = useAuthContext()
  const { conversations, messageUser } = useMessagingContext()
  const { users } = usePresenceContext()
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')

  if (picking) {
    const wanted = search.trim().toLowerCase()
    const people = users.filter((person) => (person.displayName || person.userId).toLowerCase().includes(wanted))
    return (
      <section className="messages-section">
        <div className="messages-section-top">
          <h3 className="messages-heading">New message</h3>
          <button type="button" className="messages-button" onClick={() => setPicking(false)}>
            Cancel
          </button>
        </div>
        <input
          className="messages-search"
          type="search"
          placeholder="Find someone"
          aria-label="Find someone to message"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {users.length === 0 && <p className="messages-note">Can't load everyone right now - the real-time hub may be away.</p>}
        {users.length > 0 && people.length === 0 && <p className="messages-note">Nobody by that name.</p>}
        <ul className="messages-list">
          {people.map((person) => (
            <li key={person.userId}>
              <button type="button" className="messages-row" onClick={() => messageUser(person.userId)}>
                <span className={`realtime-presence${person.online ? ' realtime-presence--here' : ''}`} aria-label={person.online ? 'Online' : 'Offline'} />
                <span className="messages-row-name">{person.displayName || person.userId}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section className="messages-section">
      <div className="messages-section-top">
        <h3 className="messages-heading">Conversations ({conversations.length})</h3>
        <button type="button" className="messages-button messages-button--accent" onClick={() => setPicking(true)}>
          New message
        </button>
      </div>
      {conversations.length === 0 && <p className="messages-note">Nothing yet. Start one with New message, or Message on the Users tab.</p>}
      <ul className="messages-list">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <button type="button" className="messages-row messages-row--conversation" onClick={() => conversation.withUserId && messageUser(conversation.withUserId)}>
              <span className="messages-row-top">
                <span className={`messages-row-name${conversation.unread > 0 ? ' messages-row-name--unread' : ''}`}>
                  {censorText(conversationName(conversation, users))}
                </span>
                {conversation.lastMessage && <span className="messages-row-when">{formatShortDate(conversation.lastMessage.sent)}</span>}
                {conversation.unread > 0 && (
                  <span className="messages-unread" aria-label={`${conversation.unread} unread`}>
                    {conversation.unread}
                  </span>
                )}
              </span>
              <span className="messages-row-preview">{censorText(previewOf(conversation.lastMessage, user.id))}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default ConversationList
