import { describe, expect, it, vi } from "vitest";
import type { DocState } from "./realtime";
import { putInDoc, textToPut, type OpenFields } from "./putText";
import { SharedFields } from "./sharedFields";
import { TEXT_FIELDS, type TextField } from "./ownText";

const back = { docId: "annotation:a", now: { label: "old", notes: "n" }, was: { label: "new" } };

function transport(state: DocState | null, openFields = new Map<string, OpenFields>()) {
	return { openDoc: vi.fn(async () => state), sendDocUpdate: vi.fn(), closeDoc: vi.fn(), openFields };
}

async function someonesForm(): Promise<{ form: SharedFields<TextField>; state: DocState }> {
	const form = new SharedFields<TextField>(TEXT_FIELDS, { label: "new", notes: "n" });
	let seed: Uint8Array = new Uint8Array();
	await form.connect({
		open: async (update) => {
			seed = update;
			return { instanceId: "i", seeded: true, updates: [update], editors: [] };
		},
		send: () => {},
	});
	return { form, state: { instanceId: "i", seeded: false, updates: [seed], editors: [] } };
}

describe("putInDoc", () => {
	it("puts the box that was changed into a form someone else has open", async () => {
		const { form, state } = await someonesForm();
		const hub = transport(state);
		await putInDoc(hub, back);
		for (const [, update] of hub.sendDocUpdate.mock.calls) form.receive(update as Uint8Array);
		expect(form.values()).toEqual({ label: "old", notes: "n" });
		expect(hub.closeDoc).toHaveBeenCalledWith("annotation:a");
	});

	it("sends nothing when nobody has it open", async () => {
		const hub = transport({ instanceId: "i", seeded: true, updates: [], editors: [] });
		await putInDoc(hub, back);
		expect(hub.sendDocUpdate).not.toHaveBeenCalled();
		expect(hub.closeDoc).toHaveBeenCalled();
	});

	it("does nothing when it isn't connected", async () => {
		const hub = transport(null);
		await putInDoc(hub, back);
		expect(hub.sendDocUpdate).not.toHaveBeenCalled();
	});

	it("uses your own form when it's open, and leaves the doc open", async () => {
		const put = vi.fn();
		const hub = transport(null, new Map([["annotation:a", { put }]]));
		await putInDoc(hub, back);
		expect(put.mock.calls).toEqual([["label", "old", "new"]]);
		expect([hub.openDoc.mock.calls.length, hub.closeDoc.mock.calls.length]).toEqual([0, 0]);
	});
});

describe("textToPut", () => {
	it("is only the rows whose text changed, and what it said", () => {
		const rows = [
			{ id: "a", label: "old", notes: null },
			{ id: "b", label: "same", notes: "n" },
		];
		expect(textToPut("annotation", rows, [{ id: "a", label: "new", notes: null }])).toEqual([
			{ docId: "annotation:a", now: { label: "old", notes: "" }, was: { label: "new" } },
		]);
	});

	it("is nothing for a row that isn't one of these, or a store that doesn't say", () => {
		expect(textToPut("cellCount", [], [{ id: "a", label: "new", notes: null }])).toEqual([]);
		expect(textToPut("cellCount", [{ id: "a", label: "old" }])).toEqual([]);
	});
});
