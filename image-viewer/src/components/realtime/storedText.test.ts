import { describe, expect, it } from "vitest";
import type { TextNow, When } from "./ownText";
import { StoredText, takeWhen, textAt, withWhen } from "./storedText";

function listening(stored: StoredText, id = "row") {
	const heard: [Partial<TextNow>, When][] = [];
	const stop = stored.subscribe(id, (text, when) => heard.push([text, when]));
	return { heard, stop };
}

describe("StoredText", () => {
	it("tells an open form what its row says now, and no other", () => {
		const stored = new StoredText();
		const { heard, stop } = listening(stored);
		stored.remember([{ id: "row", label: "duct", notes: null }, { id: "other", label: "x" }]);
		stop();
		stored.remember([{ id: "row", label: "after" }]);
		expect(heard).toEqual([[{ label: "duct", notes: "" }, {}]]);
	});

	it("leaves out a save it's heard of after a newer one", () => {
		const stored = new StoredText();
		stored.remember([{ id: "row", label: "newer" }], { at: 20 });
		const [left] = stored.remember([{ id: "row", label: "older", groupId: "g" }] as { id: string; label?: string; groupId: string }[], { at: 10 });
		expect(left).toEqual({ id: "row", groupId: "g" });
		expect(stored.ats("row")).toEqual({ label: 20, notes: undefined });
	});

	// A count's save only says the box that was changed.
	it("orders the two boxes apart", () => {
		const stored = new StoredText();
		const { heard } = listening(stored);
		stored.remember([{ id: "row", label: "l" }], { at: 20 });
		stored.remember([{ id: "row", notes: "n" }], { at: 10 });
		expect(heard[1][0]).toEqual({ notes: "n" });
	});

	it("takes one that doesn't say when as it comes", () => {
		const stored = new StoredText();
		const { heard } = listening(stored);
		stored.remember([{ id: "row", label: "a" }], { at: 20 });
		stored.remember([{ id: "row", label: "b" }]);
		expect(heard.map(([text]) => text.label)).toEqual(["a", "b"]);
	});

	it("knows whether the collection's been put back since", () => {
		const stored = new StoredText();
		const before = stored.sinceNow();
		expect(before()).toBe(true);
		stored.collectionPutBack();
		expect([before(), stored.sinceNow()()]).toEqual([false, true]);
	});
});

describe("when a text was stored", () => {
	it("comes from the answer, and isn't there from a store before it", () => {
		expect(textAt(new Response(null, { headers: { "Text-At": "1764072000000000" } }))).toBe(1764072000000000);
		expect(textAt(new Response())).toBeUndefined();
		expect(textAt(new Response(null, { headers: { "Text-At": "soon" } }))).toBeUndefined();
	});

	it("says which characters it is, in runs", () => {
		const ids = { label: ["8:40", "8:41", "8:42", "9:1", "", "", "8:43"], notes: [] };
		const data = withWhen({ label: "abcdefg", notes: "" }, { ids });
		expect(data).toMatchObject({ textIds: { label: "8:40+3,9:1+1,+2,8:43+1", notes: "" } });
		expect(takeWhen({ kind: "update", entity: "annotation", id: "a", data }).when.ids).toEqual(ids);
	});

	it("doesn't take one that isn't for what it says", () => {
		const when = (label: unknown, runs: unknown) => takeWhen({ kind: "update", entity: "annotation", id: "a", data: { label, textIds: { label: runs } } }).when;
		expect(when("ab", "8:40+2").ids).toEqual({ label: ["8:40", "8:41"] });
		for (const runs of ["8:40+3", "8:40+1", "8:x+2", "+999999999", "nonsense", 4, null, ""]) expect(when("ab", runs).ids).toBeUndefined();
		expect(when(undefined, "8:40+2").ids).toBeUndefined();
		expect(takeWhen({ kind: "update", entity: "annotation", id: "a", data: { label: "a", textIds: "x" } }).when.ids).toBeUndefined();
	});

	it("goes with an op and comes off again, as it isn't part of the row", () => {
		const data = withWhen({ label: "duct" }, { at: 5, putBack: true });
		const { op, when } = takeWhen({ kind: "update", entity: "annotation", id: "a", data });
		expect(op.data).toEqual({ label: "duct" });
		expect(when).toEqual({ at: 5, putBack: true });
	});

	it("leaves an op without one as it is", () => {
		expect(withWhen({ label: "duct" }, {})).toEqual({ label: "duct" });
		const gone = { kind: "delete" as const, entity: "annotation" as const, id: "a" };
		expect(takeWhen(gone)).toEqual({ op: gone, when: {} });
		expect(takeWhen({ kind: "update", entity: "annotation", id: "a", data: { colour: "#fff", textAt: "x" } })).toEqual({
			op: { kind: "update", entity: "annotation", id: "a", data: { colour: "#fff" } },
			when: { at: undefined, putBack: false },
		});
	});
});
