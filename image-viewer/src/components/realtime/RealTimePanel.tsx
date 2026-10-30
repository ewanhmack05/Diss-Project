import { useState } from 'react'
import { useRealtimeContext } from '../../context/RealtimeContext'
import { pointerProps, useViewportsContext } from '../../context/ViewportsContext'
import { useCollectionContext, type Collection, type CollectionRole } from '../../context/CollectionContext'
import { useAuthContext } from '../../context/AuthContext'
import { useEmitEvent } from '../../context/EventContext'
import { TOOL_NAMES, useToolbarContext, type ToolId } from '../../context/ToolbarContext'
import CountInvites from '../cell-count/CountInvites'
import { InviteLink, InviteSettings } from './SessionInvite'
import UsersList from '../users/UsersList'
import JoinWithCode from '../users/JoinWithCode'
import { usePresenceContext } from '../../context/PresenceContext'
import { useComparisonContext } from '../../context/ComparisonContext'
import { useSharedCountContext } from '../../context/SharedCountContext'
import { formatLongDate } from '../saved/savedDates'
import type { NavigationMode } from './realtime'
import { LEAST_MAX_EDITORS, MOST_MAX_EDITORS, readMaxEditors, sessionSize } from './sessionSize'
import { EDIT_POLICY_CHOICES } from './editPolicy'
import { activeUsers, splitActive, type ActiveKind, type ActiveUser } from './activeUsers'
import InfoNote from '../info/InfoNote'
import './RealTimePanel.css'
import Icon from '../../icons/Icon'
import pencilSvg from '../../icons/pencil.svg?raw'

const ROLE_TEXT: Record<CollectionRole, string> = {
  owner: 'Host',
  editor: 'Can edit',
  viewer: 'Can view',
}

