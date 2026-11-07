import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
	problemText,
	totalUnread,
	type Attachment,
	type ChatTarget,
	type Conversation,
	type Message,
	type SendMessage,
	type Staged,
} from "../components/messages/messages";
import type { ShownArea } from "../components/messages/sentArea";
import { useAuthContext } from "./AuthContext";
import { useCollectionContext } from "./CollectionContext";
import { useEmitEvent } from "./EventContext";
import { usePresenceContext } from "./PresenceContext";
import { useRealtimeContext } from "./RealtimeContext";
import { useToastContext } from "./ToastContext";
import { useToolbarContext } from "./ToolbarContext";

// off - a guest, who can't use any of it.
type MessagingStatus = "off" | "loading" | "ready" | "error";

interface MessageWaitingNote {
	conversationId: string;
	messageId: string;
}

interface MessagingContextValue {
	status: MessagingStatus;
	// Your direct conversations, most recent first.
	conversations: Conversation[];
	// The chat of the session you're in, if you're in one.
	sessionChat: Conversation | null;
	// Couldn't be had, while messaging itself is fine - usually annotation-store
	// being away, so nobody can say you're in the session.
	sessionChatProblem: string | null;
	unread: number;
	// Who the Messages tab has open, if anyone.
	openUserId: string | null;
	// Goes up each time someone's asked for, even the one already open, so the
	// panel can come back to them from its Session tab.
	openRequests: number;
	// Opens the tab on them, from anywhere - the Users tab uses it.
	messageUser: (userId: string) => void;
	closeConversation: () => void;
	// The last thing the hub said was waiting, for whatever's on screen to fetch.
	lastWaiting: MessageWaitingNote | null;
	// Something sent that's being looked at on the map, not saved anywhere.
	shownArea: ShownArea | null;
	showArea: (area: ShownArea | null) => void;
	// The list folded down to a rail. Kept here so it's as you left it when the
	// panel's opened again.
	sideCollapsed: boolean;
	// Something being sent from where it's saved: opens the tab to ask who to.
	pendingSend: Staged | null;
	sendToSomeone: (staged: Staged) => void;
	// Clears it, answering what it was.
	takePendingSend: () => Staged | null;
	setSideCollapsed: (collapsed: boolean) => void;
	refresh: () => Promise<void>;
	loadMessages: (conversationId: string, skip: number, take: number) => Promise<{ messages: Message[]; total: number }>;
	// Saved, then tells the hub. Rejects with what to show.
	send: (target: ChatTarget, message: SendMessage) => Promise<Message>;
	markRead: (conversationId: string) => Promise<void>;
	deleteConversation: (conversationId: string) => Promise<void>;
	loadAttachment: (messageId: string) => Promise<Attachment & { payload: unknown }>;
	markAdded: (messageId: string) => Promise<Attachment>;
}

const MessagingContext = createContext<MessagingContextValue | null>(null);

// messaging answers with a JSON string or a plain one, depending on the error.
async function detailOf(response: Response): Promise<string> {
	const text = await response.text().catch(() => "");
	try {
		const parsed = JSON.parse(text);
		return typeof parsed === "string" ? parsed : (parsed?.detail ?? parsed?.title ?? "");
	} catch {
		return text;
	}
}

