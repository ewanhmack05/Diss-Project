import { describe, expect, it } from "vitest";
import type { Collection } from "../../../context/CollectionContext";
import { defaultSessionName, nothingToKeep, sessionWhen, splitSessions } from "./sessions";

const host = { userId: "bob", displayName: "Bob Hughes", role: "owner" as const };

const session = (extra: Partial<Collection> = {}): Collection => ({
	collectionId: "s1",
	slideId: "003",
	collectionName: "Bob Hughes's session",
	created: "2026-11-17T14:05:00Z",
	ownerId: "bob",
	kind: "session",
	ended: null,
	shared: false,
	myRole: "owner",
	members: [host],
	annotationCount: 0,
	cellCountCount: 0,
	lastAdded: null,
	maxEditors: 5,
	editPolicy: "lastWriteWins",
	...extra,
});

describe("nothingToKeep", () => {
	it("is true for a session with nothing drawn, counted or said, and only the host", () => {
		expect(nothingToKeep(session(), "nothing")).toBe(true);
	});

	it("keeps one with an annotation or a cell count", () => {
		expect(nothingToKeep(session({ annotationCount: 1 }), "nothing")).toBe(false);
		expect(nothingToKeep(session({ cellCountCount: 1 }), "nothing")).toBe(false);
	});

	it("keeps one someone else is still in", () => {
		expect(nothingToKeep(session({ members: [host, { userId: "ann", displayName: "Ann", role: "viewer" }] }), "nothing")).toBe(false);
	});

	it("keeps one where something was said in the chat", () => {
		expect(nothingToKeep(session(), "something")).toBe(false);
	});

	it("keeps one when the chat couldn't be checked", () => {
		expect(nothingToKeep(session(), "unknown")).toBe(false);
	});

	it("never drops a personal collection", () => {
		expect(nothingToKeep(session({ kind: "personal" }), "nothing")).toBe(false);
	});
});

describe("defaultSessionName", () => {
	it("has the host's name and when it started, on your clock", () => {
		expect(defaultSessionName("Bob Hughes", new Date(2026, 10, 17, 14, 5))).toBe("Bob Hughes's session, 17 Nov 14:05");
	});

	it("tells two started the same day apart", () => {
		const morning = defaultSessionName("Bob", new Date(2026, 10, 17, 9, 0));
		const afternoon = defaultSessionName("Bob", new Date(2026, 10, 17, 15, 30));
		expect(morning).not.toBe(afternoon);
	});

	it("still reads without a name", () => {
		expect(defaultSessionName("  ", new Date(2026, 0, 2, 8, 0))).toBe("Your session, 2 Jan 08:00");
	});
});

describe("splitSessions", () => {
	it("puts live ones first, as they came, and ended ones latest first", () => {
		const live1 = session({ collectionId: "l1" });
		const live2 = session({ collectionId: "l2" });
		const early = session({ collectionId: "e1", ended: "2026-11-15T10:00:00Z" });
		const late = session({ collectionId: "e2", ended: "2026-11-17T10:00:00Z" });
		const { live, ended } = splitSessions([live1, early, live2, late]);
		expect(live.map((s) => s.collectionId)).toEqual(["l1", "l2"]);
		expect(ended.map((s) => s.collectionId)).toEqual(["e2", "e1"]);
	});

	it("doesn't reorder what it's given", () => {
		const list = [session({ collectionId: "a", ended: "2026-11-15T10:00:00Z" }), session({ collectionId: "b", ended: "2026-11-17T10:00:00Z" })];
		splitSessions(list);
		expect(list.map((s) => s.collectionId)).toEqual(["a", "b"]);
	});
});

describe("sessionWhen", () => {
	it("says when a live one started", () => {
		expect(sessionWhen(session())).toMatch(/^Started \d+ Nov, \d\d:\d\d · 1 person$/);
	});

	it("says when an ended one ended, and how many were in it", () => {
		const ended = session({ ended: "2026-11-17T15:10:00Z", members: [host, { userId: "ann", displayName: "Ann", role: "editor" }] });
		expect(sessionWhen(ended)).toMatch(/^Ended \d+ Nov, \d\d:\d\d · 2 people$/);
	});
});
