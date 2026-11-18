import type { Collection } from "../../../context/CollectionContext";
import { formatLongDate } from "../../saved/savedDates";

// What a session's chat had in it. Unknown when messaging couldn't say, which
// counts as something - it's only dropped when we know it's empty.
type ChatSaid = "nothing" | "something" | "unknown";

// Nothing to look back at: nothing drawn or counted, nobody else still in it,
// and nothing said in its chat. Ending one like that deletes it rather than
// keeping an empty row about forever. Anyone who joined and drew left their
// annotations behind, so the counts cover them.
function nothingToKeep(session: Collection, chat: ChatSaid): boolean {
	return (
		session.kind === "session" &&
		session.annotationCount === 0 &&
		session.cellCountCount === 0 &&
		session.members.length <= 1 &&
		chat === "nothing"
	);
}

// The viewer names a new session, not annotation-store, since only it knows
// your clock - "Bob Hughes's session, 17 Nov 14:05". Rename it any time.
function defaultSessionName(hostName: string, now: Date = new Date()): string {
	const day = now.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
	const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
	const whose = hostName.trim() ? `${hostName.trim()}'s` : "Your";
	return `${whose} session, ${day} ${time}`;
}

// Live ones as they come (annotation-store sends the newest first), then
// ended ones by when they ended, latest first.
function splitSessions(sessions: Collection[]): { live: Collection[]; ended: Collection[] } {
	const live = sessions.filter((s) => !s.ended);
	const ended = sessions.filter((s) => !!s.ended).sort((a, b) => Date.parse(b.ended ?? "") - Date.parse(a.ended ?? ""));
	return { live, ended };
}

// When it started or ended, and how many are in it - a row's second line.
function sessionWhen(session: Collection): string {
	const people = `${session.members.length} ${session.members.length === 1 ? "person" : "people"}`;
	const when = session.ended ? `Ended ${formatLongDate(session.ended)}` : `Started ${formatLongDate(session.created)}`;
	return `${when} · ${people}`;
}

export { defaultSessionName, nothingToKeep, sessionWhen, splitSessions };
export type { ChatSaid };
