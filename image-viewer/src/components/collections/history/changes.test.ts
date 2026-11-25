import { describe, expect, it } from "vitest";
import { changeLines, deletedCount, deletedLine, deletedPath, deletedRowText, showAllDeleted, type ChangeSetChanges, type FieldChange } from "./changes";

const none: ChangeSetChanges = { changes: [], created: 0, deleted: 0, deletedNames: [], groups: {} };

const change = (overrides: Partial<FieldChange>): FieldChange => ({
	entity: "annotation",
	column: "Label",
	before: "",
	after: "",
	count: 1,
	names: ["Region 4"],
	...overrides,
});

describe("changeLines", () => {
	it("says what an edit changed on one row, from and to", () => {
		const [line] = changeLines({ ...none, changes: [change({ before: "Region 4", after: "Region 4 (checked)", names: ["Region 4 (checked)"] })] });
		expect(line).toEqual({
			field: "Label",
			rows: "Region 4 (checked)",
			kind: "text",
			from: [{ text: "Region 4", empty: false }],
			to: { text: "Region 4 (checked)", empty: false },
		});
	});

	it("shows a moved slice from 1, and none as every slice", () => {
		const [deeper, everywhere] = changeLines({
			...none,
			changes: [change({ column: "SliceTo", before: 8, after: 11 }), change({ column: "SliceFrom", before: 3, after: null })],
		});
		expect(deeper.field).toBe("Last slice");
		expect([deeper.from, deeper.to]).toEqual([[{ text: "9", empty: false }], { text: "12", empty: false }]);
		expect(everywhere.to).toEqual({ text: "Every slice", empty: false });
	});

	it("shows nothing as (empty), so notes added to a blank show where they came from", () => {
		const [line] = changeLines({ ...none, changes: [change({ column: "Notes", before: "", after: "Looked at again" })] });
		expect(line.field).toBe("Notes");
		expect(line.from).toEqual([{ text: "(empty)", empty: true }]);
	});

	it("says how many for a change to many rows, and gives colours as swatches", () => {
		const [line] = changeLines({
			...none,
			changes: [change({ column: "Colour", before: "#ff0000", after: "#0913FB", count: 2140, names: ["a", "b"] })],
		});
		expect(line.rows).toBe("2,140 annotations");
		expect(line.kind).toBe("colour");
		expect(line.from).toEqual([{ text: "#FF0000", empty: false, colour: "#ff0000" }]);
		expect(line.to.colour).toBe("#0913FB");
	});

	it("names groups, gone ones included, and no group as empty", () => {
		const result = {
			...none,
			groups: { g1: "Stroma", g2: "Tumour margin" },
			changes: [
				change({ column: "GroupId", before: "g1", after: "g2", count: 8 }),
				change({ column: "GroupId", before: null, after: "g1" }),
				change({ column: "GroupId", before: "g3", after: null }),
			],
		};
		const [moved, grouped, ungrouped] = changeLines(result);
		expect([moved.field, moved.from[0].text, moved.to.text]).toEqual(["Group", "Stroma", "Tumour margin"]);
		expect(grouped.from).toEqual([{ text: "No group", empty: true }]);
		expect(ungrouped.from[0].text).toBe("a deleted group");
	});

	it("says yes or no for a flag, and numbers with separators", () => {
		const lines = changeLines({
			...none,
			changes: [
				change({ entity: "cellCount", column: "WithRoi", before: false, after: true }),
				change({ entity: "cellCount", column: "Count", before: 1200, after: 12000 }),
				change({ entity: "cellCount", column: "DotSize", before: 6, after: 8 }),
			],
		});
		expect(lines.map((l) => [l.field, l.from[0].text, l.to.text])).toEqual([
			["With ROI", "No", "Yes"],
			["Count", "1,200", "12,000"],
			["Dot size", "6", "8"],
		]);
	});

	it("gives each image adjustment setting that changed a line, and leaves out ones that didn't", () => {
		const lines = changeLines({
			...none,
			changes: [
				change({
					entity: "imageAdjustment",
					column: "Adjustments",
					before: '{"brightness":0,"contrast":0.2,"gamma":1}',
					after: '{"brightness":0.35,"contrast":0.2,"gamma":1.5}',
				}),
			],
		});
		expect(lines.map((l) => [l.field, l.from[0].text, l.to.text])).toEqual([
			["Brightness", "0", "0.35"],
			["Gamma", "1", "1.5"],
		]);
	});

	it("puts rows that all went to the same thing on one line, with where each started", () => {
		const lines = changeLines({
			...none,
			changes: [
				change({ column: "Colour", before: "#000000", after: "#0913FB", count: 3, names: ["a", "b", "c"] }),
				change({ column: "Colour", before: "#168304", after: "#0913FB", count: 3 }),
				change({ column: "Colour", before: "#FB0909", after: "#0913FB", count: 1, names: [null] }),
				change({ column: "Colour", before: "#0913FB", after: "#000000", count: 2 }),
			],
		});
		expect(lines).toHaveLength(2);
		expect(lines[0].rows).toBe("7 annotations");
		expect(lines[0].from.map((f) => f.text)).toEqual(["#000000", "#168304", "#FB0909"]);
		expect(lines[0].to.text).toBe("#0913FB");
		expect([lines[1].rows, lines[1].to.text]).toEqual(["2 annotations", "#000000"]);
	});

	it("names a row that's gone since by what it was", () => {
		const [line] = changeLines({ ...none, changes: [change({ entity: "cellCount", names: [null] })] });
		expect(line.rows).toBe("a deleted cell count");
	});

	it("shows a column it doesn't know as it is", () => {
		const [line] = changeLines({ ...none, changes: [change({ column: "Shape", before: "Box", after: "Circle" })] });
		expect([line.field, line.kind, line.to.text]).toEqual(["Shape", "other", "Circle"]);
	});

	it("is nothing for a change that changed nothing", () => {
		expect(changeLines(none)).toEqual([]);
	});
});

