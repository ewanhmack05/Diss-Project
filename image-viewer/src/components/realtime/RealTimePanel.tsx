import { useState } from 'react'
import { useRealtimeContext } from '../../context/RealtimeContext'
import { pointerProps, useViewportsContext } from '../../context/ViewportsContext'
import { useCollectionContext, type Collection, type CollectionRole } from '../../context/CollectionContext'
import { useAuthContext } from '../../context/AuthContext'
import { useEmitEvent } from '../../context/EventContext'
import { TOOL_NAMES, useToolbarContext, type ToolId } from '../../context/ToolbarContext'
import CountInvites from '../cell-count/CountInvites'
import SessionInvite from './SessionInvite'
import UsersList from '../users/UsersList'
import JoinWithCode from '../users/JoinWithCode'
import { usePresenceContext } from '../../context/PresenceContext'
import { useComparisonContext } from '../../context/ComparisonContext'
import { useSharedCountContext } from '../../context/SharedCountContext'
import { formatLongDate } from '../saved/savedDates'
import type { NavigationMode } from './realtime'
import './RealTimePanel.css'

const ROLE_TEXT: Record<CollectionRole, string> = {
  owner: 'Host',
  editor: 'Can edit',
  viewer: 'Can view',
}

const CONNECTION_TEXT = {
  off: 'Realtime is off',
  alone: '',
  connecting: 'Connecting…',
  connected: 'Live',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
} as const

// Tells everyone else in the session to fetch it again - after a role
// change, someone being taken out, or the session ending.
function useTellEveryone() {
  const { sendOp } = useRealtimeContext()
  const { session } = useCollectionContext()
  return () => {
    if (session) sendOp({ kind: 'update', entity: 'collection', id: session.collectionId })
  }
}

