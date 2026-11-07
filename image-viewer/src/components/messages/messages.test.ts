import { describe, expect, it } from "vitest";
import type { Annotation } from "../../interfaces/Annotation";
import type { CellCount } from "../../interfaces/CellCount";
import type { FullCollection } from "../collections/collectionGeoJson";
import {
	MAX_PAYLOAD_BYTES,
	addRequest,
	buildPayload,
	conversationName,
	formatBytes,
	isCramped,
	mergeMessages,
	overLimit,
	previewOf,
	problemText,
	startsRun,
	totalUnread,
	type Conversation,
	type Message,
} from "./messages";

function message(id: string, sent: string, extra: Partial<Message> = {}): Message {
	return { id, conversationId: "c", fromUserId: "alice", fromName: "Alice", body: "hi", sent, attachment: null, ...extra };
}

function conversation(extra: Partial<Conversation> = {}): Conversation {
	return { id: "c", kind: "direct", withUserId: "alice", sessionId: null, created: "2026-01-01", lastMessage: null, unread: 0, ...extra };
}

function annotation(id: string, extra: Partial<Annotation> = {}): Annotation {
	return {
		id,
		label: "",
		notes: "",
		colour: "#fff",
		shape: "rectangle",
		lineStyle: "solid",
		lineThickness: 1,
		geoJson: "{}",
		created: "2026-01-01",
		...extra,
	} as Annotation;
}

function cellCount(id: string, extra: Partial<CellCount> = {}): CellCount {
	return {
		id,
		label: "",
		notes: "",
		dots: "[]",
		withAnnotation: true,
		withRoi: false,
		count: 0,
		dotSize: 1,
		locationX: null,
		locationY: null,
		regionOfInterest: null,
		...extra,
	} as CellCount;
}

const grouped: FullCollection = {
	collectionId: "col",
	slideId: "003",
	collectionName: "Mine",
	annotations: [],
	cellCounts: [cellCount("c1", { groupId: "cg1" }), cellCount("c2", { groupId: "cg1" }), cellCount("c3")],
	cellCountGroups: [
		{ id: "cg1", name: "Mitoses", notes: "Hot spots" },
		{ id: "cg2", name: "Empty" },
	],
};

const full: FullCollection = {
	collectionId: "col",
	slideId: "003",
	collectionName: "Mine",
	annotations: [
		annotation("a1", { label: "Lump", groupId: "g1" }),
		annotation("a2", { groupId: "g1" }),
		annotation("a3", { groupId: "g2" }),
		annotation("a4"),
	],
	cellCounts: [cellCount("c1", { label: "Mitoses" }), cellCount("c2")],
	groups: [
		{ id: "g1", name: "Tumour", notes: "Look here" },
		{ id: "g2", name: "Stroma" },
		{ id: "g3", name: "Empty" },
	],
};

describe("conversationName", () => {
	it("uses the Users list first", () => {
		expect(conversationName(conversation(), [{ userId: "alice", displayName: "Alice Moore" }])).toBe("Alice Moore");
	});

	it("falls back to their last message when they aren't on it", () => {
		expect(conversationName(conversation({ lastMessage: message("m", "1", { fromName: "Alice then" }) }), [])).toBe("Alice then");
	});

	it("doesn't call them by your name when the last message was yours", () => {
		expect(conversationName(conversation({ lastMessage: message("m", "1", { fromUserId: "me", fromName: "Me" }) }), [])).toBe("Someone");
	});
});

describe("totalUnread", () => {
	it("counts direct conversations and the session chat", () => {
		expect(totalUnread([conversation({ unread: 2 }), conversation({ unread: 3 })], conversation({ unread: 4 }))).toBe(9);
		expect(totalUnread([], null)).toBe(0);
	});
});

