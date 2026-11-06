import { useState } from 'react'
import { useMessagingContext } from '../../context/MessagingContext'
import { usePresenceContext } from '../../context/PresenceContext'

interface PeoplePickerProps {
  // What's being sent, when that's why you're here.
  sending?: string
  // Only while you're in a session.
  sessionName?: string | null
  onSession?: () => void
  onPicked?: () => void
  onCancel: () => void
}

// Starting a conversation with anyone with an account - offline or not, since
// it's saved until they're back.
function PeoplePicker({ sending, sessionName, onSession, onPicked, onCancel }: PeoplePickerProps) {
  const { messageUser } = useMessagingContext()
  const { users } = usePresenceContext()
  const [search, setSearch] = useState('')
  const wanted = search.trim().toLowerCase()
  const people = users.filter((person) => (person.displayName || person.userId).toLowerCase().includes(wanted))

  return (
    <div className="messages-chat">
      <header className="messages-chat-top">
        <h3 className="messages-chat-title" title={sending}>
          {sending ? `Send ${sending} to` : 'New message'}
        </h3>
        <button type="button" className="messages-button" onClick={onCancel}>
          Cancel
        </button>
      </header>
      <div className="messages-picker">
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
        <ul className="messages-list messages-picker-list">
          {sending && sessionName && (
            <li>
              <button type="button" className="messages-row" onClick={onSession}>
                <span className="messages-row-name">Session chat - {sessionName}</span>
              </button>
            </li>
          )}
          {people.map((person) => (
            <li key={person.userId}>
              <button type="button" className="messages-row" onClick={() => {
                  onPicked?.()
                  messageUser(person.userId)
                }}>
                <span className={`realtime-presence${person.online ? ' realtime-presence--here' : ''}`} aria-label={person.online ? 'Online' : 'Offline'} />
                <span className="messages-row-name">{person.displayName || person.userId}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default PeoplePicker
