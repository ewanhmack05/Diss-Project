import { useAuthContext } from "../../context/AuthContext";
import { useMessagingContext } from "../../context/MessagingContext";
import { usePresenceContext } from "../../context/PresenceContext";
import Icon from "../../icons/Icon";
import chevronLeftSvg from "../../icons/chevron-left.svg?raw";
import chevronRightSvg from "../../icons/chevron-right.svg?raw";
import pencilSvg from "../../icons/pencil.svg?raw";
import peopleSvg from "../../icons/people.svg?raw";
import { censorText } from "../../textFilter";
import { initials } from "../collections/history/history";
import { formatShortDate } from "../saved/savedDates";
import { conversationName, previewOf } from "./messages";

interface ConversationListProps {
	// Just a rail of initials.
	collapsed: boolean;
	// Not somewhere too narrow to open it, like a side dock.
	canToggle: boolean;
	onToggle: () => void;
	onNew: () => void;
	selectedUserId: string | null;
	// Only while you're in a session.
	sessionName: string | null;
	sessionUnread: number;
	sessionSelected: boolean;
	onOpenSession: () => void;
}

function Unread({ count }: { count: number }) {
	if (count === 0) return null;
	return (
		<span className="messages-unread" aria-label={`${count} unread`}>
			{count}
		</span>
	);
}

// Your conversations, most recent first, with the session you're in kept at the
// bottom since that's a different thing from talking to one person.
function ConversationList({
	collapsed,
	canToggle,
	onToggle,
	onNew,
	selectedUserId,
	sessionName,
	sessionUnread,
	sessionSelected,
	onOpenSession,
}: ConversationListProps) {
	const { user } = useAuthContext();
	const { conversations, messageUser } = useMessagingContext();
	const { users } = usePresenceContext();

	return (
		<nav className="messages-side" aria-label="Conversations">
			<div className="messages-side-top">
				{!collapsed && <h3 className="messages-heading">Conversations ({conversations.length})</h3>}
				<button
					type="button"
					className="messages-icon-button messages-icon-button--accent"
					title="New message"
					aria-label="New message"
					onClick={onNew}
				>
					<Icon svg={pencilSvg} size={13} />
				</button>
				{canToggle && (
					<button
						type="button"
						className="messages-icon-button"
						title={collapsed ? "Show the list" : "Fold the list away"}
						aria-label={collapsed ? "Show the list" : "Fold the list away"}
						aria-expanded={!collapsed}
						onClick={onToggle}
					>
						<Icon svg={collapsed ? chevronRightSvg : chevronLeftSvg} size={12} />
					</button>
				)}
			</div>

			<ul className="messages-list">
				{conversations.length === 0 && !collapsed && (
					<li className="messages-note messages-side-note">Nothing yet. Start one with the pencil, or Message on the Users tab.</li>
				)}
				{conversations.map((conversation) => {
					const name = censorText(conversationName(conversation, users));
					return (
						<li key={conversation.id}>
							<button
								type="button"
								className="messages-row"
								aria-current={conversation.withUserId === selectedUserId ? "true" : undefined}
								aria-label={collapsed ? `${name}${conversation.unread > 0 ? `, ${conversation.unread} unread` : ""}` : undefined}
								title={collapsed ? name : undefined}
								onClick={() => conversation.withUserId && messageUser(conversation.withUserId)}
							>
								<span className="messages-avatar">{initials(name)}</span>
								{collapsed ? (
									<span className="messages-rail-unread">
										<Unread count={conversation.unread} />
									</span>
								) : (
									<span className="messages-row-text">
										<span className="messages-row-top">
											<span className={`messages-row-name${conversation.unread > 0 ? " messages-row-name--unread" : ""}`}>{name}</span>
											{conversation.lastMessage && <span className="messages-row-when">{formatShortDate(conversation.lastMessage.sent)}</span>}
											<Unread count={conversation.unread} />
										</span>
										<span className="messages-row-preview">{censorText(previewOf(conversation.lastMessage, user.id))}</span>
									</span>
								)}
							</button>
						</li>
					);
				})}
			</ul>

			{sessionName && (
				<button
					type="button"
					className="messages-row messages-row--session"
					aria-current={sessionSelected ? "true" : undefined}
					aria-label={collapsed ? `Session chat, ${sessionName}${sessionUnread > 0 ? `, ${sessionUnread} unread` : ""}` : undefined}
					title={collapsed ? `Session chat - ${sessionName}` : undefined}
					onClick={onOpenSession}
				>
					<span className="messages-avatar messages-avatar--session">
						<Icon svg={peopleSvg} size={13} />
					</span>
					{collapsed ? (
						<span className="messages-rail-unread">
							<Unread count={sessionUnread} />
						</span>
					) : (
						<span className="messages-row-text">
							<span className="messages-row-top">
								<span className={`messages-row-name${sessionUnread > 0 ? " messages-row-name--unread" : ""}`}>Session chat</span>
								<Unread count={sessionUnread} />
							</span>
							<span className="messages-row-preview">{sessionName}</span>
						</span>
					)}
				</button>
			)}
		</nav>
	);
}

export default ConversationList;