describe("mergeMessages", () => {
	it("goes oldest first, whichever order they came in", () => {
		const merged = mergeMessages([message("b", "2026-01-02")], [message("c", "2026-01-03"), message("a", "2026-01-01")]);
		expect(merged.map((m) => m.id)).toEqual(["a", "b", "c"]);
	});

	it("has each once, keeping the newest copy", () => {
		const merged = mergeMessages([message("a", "1", { body: "old" })], [message("a", "1", { body: "new" })]);
		expect(merged).toHaveLength(1);
		expect(merged[0].body).toBe("new");
	});

	it("keeps the order steady when two have the same time", () => {
		const order = (list: Message[]) => mergeMessages([], list).map((m) => m.id);
		expect(order([message("b", "1"), message("a", "1")])).toEqual(order([message("a", "1"), message("b", "1")]));
	});
});

describe("previewOf", () => {
	const attachment = {
		kind: "group",
		name: "Tumour",
		slideId: null,
		sourceCollectionId: null,
		inviteCode: null,
		bytes: 1,
		lastAddedByMe: null,
	} as const;

	it("says when there is nothing yet", () => {
		expect(previewOf(null, "me")).toBe("No messages yet");
	});

	it("says when it was you", () => {
		expect(previewOf(message("m", "1", { fromUserId: "me", body: "hello" }), "me")).toBe("You: hello");
		expect(previewOf(message("m", "1", { body: "hello" }), "me")).toBe("hello");
	});

	it("names what was sent when there is no text", () => {
		expect(previewOf(message("m", "1", { body: "", attachment }), "me")).toBe("Group - Tumour");
		expect(previewOf(message("m", "1", { body: "", attachment: { ...attachment, kind: "area", name: "Area of slide 003" } }), "me")).toBe(
			"Area - Area of slide 003",
		);
	});
});

describe("buildPayload", () => {
	it("sends only the annotations picked, with the groups they are in", () => {
		const built = buildPayload(full, { kind: "annotations", ids: ["a1", "a4"] })!;
		expect(built.payload.annotations.map((a) => a.id)).toEqual(["a1", "a4"]);
		expect(built.payload.cellCounts).toEqual([]);
		expect(built.payload.groups).toEqual([{ name: "Tumour", notes: "Look here", annotationIds: ["a1"] }]);
		expect(built.name).toBe("2 annotations");
	});

	it("calls one annotation by its label, or by what it is if it has none", () => {
		expect(buildPayload(full, { kind: "annotations", ids: ["a1"] })!.name).toBe("Lump");
		expect(buildPayload(full, { kind: "annotations", ids: ["a2"] })!.name).toBe("1 annotation");
	});

	it("sends a group with what is in it", () => {
		const built = buildPayload(full, { kind: "group", id: "g1" })!;
		expect(built.name).toBe("Tumour");
		expect(built.payload.annotations.map((a) => a.id)).toEqual(["a1", "a2"]);
		expect(built.payload.groups).toEqual([{ name: "Tumour", notes: "Look here", annotationIds: ["a1", "a2"] }]);
	});

	it("sends a cell count on its own", () => {
		const built = buildPayload(full, { kind: "cellCount", id: "c1" })!;
		expect(built.name).toBe("Mitoses");
		expect(built.payload.cellCounts.map((c) => c.id)).toEqual(["c1"]);
		expect(built.payload.annotations).toEqual([]);
	});

	it("sends a group of cell counts with what is in it", () => {
		const built = buildPayload(grouped, { kind: "cellCountGroup", id: "cg1" })!;
		expect(built.name).toBe("Mitoses");
		expect(built.payload.cellCounts.map((c) => c.id)).toEqual(["c1", "c2"]);
		expect(built.payload.annotations).toEqual([]);
		expect(built.payload.cellCountGroups).toEqual([{ name: "Mitoses", notes: "Hot spots", cellCountIds: ["c1", "c2"] }]);
	});

	it("is nothing for a group of cell counts that is empty or gone", () => {
		expect(buildPayload(grouped, { kind: "cellCountGroup", id: "cg2" })).toBeNull();
		expect(buildPayload(grouped, { kind: "cellCountGroup", id: "gone" })).toBeNull();
	});

	it("keeps the group a single cell count is in", () => {
		expect(buildPayload(grouped, { kind: "cellCount", id: "c1" })!.payload.cellCountGroups).toEqual([
			{ name: "Mitoses", notes: "Hot spots", cellCountIds: ["c1"] },
		]);
	});

	it("sends the whole collection with its cell count groups", () => {
		expect(buildPayload(grouped, { kind: "collection" })!.payload.cellCountGroups).toHaveLength(1);
	});

	it("sends the whole collection, leaving out groups with nothing in them", () => {
		const built = buildPayload(full, { kind: "collection" })!;
		expect(built.name).toBe("Mine");
		expect(built.payload.annotations).toHaveLength(4);
		expect(built.payload.cellCounts).toHaveLength(2);
		expect(built.payload.groups.map((g) => g.name)).toEqual(["Tumour", "Stroma"]);
	});

	it("is nothing when what was picked has gone or is empty", () => {
		expect(buildPayload(full, { kind: "group", id: "g3" })).toBeNull();
		expect(buildPayload(full, { kind: "annotations", ids: ["gone"] })).toBeNull();
		expect(buildPayload(full, { kind: "cellCount", id: "gone" })).toBeNull();
		expect(buildPayload({ ...full, annotations: [], cellCounts: [] }, { kind: "collection" })).toBeNull();
	});

	it("keeps the name within what messaging takes", () => {
		const long = { ...full, collectionName: "x".repeat(300) };
		expect(buildPayload(long, { kind: "collection" })!.name).toHaveLength(200);
	});
});

