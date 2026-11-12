import { useState } from "react";
import { usePresenceContext } from "../../context/PresenceContext";
import { useCollectionContext } from "../../context/CollectionContext";
import { useImageViewerContext } from "../../context/ImageViewerContext";
import { useEmitEvent } from "../../context/EventContext";
import { useMessagingContext } from "../../context/MessagingContext";
import { newId } from "../../newId";
import { useSentThings } from "../messages/useSentThings";
import { describeUser, whyCantInvite, type ListedUser } from "./presence";
import "./Users.css";

const STATUS_TEXT = {
	off: "Collaboration is off, so nobody's online status can be seen.",
	connecting: "Connecting…",
	offline: "Can't reach the real-time hub - trying again.",
} as const;

// Everyone with an account in Keycloak - who's online now, with what they're
// doing, then everyone else. The host can invite any of them, which opens your
// conversation with them and sends the session's invite there. It waits in their
// messages, so they can be offline, and nothing pops up on them.
function UsersList() {
	const { status, users, onlineCount, everyoneLoaded } = usePresenceContext();
	const { session } = useCollectionContext();
	const { source, moveToSlide } = useImageViewerContext();
	const emit = useEmitEvent();
	const { status: messaging, messageUser, send } = useMessagingContext();
	const { inviteFor } = useSentThings();
	const [sending, setSending] = useState<string | null>(null);
	// Who's been asked into which session, so the button says so.
	const [asked, setAsked] = useState<{ sessionId: string | null; userIds: string[] }>({ sessionId: null, userIds: [] });

	const live = session && !session.ended ? session : null;
	const me = {
		slideId: source.slideId,
		sessionId: live?.collectionId ?? null,
		hosting: live?.myRole === "owner",
	};
	const askedHere = asked.sessionId === me.sessionId ? asked.userIds : [];
	const online = users.filter((u) => u.online);
	const offline = users.filter((u) => !u.online);

	// Not through the box you write in, so nothing half written goes with it.
	const invite = async (person: ListedUser) => {
		setSending(person.userId);
		messageUser(person.userId);
		try {
			await send({ kind: "direct", userId: person.userId }, { id: newId(), body: "", attachment: await inviteFor() });
			setAsked({ sessionId: me.sessionId, userIds: [...askedHere, person.userId] });
			emit("user:invited", { userId: person.userId });
		} catch {
			emit("user:invite-error", { userId: person.userId });
		} finally {
			setSending(null);
		}
	};

	const row = (person: ListedUser) => {
		const why = whyCantInvite(person.online, me);
		const joined = !!me.sessionId && person.online?.sessionId === me.sessionId;
		const wasAsked = askedHere.includes(person.userId);
		const theirSlide = person.online?.slideId;
		const elsewhere = !!theirSlide && theirSlide !== source.slideId;
		return (
			<li key={person.userId} className="realtime-person users-person" title={person.userId}>
				<span className={`realtime-presence${person.online ? " realtime-presence--here" : ""}`} aria-label={person.online ? "Online" : "Offline"} />
				<span className="users-about">
					<span className={`realtime-person-name${person.online ? "" : " realtime-person-name--away"}`}>{person.displayName || person.userId}</span>
					<span className="users-where">{describeUser(person.online, me)}</span>
				</span>
				{elsewhere && (
					<button
						type="button"
						className="realtime-button"
						aria-label={`Open slide ${theirSlide}, where ${person.displayName} is`}
						onClick={() => void moveToSlide(theirSlide!)}
					>
						Go there
					</button>
				)}
				{messaging !== "off" && (
					<button type="button" className="realtime-button" aria-label={`Message ${person.displayName}`} onClick={() => messageUser(person.userId)}>
						Message
					</button>
				)}
				{me.hosting && messaging !== "off" && (
					<button
						type="button"
						className="realtime-button"
						disabled={!!why || sending === person.userId}
						title={why ?? undefined}
						aria-label={`Invite ${person.displayName} to your session`}
						onClick={() => invite(person)}
					>
						{sending === person.userId ? "Sending…" : joined ? "Joined" : wasAsked ? "Ask again" : "Invite"}
					</button>
				)}
			</li>
		);
	};

	return (
		<>
			<section className="realtime-section">
				<h3 className="realtime-heading">Online now ({onlineCount})</h3>
				{status !== "connected" && <p className="realtime-note">{STATUS_TEXT[status]}</p>}
				{status === "connected" && online.length === 0 && <p className="realtime-note">Nobody else is online right now.</p>}
				{online.length > 0 && <ul className="realtime-people">{online.map(row)}</ul>}
			</section>

			{offline.length > 0 && (
				<section className="realtime-section">
					<h3 className="realtime-heading">Offline ({offline.length})</h3>
					<ul className="realtime-people">{offline.map(row)}</ul>
				</section>
			)}
			{status === "connected" && !everyoneLoaded && (
				<p className="realtime-note">Couldn't load everyone from Keycloak - only showing who's online.</p>
			)}
			{users.length > 0 && me.hosting && messaging !== "off" && (
				<p className="realtime-note">
					Invite sends your session's invite as a message, for them to look at first. With no working invite, one is made that lets them edit for 24
					hours.
				</p>
			)}
		</>
	);
}

export default UsersList;
