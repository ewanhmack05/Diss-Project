import { useEffect, useRef, useState } from "react";
import { useCollectionContext } from "../../context/CollectionContext";
import { useMessagingContext } from "../../context/MessagingContext";
import { usePresenceContext } from "../../context/PresenceContext";
import { censorText } from "../../textFilter";
import ConversationList from "./ConversationList";
import ConversationView from "./ConversationView";
import PeoplePicker from "./PeoplePicker";
import { conversationName, isCramped } from "./messages";
import "./MessagesPanel.css";

// An inbox: your conversations down the side, with the session you're in at the
// bottom of them, and whichever's open beside it. The side folds down to a rail
// of initials so the panel covers less of the slide.
function MessagesPanel() {
	const {
		status,
		conversations,
		sessionChat,
		sessionChatProblem,
		openUserId,
		openRequests,
		closeConversation,
		refresh,
		showArea,
		sideCollapsed,
		setSideCollapsed,
		pendingSend,
		takePendingSend,
	} = useMessagingContext();
	const { session } = useCollectionContext();
	const { users } = usePresenceContext();
	const [wantsSession, setWantsSession] = useState(false);
	const [picking, setPicking] = useState(false);
	const [cramped, setCramped] = useState(false);
	// The thing being sent that's been told who to, so the thread can take it.
	const [placed, setPlaced] = useState<typeof pendingSend>(null);
	const askingWho = !!pendingSend && placed !== pendingSend;
	const inboxRef = useRef<HTMLDivElement>(null);
	const showingSession = wantsSession && !!session;

	// Message on the Users tab lands on them, whatever was open.
	useEffect(() => {
		if (openRequests === 0) return;
		setWantsSession(false);
		setPicking(false);
	}, [openRequests]);

	// Catches up on opening, in case the hub was away for anything.
	useEffect(() => {
		refresh();
	}, [refresh]);

	// What's being shown goes with the panel, so nothing's left on the map that
	// there's no button to take off.
	useEffect(() => () => showArea(null), [showArea]);

	// A side dock is only 20em, so there it stays a rail whatever you last chose.
	useEffect(() => {
		const inbox = inboxRef.current;
		if (!inbox || typeof ResizeObserver === "undefined") return;
		const check = () => {
			const docked = !!inbox.closest(".draggable-panel--docked");
			setCramped(isCramped(docked, inbox.clientWidth, parseFloat(getComputedStyle(inbox).fontSize)));
		};
		check();
		const observer = new ResizeObserver(check);
		observer.observe(inbox);
		return () => observer.disconnect();
	}, [status]);

	if (status === "off") {
		return <p className="messages-note messages-alone">Messages are for people with an account.</p>;
	}
	if (status === "error") {
		return (
			<p className="messages-note messages-alone">Can't reach messaging. Everything else still works - trying again when you come back to this.</p>
		);
	}
	if (status === "loading") {
		return <p className="messages-note messages-alone">Loading…</p>;
	}

	const openConversation = openUserId ? (conversations.find((c) => c.withUserId === openUserId) ?? null) : null;
	const openName = openUserId
		? censorText(openConversation ? conversationName(openConversation, users) : users.find((u) => u.userId === openUserId)?.displayName || "Someone")
		: "";

	let thread;
	if (askingWho) {
		thread = (
			<PeoplePicker
				sending={pendingSend.label}
				sessionName={session && !session.ended ? censorText(session.collectionName) : null}
				onSession={() => {
					setPlaced(pendingSend);
					setWantsSession(true);
					setPicking(false);
				}}
				onPicked={() => setPlaced(pendingSend)}
				onCancel={() => takePendingSend()}
			/>
		);
	} else if (picking) {
		thread = <PeoplePicker onCancel={() => setPicking(false)} />;
	} else if (showingSession) {
		thread = sessionChat ? (
			<ConversationView
				key={sessionChat.id}
				target={{ kind: "session", sessionId: session.collectionId }}
				conversation={sessionChat}
				title={censorText(session.collectionName)}
				readOnlyNote={session.ended ? "This session's ended, so its chat is read only." : undefined}
				canDelete={session.myRole === "owner"}
				deleteLabel="Delete this session's chat"
			/>
		) : (
			<p className="messages-note messages-alone">{sessionChatProblem ?? "Loading…"}</p>
		);
	} else if (openUserId) {
		thread = (
			<ConversationView
				key={openUserId}
				target={{ kind: "direct", userId: openUserId }}
				conversation={openConversation}
				title={openName}
				canDelete
				deleteLabel={`Delete your conversation with ${openName}`}
				onDeleted={closeConversation}
			/>
		);
	} else {
		thread = <p className="messages-note messages-alone">Pick a conversation, or start a new one.</p>;
	}

	const collapsed = sideCollapsed || cramped;
	return (
		<div ref={inboxRef} className={`messages-inbox${collapsed ? " messages-inbox--collapsed" : ""}`}>
			<ConversationList
				collapsed={collapsed}
				canToggle={!cramped}
				onToggle={() => setSideCollapsed(!sideCollapsed)}
				onNew={() => setPicking(true)}
				selectedUserId={askingWho || picking || showingSession ? null : openUserId}
				sessionName={session ? censorText(session.collectionName) : null}
				sessionUnread={sessionChat?.unread ?? 0}
				sessionSelected={showingSession && !picking && !askingWho}
				onOpenSession={() => {
					setWantsSession(true);
					setPicking(false);
				}}
			/>
			<div className="messages-thread">{thread}</div>
		</div>
	);
}

export default MessagesPanel;