describe("overLimit", () => {
	it("is nothing under the limit", () => {
		expect(overLimit({ annotations: [annotation("a")], cellCounts: [], groups: [] })).toBeNull();
	});

	it("says how big when it is over", () => {
		const big = { annotations: [annotation("a", { geoJson: "x".repeat(MAX_PAYLOAD_BYTES) })], cellCounts: [], groups: [] };
		expect(overLimit(big)).toBeGreaterThan(MAX_PAYLOAD_BYTES);
	});

	it("counts bytes rather than characters", () => {
		const big = { annotations: [annotation("a", { geoJson: "é".repeat(MAX_PAYLOAD_BYTES / 2 + 10) })], cellCounts: [], groups: [] };
		expect(overLimit(big)).not.toBeNull();
	});
});

describe("formatBytes", () => {
	it("reads as a person would say it", () => {
		expect(formatBytes(500)).toBe("500 bytes");
		expect(formatBytes(2048)).toBe("2KB");
		expect(formatBytes(1024 * 1024 * 6.5)).toBe("6.5MB");
	});
});

describe("addRequest", () => {
	const sender = { id: "m1", fromUserId: "alice", fromName: "Alice" };
	const card = { kind: "group", name: "Tumour", sourceCollectionId: "col", slideId: "003" } as const;
	const rows = {
		annotations: [annotation("a1", { groupId: "g1" }), annotation("a2", { groupId: "g1" })],
		cellCounts: [cellCount("c1", { regionOfInterest: { id: "r1" } as CellCount["regionOfInterest"] })],
		groups: [{ name: "Tumour", notes: "Look here", annotationIds: ["a1", "a2", "not-sent"] }],
	};

	it("gives everything new ids", () => {
		const request = addRequest(rows, sender, card);
		const ids = [...request.annotations.map((a) => a.id), ...request.cellCounts.map((c) => c.id)];
		expect(new Set(ids).size).toBe(3);
		for (const old of ["a1", "a2", "c1"]) expect(ids).not.toContain(old);
		expect(request.cellCounts[0].regionOfInterest!.id).not.toBe("r1");
	});

	it("gives different ids each time, so adding twice adds it twice", () => {
		expect(addRequest(rows, sender, card).annotations[0].id).not.toBe(addRequest(rows, sender, card).annotations[0].id);
	});

	it("takes annotations out of the groups they were in, which are the sender’s", () => {
		expect(addRequest(rows, sender, card).annotations.every((a) => a.groupId === null)).toBe(true);
	});

	it("moves groups to the new ids, dropping any that were not sent", () => {
		const request = addRequest(rows, sender, card);
		expect(request.groups[0].annotationIds).toEqual(request.annotations.map((a) => a.id));
		expect(request.groups[0].notes).toBe("Look here");
	});

	it("moves cell count groups to the new ids too, and out of the group they were in", () => {
		const request = addRequest(
			{
				annotations: [],
				cellCounts: [cellCount("c1", { groupId: "cg1" })],
				groups: [],
				cellCountGroups: [{ name: "Mitoses", cellCountIds: ["c1", "not-sent"] }],
			},
			sender,
			card,
		);
		expect(request.cellCounts[0].groupId).toBeNull();
		expect(request.cellCountGroups).toEqual([{ name: "Mitoses", cellCountIds: [request.cellCounts[0].id] }]);
	});

	it("copes with something sent before cell count groups", () => {
		expect(addRequest(rows, sender, card).cellCountGroups).toEqual([]);
	});

	it("says where it came from, row by row", () => {
		const request = addRequest(rows, sender, card);
		expect(request.source).toMatchObject({
			messageId: "m1",
			fromUserId: "alice",
			fromName: "Alice",
			kind: "group",
			name: "Tumour",
			collectionId: "col",
			slideId: "003",
		});
		expect(request.source.rows).toEqual([
			{ entity: "annotation", from: "a1", to: request.annotations[0].id },
			{ entity: "annotation", from: "a2", to: request.annotations[1].id },
			{ entity: "cellCount", from: "c1", to: request.cellCounts[0].id },
		]);
	});

	it("leaves what was sent as it was, since it's also on screen", () => {
		const before = JSON.stringify(rows);
		addRequest(rows, sender, card);
		expect(JSON.stringify(rows)).toBe(before);
	});
});