function PeopleList({ session, controls }: { session: Collection; controls: boolean }) {
  const { me, others } = useRealtimeContext()
  const { setMemberRole, removeMember } = useCollectionContext()
  const { user } = useAuthContext()
  const { pointedAt, pointAt } = useViewportsContext()
  const emit = useEmitEvent()
  const tellEveryone = useTellEveryone()
  const online = new Set([me?.userId, ...others.map((p) => p.userId)])

  const change = (action: Promise<void>) =>
    action.then(tellEveryone).catch(() => emit('session:error'))

  return (
    <section className="realtime-section">
      <h3 className="realtime-heading">People ({session.members.length})</h3>
      <ul className="realtime-people">
        {session.members.map((member) => {
          const here = online.has(member.userId)
          // Only someone else who's here has a viewport on the map to show.
          const pointable = here && member.userId !== user.id
          return (
            <li
              key={member.userId}
              className={`realtime-person${pointedAt === member.userId && pointable ? ' realtime-person--pointed' : ''}`}
              title={pointable ? `Show where ${member.displayName} is looking` : member.userId}
              {...(pointable ? pointerProps(member.userId, pointAt) : {})}
            >
              <span
                className={`realtime-presence${here ? ' realtime-presence--here' : ''}`}
                aria-label={here ? 'Here now' : 'Away'}
              />
              <span className={`realtime-person-name${here ? '' : ' realtime-person-name--away'}`}>
                {member.displayName || member.userId}
                {member.userId === user.id && ' (you)'}
                {!here && <span className="realtime-person-away"> · away</span>}
              </span>
              {controls && member.role !== 'owner' ? (
                <>
                  <select
                    aria-label={`What ${member.displayName} can do`}
                    value={member.role}
                    onChange={(e) => change(setMemberRole(member.userId, e.target.value as CollectionRole))}
                  >
                    <option value="editor">Can edit</option>
                    <option value="viewer">Can view</option>
                  </select>
                  <button
                    type="button"
                    className="realtime-icon-button"
                    aria-label={`Take ${member.displayName} out of the session`}
                    onClick={() => change(removeMember(member.userId))}
                  >
                    ×
                  </button>
                </>
              ) : (
                <span className="realtime-person-role">{ROLE_TEXT[member.role]}</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// Comparison and shared count invites and progress - these only happen in a session.
function CountActivity() {
  const { comparison, myCounter } = useComparisonContext()
  const handedIn = comparison?.counters.filter((c) => c.state === 'submitted').length ?? 0
  const { sharedCount, myContributor } = useSharedCountContext()
  const sharedJoined = sharedCount?.contributors.filter((c) => c.state === 'joined').length ?? 0

  return (
    <>
      <CountInvites />
      {comparison && myCounter?.state !== 'invited' && (
        <p className="realtime-note">
          {comparison.revealed
            ? 'Comparison count finished'
            : `Comparison count running - ${handedIn} of ${comparison.counters.length} handed in`}
        </p>
      )}
      {sharedCount && myContributor?.state !== 'invited' && (
        <p className="realtime-note">{`Shared count running - ${sharedCount.dots.length} cells, ${sharedJoined} counting`}</p>
      )}
    </>
  )
}

function WorkingAlone() {
  const { collections, startSession, open } = useCollectionContext()
  const { user } = useAuthContext()
  const { activeTools, toggleTool } = useToolbarContext()
  const emit = useEmitEvent()
  const [starting, setStarting] = useState(false)
  const sessions = collections.filter((c) => c.kind === 'session').length
  // One per slide - the newest you host that hasn't ended. The list is newest first.
  const mine = collections.find((c) => c.kind === 'session' && !c.ended && c.ownerId === user.id)

  const start = () => {
    setStarting(true)
    startSession()
      .catch(() => emit('session:error'))
      .finally(() => setStarting(false))
  }

  return (
    <>
      <section className="realtime-section">
        <h3 className="realtime-heading">Work together</h3>
        {mine ? (
          <>
            <p className="realtime-note">
              You already host <strong>{mine.collectionName}</strong> on this slide - one at a time. Reopen it to carry on,
              or end it from inside to start a fresh one.
            </p>
            <button
              type="button"
              className="realtime-button realtime-button--accent realtime-button--wide"
              onClick={() => open(mine.collectionId)}
            >
              Reopen your session
            </button>
          </>
        ) : (
          <>
            <p className="realtime-note">
              Start a session to work on this slide with other people. You'll get an invite link and code to send them, or
              invite anyone online from Users - nobody can join without one.
            </p>
            <button type="button" className="realtime-button realtime-button--accent realtime-button--wide" disabled={starting} onClick={start}>
              {starting ? 'Starting…' : 'Start a session'}
            </button>
          </>
        )}
      </section>

      {/* Rejoining one, or looking back at one that's ended, is in Collections. */}
      {sessions > 0 && (
        <section className="realtime-section">
          <p className="realtime-note">
            You're in {sessions} {sessions === 1 ? 'session' : 'sessions'} on this slide.
          </p>
          <button
            type="button"
            className="realtime-button realtime-button--wide"
            onClick={() => {
              if (!activeTools.includes('collections')) toggleTool('collections')
            }}
          >
            Open Collections
          </button>
        </section>
      )}
      <JoinWithCode />
    </>
  )
}

function SessionTitle({ session, editable }: { session: Collection; editable: boolean }) {
  const { renameSession } = useCollectionContext()
  const emit = useEmitEvent()
  const tellEveryone = useTellEveryone()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(session.collectionName)

  const save = () => {
    setEditing(false)
    const trimmed = name.trim()
    if (!trimmed || trimmed === session.collectionName) return
    renameSession(trimmed)
      .then(tellEveryone)
      .catch(() => emit('session:error'))
  }

  if (editing) {
    return (
      <input
        className="realtime-title-input"
        aria-label="Session name"
        value={name}
        maxLength={64}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }

  return (
    <div className="realtime-title-row">
      <h2 className="realtime-title">{session.collectionName}</h2>
      {editable && (
        <button
          type="button"
          className="realtime-icon-button realtime-icon-button--plain"
          aria-label="Rename session"
          onClick={() => {
            setName(session.collectionName)
            setEditing(true)
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M11 2.5 L13.5 5 L5.5 13 L2.5 13.5 L3 10.5 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

function LiveLine({ text }: { text: string }) {
  const { status } = useRealtimeContext()
  const live = status === 'connected'
  return (
    <p className="realtime-live">
      <span className={`realtime-presence${live ? ' realtime-presence--here' : ''}`} />
      {live ? text : CONNECTION_TEXT[status]}
    </p>
  )
}

const NAVIGATION_OPTIONS: { mode: NavigationMode; label: string; about: string }[] = [
  { mode: 'free', label: 'Free', about: 'Everyone moves round on their own.' },
  { mode: 'follow', label: 'Follow me', about: 'Everyone sees what you see. They can move away and come back.' },
  { mode: 'present', label: 'Present', about: "Everyone sees what you see and can't move away. Panels you open, open for them too." },
]

function NavigationControls() {
  const { status, navigation, setNavigation } = useRealtimeContext()
  const emit = useEmitEvent()
  const live = status === 'connected'
  const current = NAVIGATION_OPTIONS.find((option) => option.mode === navigation)

  return (
    <section className="realtime-section">
      <h3 className="realtime-heading">Navigation</h3>
      <div className="realtime-segmented" role="group" aria-label="Navigation">
        {NAVIGATION_OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            aria-pressed={navigation === option.mode}
            disabled={!live}
            className={`realtime-segment${navigation === option.mode ? ' realtime-segment--active' : ''}`}
            onClick={() => setNavigation(option.mode).catch(() => emit('session:error'))}
          >
            {option.label}
          </button>
        ))}
      </div>
      {current && <p className="realtime-note">{current.about}</p>}
    </section>
  )
}

// Panels the host can ask people to open - not the RealTime one.
const ASKABLE_PANELS: ToolId[] = ['annotations', 'cellcount', 'rotate', 'ruler', 'adjustments']

// The host asking everyone, or one person, to look where they are or open a
// panel. It's only asked - it comes up for them to say yes or no to.
function AskPeople() {
  const { status, others, askToLook, askToOpen } = useRealtimeContext()
  const emit = useEmitEvent()
  const [to, setTo] = useState('')
  if (others.length === 0) return null

  const live = status === 'connected'
  // Gone since it was picked - back to everyone.
  const target = others.some((p) => p.connectionId === to) ? [to] : null
  const send = (ask: Promise<void>) => ask.then(() => emit('request:sent')).catch(() => emit('request:error'))

  return (
    <section className="realtime-section">
      <h3 className="realtime-heading">Ask people to…</h3>
      <label className="realtime-field realtime-field--row">
        <span className="realtime-field-label">Who</span>
        <select value={target ? to : ''} onChange={(e) => setTo(e.target.value)}>
          <option value="">Everyone</option>
          {others.map((p) => (
            <option key={p.connectionId} value={p.connectionId}>
              {p.displayName}
            </option>
          ))}
        </select>
      </label>
      <div className="realtime-button-row">
        <button type="button" className="realtime-button" disabled={!live} onClick={() => send(askToLook(target))}>
          Look here
        </button>
        <select
          className="realtime-ask-open"
          aria-label="Open a tab"
          value=""
          disabled={!live}
          onChange={(e) => {
            if (e.target.value) send(askToOpen(target, e.target.value))
          }}
        >
          <option value="">Open a tab…</option>
          {ASKABLE_PANELS.map((panel) => (
            <option key={panel} value={panel}>
              {TOOL_NAMES[panel]}
            </option>
          ))}
        </select>
      </div>
    </section>
  )
}

// What the host has everyone doing, for people who joined.
function NavigationNote() {
  const { navigation } = useRealtimeContext()
  if (navigation === 'free') return null
  return (
    <p className="realtime-note">
      {navigation === 'present'
        ? "The host is presenting - you'll see what they see."
        : "The host has everyone following them - move the map to look round on your own, and Follow to go back."}
    </p>
  )
}

function Hosting({ session }: { session: Collection }) {
  const { endSession, refresh } = useCollectionContext()
  const emit = useEmitEvent()
  const tellEveryone = useTellEveryone()
  const [confirmingEnd, setConfirmingEnd] = useState(false)

  // Tell the room before refreshing - once it shows as ended, the room closes.
  const end = () =>
    endSession()
      .then(() => {
        tellEveryone()
        return refresh()
      })
      .catch(() => emit('session:error'))

  return (
    <>
      <section className="realtime-section realtime-section--tight">
        <SessionTitle session={session} editable />
        <LiveLine text={`Live · you're hosting · slide ${session.slideId}`} />
      </section>
      <SessionInvite />
      <PeopleList session={session} controls />
      <CountActivity />
      <NavigationControls />
      <AskPeople />
      {confirmingEnd ? (
        <div className="realtime-confirm">
          <p className="realtime-note">End it for everyone? Its link stops working and it becomes read-only.</p>
          <div className="realtime-button-row">
            <button type="button" className="realtime-button" onClick={() => setConfirmingEnd(false)}>
              Keep going
            </button>
            <button type="button" className="realtime-button realtime-button--danger" onClick={end}>
              End session
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="realtime-button realtime-button--danger realtime-button--wide" onClick={() => setConfirmingEnd(true)}>
          End session
        </button>
      )}
    </>
  )
}

function Joined({ session }: { session: Collection }) {
  const { leaveSession } = useCollectionContext()
  const host = session.members.find((m) => m.role === 'owner')

  return (
    <>
      <section className="realtime-section realtime-section--tight">
        <SessionTitle session={session} editable={false} />
        <LiveLine text={`Live · hosted by ${host?.displayName ?? 'someone'}`} />
        <span className="realtime-badge">{session.myRole === 'viewer' ? 'You can view' : 'You can edit'}</span>
      </section>
      <NavigationNote />
      <PeopleList session={session} controls={false} />
      <CountActivity />
      <button type="button" className="realtime-button realtime-button--wide" onClick={leaveSession}>
        Leave session
      </button>
    </>
  )
}

function Ended({ session }: { session: Collection }) {
  const { leaveSession } = useCollectionContext()
  return (
    <>
      <section className="realtime-section realtime-section--tight">
        <SessionTitle session={session} editable={false} />
        <p className="realtime-live">Ended {session.ended ? formatLongDate(session.ended) : ''} · read-only</p>
      </section>
      <PeopleList session={session} controls={false} />
      <button type="button" className="realtime-button realtime-button--wide" onClick={leaveSession}>
        Back to working on my own
      </button>
    </>
  )
}

// A session opened to look at because nobody was in it - read-only, with
// no room. The host can open it up again; anyone else can go back in once
// someone is.
function Dormant({ session }: { session: Collection }) {
  const { leaveSession, reopen } = useCollectionContext()
  const { busySessions } = usePresenceContext()
  const someoneIn = busySessions?.has(session.collectionId) ?? false
  const isHost = session.myRole === 'owner'
  const host = session.members.find((m) => m.role === 'owner')
  return (
    <>
      <section className="realtime-section realtime-section--tight">
        <SessionTitle session={session} editable={false} />
        <p className="realtime-live">{someoneIn ? "Someone's in it now" : "Nobody's in it · read-only"}</p>
      </section>
      <p className="realtime-note">
        {someoneIn
          ? 'Rejoin to work in it with them.'
          : isHost
            ? "You're looking at it without opening it up. Reopen it to work in it, or to let people back in."
            : `You're looking at it read-only. You can rejoin once ${host?.displayName ?? 'the host'} reopens it.`}
      </p>
      {(someoneIn || isHost) && (
        <button type="button" className="realtime-button realtime-button--accent realtime-button--wide" onClick={reopen}>
          {someoneIn ? 'Rejoin' : 'Reopen session'}
        </button>
      )}
      <PeopleList session={session} controls={false} />
      <button type="button" className="realtime-button realtime-button--wide" onClick={leaveSession}>
        Back to working on my own
      </button>
    </>
  )
}

function SignedIn() {
  const { user, signOut, switchUser } = useAuthContext()
  return (
    <section className="realtime-account">
      <p className="realtime-signed-in">
        Signed in as <strong>{user.name}</strong>
      </p>
      <div className="realtime-button-row">
        <button type="button" className="realtime-button" onClick={switchUser}>
          Switch user
        </button>
        <button type="button" className="realtime-button" onClick={signOut}>
          Sign out
        </button>
      </div>
    </section>
  )
}

type RealTimeTab = 'session' | 'users'

// Session: working alone, hosting a session, in someone else's, or looking
// back at one that's ended. Users: everyone with an account, online first. Both say who
// you're signed in as. The tab is kept here rather than in the toolbar's
// context - it's your own, so Present doesn't follow the host's.
function RealTimePanel() {
  const { status, session, dormant } = useCollectionContext()
  const { onlineCount } = usePresenceContext()
  const [tab, setTab] = useState<RealTimeTab>('session')

  let body
  if (tab === 'users') body = <UsersList />
  else if (status !== 'ready') body = <p className="realtime-note">Loading…</p>
  else if (!session) body = <WorkingAlone />
  else if (session.ended) body = <Ended session={session} />
  else if (dormant) body = <Dormant session={session} />
  else if (session.myRole === 'owner') body = <Hosting session={session} />
  else body = <Joined session={session} />

  return (
    <div className="realtime-panel-wrap">
      <div className="realtime-tabs" role="tablist" aria-label="Real-time">
        {(['session', 'users'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            className={`realtime-tab${tab === option ? ' realtime-tab--active' : ''}`}
            onClick={() => setTab(option)}
          >
            {option === 'session' ? 'Session' : `Users${onlineCount > 0 ? ` (${onlineCount} online)` : ''}`}
          </button>
        ))}
      </div>
      <div className="realtime-panel" role="tabpanel">
        {body}
        <SignedIn />
      </div>
    </div>
  )
}

export default RealTimePanel
