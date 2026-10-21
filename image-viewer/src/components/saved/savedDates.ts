// Dates for the saved lists - short on the row ("30 Sep", with the year
// only when it isn't this year), with the time when a row is opened.

function toDate(iso: string): Date | null {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : date;
}

function formatShortDate(iso: string, now: Date = new Date()): string {
	const date = toDate(iso);
	if (!date) return "";
	return date.toLocaleDateString("en-GB", {
		day: "numeric",
		month: "short",
		...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
	});
}

function formatLongDate(iso: string): string {
	const date = toDate(iso);
	if (!date) return "Unknown";
	const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
	const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
	return `${day}, ${time}`;
}

// The History list's day headings - Today, Yesterday, then the short date.
function dayHeading(iso: string, now: Date = new Date()): string {
	const date = toDate(iso);
	if (!date) return "Unknown";
	const sameDay = (a: Date, b: Date) =>
		a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
	if (sameDay(date, now)) return "Today";
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (sameDay(date, yesterday)) return "Yesterday";
	return formatShortDate(iso, now);
}

// Just the clock time, for a row under a day heading.
function formatTime(iso: string): string {
	const date = toDate(iso);
	return date ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
}

// Everything, to the second - for one change opened up.
function formatFullDate(iso: string): string {
	const date = toDate(iso);
	if (!date) return "Unknown";
	const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
	const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
	const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
	return `${weekday} ${day}, ${time}`;
}

// "12 minutes ago". Worked out when it's shown, so it isn't kept up to date.
function timeAgo(iso: string, now: Date = new Date()): string {
	const date = toDate(iso);
	if (!date) return "";
	const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
	const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
	if (minutes < 1) return "Just now";
	if (minutes < 60) return ago(minutes, "minute");
	if (minutes < 24 * 60) return ago(Math.floor(minutes / 60), "hour");
	return ago(Math.floor(minutes / (24 * 60)), "day");
}

// Newest first, by `created`. The server sends them in this order too, but
// anything saved since (yours or someone else's, live) is added to the end
// of the list, so the lists sort for themselves. Unreadable dates go last.
function newestFirst<T extends { created: string }>(items: T[]): T[] {
	const time = (item: T) => toDate(item.created)?.getTime() ?? -Infinity;
	return [...items].sort((a, b) => time(b) - time(a));
}

export { formatShortDate, formatLongDate, dayHeading, formatTime, formatFullDate, timeAgo, newestFirst };