const CONNECTION_TEXT = {
  off: 'Collaboration is off',
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
  const size = sessionSize(session.members, session.maxEditors)

  const change = (action: Promise<void>) =>
    action.then(tellEveryone).catch(() => emit('session:error'))

  return (
    <section className="realtime-section">
      <h3 className="realtime-heading">
        Members ({session.members.length}) · {size.large ? 'large' : 'small'} session
      </h3>
      <p className="realtime-note">
        {size.editors} editing
        {size.full
          ? ' - anyone joining now comes in view only'
          : ` - the next ${size.maxEditors - size.editors} through an edit link can edit`}
      </p>
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

const ACTIVE_TEXT: Record<ActiveKind, string> = {
  host: 'Host',
  editor: 'Can edit',
  viewer: 'Can view',
  guest: 'Guest',
}

// Everyone in the session right now, from the hub - members who are
// connected, and guests, who aren't members so aren't in PeopleList. Hover
// someone to pick out where they're looking. The host can ask a guest to
// make an account, to be let edit.
function ActiveUsers({ controls }: { controls: boolean }) {
  const { me, others, status, askToEdit } = useRealtimeContext()
  const { pointedAt, pointAt } = useViewportsContext()
  const emit = useEmitEvent()
  const [asked, setAsked] = useState<Set<string>>(() => new Set())
  const users = activeUsers(me, others)
  // Still connecting, or the hub's away.
  if (users.length === 0) return <p className="realtime-note">Nobody's connected yet.</p>
  const { signedIn, guests } = splitActive(users)

  const ask = (user: ActiveUser) =>
    Promise.all(user.connectionIds.map(askToEdit))
      .then(() => {
        setAsked((current) => new Set(current).add(user.userId))
        emit('request:sent')
      })
      .catch(() => emit('request:error'))

  const row = (user: ActiveUser) => (
    <li
      key={user.userId}
      className={`realtime-person${pointedAt === user.userId && !user.me ? ' realtime-person--pointed' : ''}`}
      title={user.me ? undefined : `Show where ${user.name} is looking`}
      {...(user.me ? {} : pointerProps(user.userId, pointAt))}
    >
      <span className="realtime-active-colour" style={{ background: user.colour }} aria-hidden="true" />
      <span className="realtime-person-name">
        {user.name}
        {user.me && ' (you)'}
      </span>
      {user.kind !== 'guest' ? (
        <span className="realtime-person-role">{ACTIVE_TEXT[user.kind]}</span>
      ) : (
        controls && (
          <button
            type="button"
            className="realtime-button"
            disabled={status !== 'connected' || asked.has(user.userId)}
            aria-label={`Ask ${user.name} to make an account so they can edit`}
            onClick={() => ask(user)}
          >
            {asked.has(user.userId) ? 'Asked' : 'Ask to edit'}
          </button>
        )
      )}
    </li>
  )

  return (
    <>
      <section className="realtime-section">
        <h3 className="realtime-heading">Signed in ({signedIn.length})</h3>
        {signedIn.length > 0 ? (
          <ul className="realtime-people">{signedIn.map(row)}</ul>
        ) : (
          <p className="realtime-note">Nobody with an account is here right now.</p>
        )}
      </section>
      <section className="realtime-section">
        <h3 className="realtime-heading">
          Guests ({guests.length})
          <InfoNote label="About guests">
            <p>Anyone who opens the invite link without an account comes in here, under a name they type.</p>
            <p>They can only view, and their names go when they leave.</p>
          </InfoNote>
        </h3>
        {guests.length > 0 ? (
          <ul className="realtime-people">{guests.map(row)}</ul>
        ) : (
          <p className="realtime-note">No guests.</p>
        )}
      </section>
    </>
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
  const { collections, startSession, open, defaultMaxEditors, defaultEditPolicy } = useCollectionContext()
  const { user } = useAuthContext()
  const { activeTools, toggleTool } = useToolbarContext()
  const emit = useEmitEvent()
  const [starting, setStarting] = useState(false)
  // Typed, so it can be empty part way through changing it.
  const [maxText, setMaxText] = useState(() => String(defaultMaxEditors))
  const chosenMax = readMaxEditors(maxText)
  const [policy, setPolicy] = useState(defaultEditPolicy)
  const sessions = collections.filter((c) => c.kind === 'session').length
  // One per slide - the newest you host that hasn't ended. The list is newest first.
  const mine = collections.find((c) => c.kind === 'session' && !c.ended && c.ownerId === user.id)

  const start = () => {
    if (chosenMax === null) return
    setStarting(true)
    startSession(undefined, chosenMax, policy)
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
            <div className="realtime-field realtime-field--row">
              <span className="realtime-field-label">
                Editors through the link
                <InfoNote label="About editors through the link">
                  <p>
                    The first {chosenMax ?? 'few'} people through an edit link can edit, you included. Anyone after that
                    joins view only - you can still let them edit.
                  </p>
                </InfoNote>
              </span>
              <input
                type="number"
                aria-label="Editors through the link"
                inputMode="numeric"
                min={LEAST_MAX_EDITORS}
                max={MOST_MAX_EDITORS}
                step={1}
                value={maxText}
                aria-invalid={chosenMax === null}
                aria-describedby={chosenMax === null ? 'max-editors-note' : undefined}
                onChange={(e) => setMaxText(e.target.value)}
              />
            </div>
            {chosenMax === null && (
              <p id="max-editors-note" className="realtime-note realtime-note--warning">
                {`A whole number from ${LEAST_MAX_EDITORS} to ${MOST_MAX_EDITORS}.`}
              </p>
            )}
            <div className="realtime-field">
              <span className="realtime-field-label">
                When two people change the same thing
                <InfoNote label="About when two people change the same thing">
                  <PolicyChoices />
                </InfoNote>
              </span>
              <div className="realtime-segmented" role="group" aria-label="When two people change the same thing">
                {EDIT_POLICY_CHOICES.map((choice) => (
                  <button
                    key={choice.policy}
                    type="button"
                    aria-pressed={policy === choice.policy}
                    className={`realtime-segment${policy === choice.policy ? ' realtime-segment--active' : ''}`}
                    onClick={() => setPolicy(choice.policy)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="realtime-note">Neither can change once the session's started.</p>
            <button
              type="button"
              className="realtime-button realtime-button--accent realtime-button--wide"
              disabled={starting || chosenMax === null}
              onClick={start}
            >
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
          <Icon svg={pencilSvg} size={14} />
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

  return (
    <section className="realtime-section">
      <h3 className="realtime-heading">
        Navigation
        <InfoNote label="About navigation">
          <dl>
            {NAVIGATION_OPTIONS.map((option) => (
              <div key={option.mode}>
                <dt>{option.label}</dt>
                <dd>{option.about}</dd>
              </div>
            ))}
          </dl>
        </InfoNote>
      </h3>
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

// Both edit policies, for the (i) beside the choice.
function PolicyChoices() {
  return (
    <>
      <dl>
        {EDIT_POLICY_CHOICES.map((choice) => (
          <div key={choice.policy}>
            <dt>{choice.label}</dt>
            <dd>{choice.note}</dd>
          </div>
        ))}
      </dl>
      <p>Labels and notes are typed together either way, so nothing typed is lost.</p>
    </>
  )
}

// The host's, while the session's live: the link's settings, and what was
// fixed when it started.
function SessionSettings({ session }: { session: Collection }) {
  const policy = EDIT_POLICY_CHOICES.find((c) => c.policy === session.editPolicy)
  return (
    <>
      <InviteSettings />
      <section className="realtime-section">
        <h3 className="realtime-heading">Session</h3>
        <div className="realtime-field realtime-field--row">
          <span className="realtime-field-label">
            Editors through the link
            <InfoNote label="About editors through the link">
              <p>
                The first {session.maxEditors} people through an edit link can edit, you included. Anyone after that
                joins view only - you can still let them edit from Active.
              </p>
            </InfoNote>
          </span>
          <span>{session.maxEditors}</span>
        </div>
        <div className="realtime-field realtime-field--row">
          <span className="realtime-field-label">
            When two people change the same thing
            <InfoNote label="About when two people change the same thing">
              <PolicyChoices />
            </InfoNote>
          </span>
          <span>{policy?.label}</span>
        </div>
        <p className="realtime-note">Picked when the session started - start a new one for different ones.</p>
      </section>
    </>
  )
}

// Everyone in the session: asking people to do something (the host), who's
// here right now, and every member with what they can do.
function ActiveTab({ session }: { session: Collection | null }) {
  const host = session?.myRole === 'owner'
  return (
    <>
      {host && <AskPeople />}
      <ActiveUsers controls={host} />
      {session && <PeopleList session={session} controls={host} />}
    </>
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

// The host's quick controls - the link, navigation and ending it. Who the
// link lets in and the session's rules are in Settings; people are in Active.
function Hosting({ session, openSettings }: { session: Collection; openSettings: () => void }) {
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
      <InviteLink onChange={openSettings} />
      <CountActivity />
      <NavigationControls />
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
  const { user, signIn } = useAuthContext()
  const host = session.members.find((m) => m.role === 'owner')

  return (
    <>
      <section className="realtime-section realtime-section--tight">
        <SessionTitle session={session} editable={false} />
        <LiveLine text={`Live · hosted by ${host?.displayName ?? 'someone'}`} />
        <span className="realtime-badge">
          {user.guest ? "You're a guest - you can view" : session.myRole === 'viewer' ? 'You can view' : 'You can edit'}
        </span>
      </section>
      {user.guest && (
        <section className="realtime-section">
          <p className="realtime-note">
            To add or change anything you need an account. Make one, or sign in, and you'll come back to this
            session - then ask {host?.displayName ?? 'the host'} to let you edit.
          </p>
          <button type="button" className="realtime-button realtime-button--accent realtime-button--wide" onClick={() => signIn(true)}>
            Make an account
          </button>
        </section>
      )}
      <NavigationNote />
      <CountActivity />
      <button type="button" className="realtime-button realtime-button--wide" onClick={leaveSession}>
        Leave session
      </button>
    </>
  )
}

function Ended({ session }: { session: Collection }) {
  const { leaveSession } = useCollectionContext()
  const { user } = useAuthContext()
  return (
    <>
      <section className="realtime-section realtime-section--tight">
        <SessionTitle session={session} editable={false} />
        <p className="realtime-live">Ended {session.ended ? formatLongDate(session.ended) : ''} · read-only</p>
      </section>
      <PeopleList session={session} controls={false} />
      <button type="button" className="realtime-button realtime-button--wide" onClick={leaveSession}>
        {user.guest ? 'Leave' : 'Back to working on my own'}
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

// The host deleted the session a guest was in - there's nothing else here for them.
function GuestSessionGone() {
  const { signOut } = useAuthContext()
  return (
    <>
      <p className="realtime-note">This session isn't there any more.</p>
      <button type="button" className="realtime-button realtime-button--wide" onClick={signOut}>
        Leave
      </button>
    </>
  )
}

function SignedIn() {
  const { user, signOut, switchUser, signIn } = useAuthContext()
  if (user.guest) {
    return (
      <section className="realtime-account">
        <p className="realtime-signed-in">
          Here as a guest - <strong>{user.name}</strong>
        </p>
        <div className="realtime-button-row">
          <button type="button" className="realtime-button" onClick={() => signIn(false)}>
            Sign in
          </button>
          <button type="button" className="realtime-button" onClick={signOut}>
            Leave
          </button>
        </div>
      </section>
    )
  }
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

type RealTimeTab = 'session' | 'active' | 'users' | 'settings'

// Session: working alone, hosting a session, in someone else's, or looking
// back at one that's ended. Active: who's in the session right now, guests
// included - only while you're in one. Users: everyone with an account,
// online first. Settings: the host's link and the session's rules, only
// while it's live. All say who you're signed in as. The tab is kept here rather
// than in the toolbar's context - it's your own, so Present doesn't follow
// the host's.
function RealTimePanel() {
  const { status, session, dormant, roomId } = useCollectionContext()
  const { onlineCount } = usePresenceContext()
  const { me, others } = useRealtimeContext()
  const { user } = useAuthContext()
  const [picked, setPicked] = useState<RealTimeTab>('session')
  const inSession = !!roomId
  const activeCount = inSession ? activeUsers(me, others).length : 0
  const hosting = inSession && !!session && session.myRole === 'owner' && !session.ended && !dormant
  // Users is everyone with an account - nothing a guest can use.
  const tabs: RealTimeTab[] = [
    'session',
    ...(inSession ? (['active'] as const) : []),
    ...(user.guest ? [] : (['users'] as const)),
    ...(hosting ? (['settings'] as const) : []),
  ]
  // Out of the session with Active picked - back to Session, and Active
  // again if they go back in.
  const tab = tabs.includes(picked) ? picked : 'session'

  const label = (option: RealTimeTab) =>
    option === 'session'
      ? 'Session'
      : option === 'active'
        ? `Active${activeCount > 0 ? ` (${activeCount})` : ''}`
        : option === 'settings'
          ? 'Settings'
          : `Users${onlineCount > 0 ? ` (${onlineCount} online)` : ''}`

  let body
  if (tab === 'users') body = <UsersList />
  else if (tab === 'active') body = <ActiveTab session={session} />
  else if (tab === 'settings' && session) body = <SessionSettings session={session} />
  else if (status !== 'ready') body = <p className="realtime-note">Loading…</p>
  else if (!session && user.guest) body = <GuestSessionGone />
  else if (!session) body = <WorkingAlone />
  else if (session.ended) body = <Ended session={session} />
  else if (dormant) body = <Dormant session={session} />
  else if (session.myRole === 'owner') body = <Hosting session={session} openSettings={() => setPicked('settings')} />
  else body = <Joined session={session} />

  return (
    <div className="realtime-panel-wrap">
      <div className="realtime-tabs" role="tablist" aria-label="Collaboration">
        {tabs.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            className={`realtime-tab${tab === option ? ' realtime-tab--active' : ''}`}
            onClick={() => setPicked(option)}
          >
            {label(option)}
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
