// What one change did, as GET /changesets/{id}/changes gives it - see
// annotation-store's History/ChangeSetChanges.cs - and turned into the lines
// the History detail page shows: "Label  Region 4 -> Region 4 (checked)".

import { sliceRangeText } from "../../depth/markers";
import { formatFullDate } from "../../saved/savedDates";

// One column going from one value to another, on count rows of one kind.
// names are the first few of those rows, null for one that's gone since.
interface FieldChange {
	entity: string;
	column: string;
	before: unknown;
	after: unknown;
	count: number;
	names: (string | null)[];
}

interface ChangeSetChanges {
	changes: FieldChange[];
	created: number;
	deleted: number;
	deletedNames: (string | null)[];
	// Every group a GroupId in changes points at, by name.
	groups: Record<string, string>;
	// The same first few as deletedNames, with what they are, to open one.
	deletedRows?: DeletedRow[];
}

interface DeletedRow {
	entity: string;
	id: string;
	name: string | null;
	// The slices of a volume it was on - a count's one slice is both. Null
	// for every slice, and missing from a store before slices.
	sliceFrom?: number | null;
	sliceTo?: number | null;
}

// GET /changesets/{id}/deleted - a page of everything one change deleted.
// total is how many match the search.
interface DeletedPage {
	total: number;
	rows: DeletedRow[];
}

type ValueKind = "text" | "colour" | "group" | "other";

// A value as shown. empty is for one with nothing in it - "(empty)", or no
// group - so the page can grey it out.
interface Shown {
	text: string;
	empty: boolean;
	// Colour values only: the hex, for a swatch.
	colour?: string;
}

interface ChangeLine {
	field: string;
	// Which rows: a name for one, "48 annotations" for many.
	rows: string;
	kind: ValueKind;
	// More than one when rows that started out different all went to the
	// same thing - a recolour of red, green and blue shapes to black.
	from: Shown[];
	to: Shown;
}

const NOUNS: Record<string, [string, string]> = {
	annotation: ["annotation", "annotations"],
	group: ["group", "groups"],
	cellCountGroup: ["group of cell counts", "groups of cell counts"],
	cellCount: ["cell count", "cell counts"],
	imageAdjustment: ["image adjustment", "image adjustments"],
	member: ["person", "people"],
	invite: ["invite link", "invite links"],
};

// What each column's called on the page. Anything else is shown as it is.
const FIELDS: Record<string, string> = {
	Label: "Label",
	Notes: "Notes",
	Colour: "Colour",
	GroupId: "Group",
	Name: "Name",
	AdjustmentName: "Name",
	WithAnnotation: "With annotation",
	WithRoi: "With ROI",
	Count: "Count",
	DotSize: "Dot size",
	SliceFrom: "First slice",
	SliceTo: "Last slice",
	CollectionName: "Name",
	Shared: "Anyone signed in can look",
	Ended: "Session",
	Role: "Access",
	Expires: "Works until",
	Stopped: "Invite link",
};

const ROLES: Record<string, string> = { Viewer: "View only", Editor: "Can edit", Owner: "Host" };

// An image adjustment's settings are one JSON column - each one in it that
// changed gets a line of its own.
const SETTINGS: Record<string, string> = {
	brightness: "Brightness",
	contrast: "Contrast",
	gamma: "Gamma",
	red: "Red",
	green: "Green",
	blue: "Blue",
};

const number = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });

function nounFor(entity: string): [string, string] {
	return NOUNS[entity] ?? ["row", "rows"];
}

function rowsFor(entity: string, count: number, name: string | null): string {
	const [one, many] = nounFor(entity);
	if (count > 1) return `${number(count)} ${many}`;
	// There's only the one collection, and a link has no name.
	if (entity === "collection" || entity === "invite") return "";
	return name ?? `a deleted ${one}`;
}

// A name, a person or a link - see annotation-store's HistoryLog.Settings. A
// person's access or a link's is nothing when they weren't in it, or before
// there was one.
function showSetting(entity: string, column: string, value: unknown): Shown | null {
	const time = typeof value === "string" ? formatFullDate(value) : null;
	if (column === "Role") {
		if (typeof value === "string") return { text: ROLES[value] ?? value, empty: false };
		return { text: entity === "invite" ? "No link" : "Not in it", empty: true };
	}
	if (column === "Expires") return time ? { text: time, empty: false } : { text: "No link", empty: true };
	if (column === "Stopped") return { text: time ? `Stopped ${time}` : "Working", empty: false };
	if (column === "Ended") return { text: time ? `Ended ${time}` : "Going", empty: false };
	return null;
}