describe("startsRun", () => {
	const at = (time: string, fromUserId = "alice") => message(time, `2026-11-05T${time}:00Z`, { fromUserId });

	it("starts with the first message", () => {
		expect(startsRun(undefined, at("10:00"))).toBe(true);
	});

	it("carries on for the same person soon after", () => {
		expect(startsRun(at("10:00"), at("10:04"))).toBe(false);
		expect(startsRun(at("10:00"), at("10:05"))).toBe(false);
	});

	it("starts again after a gap, or for someone else", () => {
		expect(startsRun(at("10:00"), at("10:06"))).toBe(true);
		expect(startsRun(at("10:00"), at("10:01", "bob"))).toBe(true);
	});

	it("starts again if the times are out of order or unreadable", () => {
		expect(startsRun(at("10:05"), at("10:00"))).toBe(true);
		expect(startsRun(message("a", "nonsense"), message("b", "nonsense"))).toBe(true);
	});
});

describe("isCramped", () => {
	const font = 11;

	it("is cramped in a side dock", () => {
		expect(isCramped(true, 20 * font, font)).toBe(true);
	});

	it("has room in a top or bottom dock", () => {
		expect(isCramped(true, 90 * font, font)).toBe(false);
	});

	it("is never cramped floating, or you could fold it and not get it back", () => {
		expect(isCramped(false, 25 * font, font)).toBe(false);
	});

	it("waits until it has been measured", () => {
		expect(isCramped(true, 0, font)).toBe(false);
	});
});

describe("problemText", () => {
	it("passes on what messaging said about size and ended sessions", () => {
		expect(problemText(413, "That is 6.0MB, and the limit is 5MB")).toBe("That is 6.0MB, and the limit is 5MB");
		expect(problemText(409, "Ended")).toBe("Ended");
	});

	it("has its own words for the rest", () => {
		expect(problemText(0, "")).toContain("Can't reach messaging");
		expect(problemText(404, "ignored")).toContain("not in it");
		expect(problemText(503, "")).toContain("Can't check");
		expect(problemText(500, "stack trace")).toBe("Couldn't do that - try again");
	});
});