describe("changeLines for the collection, and who's in it", () => {
	const lines = (overrides: Partial<FieldChange>[]) =>
		changeLines({ ...none, changes: overrides.map((o) => change({ names: ["Bob"], ...o })) }).map((l) => [l.rows, l.field, l.from[0].text, l.to.text]);

	it("says what the collection was called", () => {
		expect(lines([{ entity: "collection", column: "CollectionName", before: "Slide 4", after: "Margins", names: ["Margins"] }])).toEqual([
			["", "Name", "Slide 4", "Margins"],
		]);
	});

	it("says who joined, left, or was given what, by name", () => {
		expect(
			lines([
				{ entity: "member", column: "Role", before: null, after: "Editor" },
				{ entity: "member", column: "Role", before: "Editor", after: "Viewer" },
				{ entity: "member", column: "Role", before: "Viewer", after: null },
			]),
		).toEqual([
			["Bob", "Access", "Not in it", "Can edit"],
			["Bob", "Access", "Can edit", "View only"],
			["Bob", "Access", "View only", "Not in it"],
		]);
	});

	it("says what a link let people do, and when it stopped", () => {
		const [role, expires, stopped] = lines([
			{ entity: "invite", column: "Role", before: null, after: "Editor", names: [null] },
			{ entity: "invite", column: "Expires", before: null, after: "2026-11-25T10:00:00Z", names: [null] },
			{ entity: "invite", column: "Stopped", before: null, after: "2026-11-25T10:00:00Z", names: [null] },
		]);
		expect(role).toEqual(["", "Access", "No link", "Can edit"]);
		expect([expires[1], expires[2]]).toEqual(["Works until", "No link"]);
		expect(expires[3]).toContain("2026");
		expect([stopped[2], stopped[3].startsWith("Stopped ")]).toEqual(["Working", true]);
	});

	it("says when it was shared or ended", () => {
		expect(lines([{ entity: "collection", column: "Shared", before: false, after: true }])).toEqual([["", "Anyone signed in can look", "No", "Yes"]]);
		const [ended] = lines([{ entity: "collection", column: "Ended", before: null, after: "2026-11-25T10:00:00Z" }]);
		expect([ended[1], ended[2], ended[3].startsWith("Ended ")]).toEqual(["Session", "Going", true]);
	});
});

describe("everything a change deleted", () => {
	it("can all be shown when there's more than it names", () => {
		expect(showAllDeleted({ ...none, deleted: 2140, deletedNames: ["a", "b", "c", "d", "e"] })).toBe("Show all 2,140");
		expect(showAllDeleted({ ...none, deleted: 5, deletedNames: ["a", "b", "c", "d", "e"] })).toBeNull();
		expect(showAllDeleted(none)).toBeNull();
	});

	it("is asked for a page at a time, searched when there's something to search for", () => {
		expect(deletedPath("a b", "  ", 0, 50)).toBe("/changesets/a%20b/deleted?skip=0&take=50");
		expect(deletedPath("c", " duct & co ", 100, 50)).toBe("/changesets/c/deleted?skip=100&take=50&search=duct+%26+co");
	});

	it("says how many, and how many match", () => {
		expect(deletedCount(2140, 2140, "")).toBe("2,140 deleted");
		expect(deletedCount(2140, 12, "duct")).toBe("12 of 2,140");
		expect(deletedCount(2140, 0, "duct")).toBe("None of the 2,140 match");
	});
});

describe("deletedLine", () => {
	it("names what went, with an and before the last", () => {
		expect(deletedLine({ ...none, deleted: 1, deletedNames: ["Region 7"] })).toBe("Region 7");
		expect(deletedLine({ ...none, deleted: 2, deletedNames: ["Region 7", "Count 2"] })).toBe("Region 7 and Count 2");
	});

	it("says how many more past the ones it names", () => {
		expect(deletedLine({ ...none, deleted: 2140, deletedNames: ["a", "b", "c", "d", "e"] })).toBe("a, b, c, d, e and 2,135 more");
	});

	it("still says something for one with no name", () => {
		expect(deletedLine({ ...none, deleted: 1, deletedNames: [""] })).toBe("one with no name");
	});

	it("is nothing when nothing was deleted", () => {
		expect(deletedLine(none)).toBeNull();
	});
});

describe("deleted rows on a volume", () => {
	it("says which slices each was on", () => {
		expect(deletedRowText({ name: "Duct", sliceFrom: 3, sliceTo: 8 })).toBe("Duct (slices 4 to 9)");
		expect(deletedRowText({ name: "Mitoses", sliceFrom: 4, sliceTo: 4 })).toBe("Mitoses (slice 5)");
	});

	it("says nothing more for one on every slice, or from a store before slices", () => {
		expect(deletedRowText({ name: "Region 7", sliceFrom: null, sliceTo: null })).toBe("Region 7");
		expect(deletedRowText({ name: "Region 7" })).toBe("Region 7");
		expect(deletedRowText({ name: null, sliceFrom: 0, sliceTo: 0 })).toBe("one with no name (slice 1)");
	});

	it("puts them in the deleted line when the store sends the rows", () => {
		const rows = [
			{ entity: "annotation", id: "1", name: "Duct", sliceFrom: 3, sliceTo: 8 },
			{ entity: "annotation", id: "2", name: "Region 7", sliceFrom: null, sliceTo: null },
		];
		expect(deletedLine({ ...none, deleted: 3, deletedNames: ["Duct", "Region 7"], deletedRows: rows })).toBe(
			"Duct (slices 4 to 9), Region 7 and 1 more",
		);
	});
});