// Conversations and messages from messaging, and who's told what's new. It only
// holds messages - what's sent is read from annotation-store and what's received
// is added to it, each with your own token. Nothing else depends on this, so if
// messaging's away the Messages tab says so and everything else carries on.
function MessagingContextProvider({ baseUrl, children }: { baseUrl?: string; children: ReactNode }) {
	const { authFetch, user } = useAuthContext();
	const { session } = useCollectionContext();
	const { status: presenceStatus, notifyUser, onMessageWaiting: onPresenceWaiting } = usePresenceContext();
	const { notifySession, onMessageWaiting: onRoomWaiting } = useRealtimeContext();
	const { openTool, activeTools } = useToolbarContext();
	const { addToast } = useToastContext();
	const emit = useEmitEvent();
	const enabled = !!baseUrl && !user.guest;
	const sessionId = session?.collectionId ?? null;

	const [status, setStatus] = useState<Exclude<MessagingStatus, "off">>("loading");
	const [conversations, setConversations] = useState<Conversation[]>([]);
	const [sessionChat, setSessionChat] = useState<Conversation | null>(null);
	const [sessionChatProblem, setSessionChatProblem] = useState<string | null>(null);
	const [openUserId, setOpenUserId] = useState<string | null>(null);
	const [openRequests, setOpenRequests] = useState(0);
	const [lastWaiting, setLastWaiting] = useState<MessageWaitingNote | null>(null);
	const [shownArea, showArea] = useState<ShownArea | null>(null);
	const [sideCollapsed, setSideCollapsed] = useState(false);
	const [pendingSend, setPendingSend] = useState<Staged | null>(null);

	const call = useCallback(
		async (path: string, init?: RequestInit) => {
			let response: Response;
			try {
				response = await authFetch(`${baseUrl}${path}`, init);
			} catch {
				throw new Error(problemText(0, ""));
			}
			if (!response.ok) throw new Error(problemText(response.status, await detailOf(response)));
			return response;
		},
		[authFetch, baseUrl],
	);

	// Only the latest answer counts, since an older one can come back after it.
	const latestLoad = useRef(0);
	const load = useCallback(async () => {
		if (!enabled) return null;
		const thisLoad = ++latestLoad.current;
		const direct = call("/conversations").then((r) => r.json() as Promise<Conversation[]>);
		const chat = sessionId
			? call(`/sessions/${sessionId}/conversation`)
					.then(async (r) => ({ chat: (await r.json()) as Conversation | null, problem: null as string | null }))
					.catch((error: Error) => ({ chat: null as Conversation | null, problem: error.message }))
			: Promise.resolve({ chat: null as Conversation | null, problem: null as string | null });
		try {
			const [list, session] = await Promise.all([direct, chat]);
			if (thisLoad !== latestLoad.current) return null;
			setConversations(list);
			setSessionChat(session.chat);
			setSessionChatProblem(session.problem);
			setStatus("ready");
			return { list, chat: session.chat };
		} catch {
			if (thisLoad === latestLoad.current) setStatus("error");
			return null;
		}
	}, [enabled, call, sessionId]);

	const refresh = useCallback(async () => {
		await load();
	}, [load]);

	// On starting, on moving session, and on getting back to the hub - anything
	// said while it was away was missed.
	useEffect(() => {
		if (presenceStatus === "connecting") return;
		load();
	}, [load, presenceStatus]);

	// Read from the hub's handlers, which shouldn't be set up again as these change.
	const watching = useRef({ messagesOpen: activeTools.includes("messages"), myId: user.id });
	useEffect(() => {
		watching.current = { messagesOpen: activeTools.includes("messages"), myId: user.id };
	});

	useEffect(() => {
		if (!enabled) return;
		const heard = async (waiting: MessageWaitingNote) => {
			setLastWaiting(waiting);
			const loaded = await load();
			if (!loaded) return;
			const conversation = [...loaded.list, ...(loaded.chat ? [loaded.chat] : [])].find((c) => c.id === waiting.conversationId);
			const last = conversation?.lastMessage;
			const { messagesOpen, myId } = watching.current;
			if (last && last.fromUserId !== myId && !messagesOpen) addToast(`New message from ${last.fromName}`, "success");
			emit("message:received", { conversationId: waiting.conversationId, messageId: waiting.messageId });
		};
		const stopPresence = onPresenceWaiting(heard);
		const stopRoom = onRoomWaiting(heard);
		return () => {
			stopPresence();
			stopRoom();
		};
	}, [enabled, load, addToast, emit, onPresenceWaiting, onRoomWaiting]);

	const messageUser = useCallback(
		(userId: string) => {
			setOpenUserId(userId);
			setOpenRequests((n) => n + 1);
			openTool("messages");
		},
		[openTool],
	);

	const sendToSomeone = useCallback(
		(staged: Staged) => {
			setPendingSend(staged);
			openTool("messages");
		},
		[openTool],
	);

	const takePendingSend = useCallback(() => {
		const taken = pendingSend;
		setPendingSend(null);
		return taken;
	}, [pendingSend]);

	const closeConversation = useCallback(() => setOpenUserId(null), []);

	const loadMessages = useCallback(
		async (conversationId: string, skip: number, take: number) =>
			(await call(`/conversations/${conversationId}/messages?skip=${skip}&take=${take}`)).json() as Promise<{ messages: Message[]; total: number }>,
		[call],
	);

	const send = useCallback(
		async (target: ChatTarget, message: SendMessage) => {
			const body = {
				...message,
				...(target.kind === "direct" ? { toUserId: target.userId } : { sessionId: target.sessionId }),
			};
			const response = await call("/messages", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const saved = (await response.json()) as Message;
			// Saved, so a hub that's away only means they find it on their next load.
			const tell =
				target.kind === "direct" ? notifyUser(target.userId, saved.conversationId, saved.id) : notifySession(saved.conversationId, saved.id);
			tell.catch(() => {});
			emit("message:sent", { conversationId: saved.conversationId, kind: saved.attachment?.kind ?? "text" });
			await load();
			return saved;
		},
		[call, load, emit, notifyUser, notifySession],
	);

	const markRead = useCallback(
		async (conversationId: string) => {
			await call(`/conversations/${conversationId}/read`, { method: "POST" });
			await load();
		},
		[call, load],
	);

	const deleteConversation = useCallback(
		async (conversationId: string) => {
			await call(`/conversations/${conversationId}`, { method: "DELETE" });
			await load();
		},
		[call, load],
	);

	const loadAttachment = useCallback(
		async (messageId: string) => (await call(`/messages/${messageId}/attachment`)).json() as Promise<Attachment & { payload: unknown }>,
		[call],
	);

	const markAdded = useCallback(
		async (messageId: string) => (await call(`/messages/${messageId}/added`, { method: "POST" })).json() as Promise<Attachment>,
		[call],
	);

	const value = useMemo(
		() => ({
			status: enabled ? status : ("off" as const),
			conversations,
			sessionChat,
			sessionChatProblem,
			unread: totalUnread(conversations, sessionChat),
			openUserId,
			openRequests,
			messageUser,
			closeConversation,
			lastWaiting,
			shownArea,
			showArea,
			sideCollapsed,
			setSideCollapsed,
			pendingSend,
			sendToSomeone,
			takePendingSend,
			refresh,
			loadMessages,
			send,
			markRead,
			deleteConversation,
			loadAttachment,
			markAdded,
		}),
		[
			enabled,
			status,
			conversations,
			sessionChat,
			sessionChatProblem,
			openUserId,
			openRequests,
			messageUser,
			closeConversation,
			lastWaiting,
			shownArea,
			sideCollapsed,
			pendingSend,
			sendToSomeone,
			takePendingSend,
			refresh,
			loadMessages,
			send,
			markRead,
			deleteConversation,
			loadAttachment,
			markAdded,
		],
	);

	return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>;
}

function useMessagingContext(): MessagingContextValue {
	const context = useContext(MessagingContext);
	if (!context) {
		throw new Error("useMessagingContext must be used within a MessagingContextProvider");
	}
	return context;
}

export { MessagingContextProvider, useMessagingContext };
export type { MessageWaitingNote };