function show(entity: string, column: string, value: unknown, groups: Record<string, string>): Shown {
	const setting = entity === "collection" || entity === "member" || entity === "invite" ? showSetting(entity, column, value) : null;
	if (setting) return setting;
	if (column === "GroupId")
		return typeof value === "string" ? { text: groups[value] ?? "a deleted group", empty: false } : { text: "No group", empty: true };
	if (column === "Colour" && typeof value === "string") return { text: value.toUpperCase(), empty: false, colour: value };
	// Stored from 0, shown from 1 like the Depth tab. None is every slice.
	if (column === "SliceFrom" || column === "SliceTo")
		return typeof value === "number" ? { text: number(value + 1), empty: false } : { text: "Every slice", empty: false };
	if (typeof value === "boolean") return { text: value ? "Yes" : "No", empty: false };
	if (typeof value === "number") return { text: number(value), empty: false };
	if (value === null || value === undefined || value === "") return { text: "(empty)", empty: true };
	return { text: String(value), empty: false };
}

function kindOf(column: string): ValueKind {
	if (column === "Colour") return "colour";
	if (column === "GroupId") return "group";
	if (column === "Label" || column === "Notes" || column === "Name" || column === "AdjustmentName" || column === "CollectionName") return "text";
	return "other";
}

function settings(json: unknown): Record<string, unknown> {
	if (typeof json !== "string") return {};
	try {
		const parsed: unknown = JSON.parse(json);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

interface Together {
	change: FieldChange;
	befores: unknown[];
	count: number;
}

// Changes to the same column that ended up the same, together - the store
// keeps them apart by where each one started. An image adjustment's
// settings are one JSON column, so those stay apart.
function together(changes: FieldChange[]): Together[] {
	const merged = new Map<string, Together>();
	for (const change of changes) {
		const ended = change.column === "Adjustments" ? [change.before, change.after] : change.after;
		const key = JSON.stringify([change.entity, change.column, ended]);
		const found = merged.get(key);
		if (found) {
			found.befores.push(change.before);
			found.count += change.count;
		} else merged.set(key, { change, befores: [change.before], count: change.count });
	}
	return [...merged.values()];
}

// Every line, in the order the store sent them - most rows first.
function changeLines(result: ChangeSetChanges): ChangeLine[] {
	return together(result.changes).flatMap(({ change, befores, count }): ChangeLine[] => {
		const rows = rowsFor(change.entity, count, change.names[0] ?? null);
		if (change.column === "Adjustments") {
			const was = settings(change.before);
			const now = settings(change.after);
			return [...new Set([...Object.keys(was), ...Object.keys(now)])]
				.filter((key) => was[key] !== now[key])
				.map((key) => ({
					field: SETTINGS[key] ?? key,
					rows,
					kind: "other",
					from: [show(change.entity, key, was[key], result.groups)],
					to: show(change.entity, key, now[key], result.groups),
				}));
		}
		return [
			{
				field: FIELDS[change.column] ?? change.column,
				rows,
				kind: kindOf(change.column),
				from: befores.map((before) => show(change.entity, change.column, before, result.groups)),
				to: show(change.entity, change.column, change.after, result.groups),
			},
		];
	});
}

// "Duct (slices 4 to 9)" - a deleted row by name, and where it was in a
// volume, so a history line says which slice lost something.
function deletedRowText(row: Pick<DeletedRow, "name" | "sliceFrom" | "sliceTo">): string {
	const name = row.name || "one with no name";
	const slices = sliceRangeText(row);
	return slices ? `${name} (${slices})` : name;
}

// "Region 7, Count 2 and 2,138 more" - what it took out, by name.
function deletedLine(result: ChangeSetChanges): string | null {
	if (result.deleted === 0) return null;
	const names = result.deletedRows ? result.deletedRows.map(deletedRowText) : result.deletedNames.map((n) => n || "one with no name");
	const more = result.deleted - names.length;
	if (more <= 0) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
	return `${names.join(", ")} and ${number(more)} more`;
}

// "Show all 2,140", when it deleted more than the few it names - or nothing.
function showAllDeleted(result: ChangeSetChanges): string | null {
	return result.deleted > result.deletedNames.length ? `Show all ${number(result.deleted)}` : null;
}

function deletedPath(changeSetId: string, search: string, skip: number, take: number): string {
	const params = new URLSearchParams({ skip: String(skip), take: String(take) });
	if (search.trim()) params.set("search", search.trim());
	return `/changesets/${encodeURIComponent(changeSetId)}/deleted?${params}`;
}

// How many there are, above the list - "2,140 deleted", or "12 of 2,140" once
// it's searched.
function deletedCount(all: number, matching: number, search: string): string {
	if (!search.trim()) return `${number(all)} deleted`;
	return matching === 0 ? `None of the ${number(all)} match` : `${number(matching)} of ${number(all)}`;
}

export { changeLines, deletedCount, deletedLine, deletedPath, deletedRowText, showAllDeleted };
export type { ChangeSetChanges, ChangeLine, DeletedPage, DeletedRow, FieldChange, Shown };
