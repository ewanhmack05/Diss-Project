import type { Annotation } from "../../../interfaces/Annotation";
import type { AnnotationGroup } from "../../../interfaces/AnnotationGroup";
import type { CellCount } from "../../../interfaces/CellCount";
import type { CellCountGroup } from "../../../interfaces/CellCountGroup";
import type { ImageAdjustmentPreset } from "../../../interfaces/ImageAdjustment";
import type { AnnotationOp } from "../../realtime/realtime";
import type { TextWas } from "../../realtime/putText";
import { withWhen } from "../../realtime/storedText";

// One change in a collection, as GET /changesets gives it - see
// annotation-store's History/. deleted is how many rows it deleted that
// are still deleted, so 0 once it's been put back.
interface ChangeSet {
	id: string;
	collectionId: string;
	userId: string;
	userName: string;
	what: string;
	created: string;
	deleted: number;
	// Where it came from, when it's something sent in a message.
	source?: ChangeSetSource | null;
}

interface ChangeSetSource {
	messageId: string;
	fromUserId: string;
	fromName: string;
	kind: string;
	name: string;
	collectionId: string | null;
	slideId: string | null;
	annotations: number;
	cellCounts: number;
}

interface RestoreCounts {
	annotations: number;
	groups: number;
	cellCounts: number;
	imageAdjustments: number;
	// The change deleted the collection itself.
	collection: boolean;
	cellCountGroups?: number;
}

// What POST /changesets/{id}/restore answers - the counts, and the rows it
// put back. Cell counts come as the Saved list has them, without dots.
interface Restored {
	counts: RestoreCounts;
	annotations: Annotation[];
	groups: (AnnotationGroup & { count?: number })[];
	cellCounts: CellCount[];
	imageAdjustments: ImageAdjustmentPreset[];
	// Were already there, and went back how they were - put back in the
	// group a delete or merge took them out of, or a recolour undone.
	changedAnnotations: Annotation[];
	// The same for cell counts, without dots.
	changedCellCounts?: CellCount[];
	cellCountGroups?: CellCountGroup[];
	// Groups already there whose name or notes went back.
	changedGroups?: (AnnotationGroup & { count?: number })[];
	changedCellCountGroups?: CellCountGroup[];
	// What the text it put back over said.
	textWas?: TextWas[];
}

const number = (n: number) => n.toLocaleString("en-GB");

function plural(n: number, one: string, many: string): string {
	return `${number(n)} ${n === 1 ? one : many}`;
}

// What each `what` reads as. A bulk delete says how many, while it still
// knows - once put back, deleted is 0 and the count's gone with it.
const LABELS: Record<string, (deleted: number) => string> = {
	"add annotation": () => "Added an annotation",
	"change annotation": () => "Changed an annotation",
	"change annotation slices": () => "Moved an annotation between slices",
	"delete annotation": () => "Deleted an annotation",
	"change annotations": () => "Changed annotations",
	"delete annotations": (deleted) => (deleted > 0 ? `Deleted ${plural(deleted, "annotation", "annotations")}` : "Deleted annotations"),
	"add group": () => "Added a group",
	"change group": () => "Changed a group",
	"merge groups": () => "Merged two groups",
	"delete group": () => "Deleted a group",
	"add cell count group": () => "Added a group of cell counts",
	"change cell count group": () => "Changed a group of cell counts",
	"delete cell count group": () => "Deleted a group of cell counts",
	"change cell counts": () => "Moved cell counts between groups",
	"add cell count": () => "Added a cell count",
	"change cell count": () => "Changed a cell count",
	"delete cell count": () => "Deleted a cell count",
	"add image adjustment": () => "Saved an image adjustment",
	"change image adjustment": () => "Changed an image adjustment",
	"delete image adjustment": () => "Deleted an image adjustment",
	import: () => "Imported a GeoJSON file",
	"delete collection": () => "Deleted the collection",
	restore: () => "Put back a change",
	"restore annotation": () => "Put an annotation back",
	"restore cell count": () => "Put a cell count back",
	"restore collection": () => "Put the whole collection back",
	"rename collection": () => "Renamed the collection",
	"share collection": () => "Shared the collection",
	"stop sharing collection": () => "Stopped sharing the collection",
	"end session": () => "Ended the session",
	"join session": () => "Joined the session",
	"leave session": () => "Left the session",
	"change role": () => "Changed someone's access",
	"remove member": () => "Took someone out of the session",
	"make invite link": () => "Made an invite link",
	"change invite link": () => "Changed the invite link",
	"stop invite link": () => "Stopped the invite link",
};

// Who can see or change the collection, rather than what's in it - the
// store's ChangeKinds.PeopleWhats.
const PEOPLE = new Set([
	"share collection",
	"stop sharing collection",
	"end session",
	"join session",
	"leave session",
	"change role",
	"remove member",
	"make invite link",
	"change invite link",
	"stop invite link",
]);

// "12 annotations and a cell count", or what it was called if that says nothing.
function sentList({ annotations, cellCounts, name }: ChangeSetSource): string {
	const parts = [
		annotations === 1 ? "an annotation" : annotations > 1 && plural(annotations, "annotation", "annotations"),
		cellCounts === 1 ? "a cell count" : cellCounts > 1 && plural(cellCounts, "cell count", "cell counts"),
	].filter((part): part is string => !!part);
	return parts.length > 0 ? parts.join(" and ") : name;
}

function changeLabel({ what, deleted, source }: Pick<ChangeSet, "what" | "deleted"> & Pick<Partial<ChangeSet>, "source">): string {
	if (what === "add from message") return source ? `Added ${sentList(source)} from ${source.fromName}` : "Added something from a message";
	const label = LABELS[what];
	if (label) return label(deleted);
	// Anything newer than this list still reads as something.
	return what ? what[0].toUpperCase() + what.slice(1) : "Changed something";
}

// Whether it deleted something and that's all been put back since.
function wasPutBack({ what, deleted }: Pick<ChangeSet, "what" | "deleted">): boolean {
	return deleted === 0 && (what.startsWith("delete") || what === "merge groups");
}

// The one place that says who can put a change back. annotation-store lets
// any editor restore anyone's change (it's rollback, not undo), so this
// matches. If that's narrowed to the author and the host, change it here
// and in annotation-store's History/ChangeSets.cs.
function canRestore(changeSet: Pick<ChangeSet, "deleted" | "what">, canEdit: boolean): boolean {
	// A deleted collection is never the one you're in, so it can't be put
	// back from its own history.
	return canEdit && changeSet.deleted > 0 && changeSet.what !== "delete collection";
}

// "2,140 annotations and a group" - what a restore will or did bring back.
function restoredList(counts: Omit<RestoreCounts, "collection">): string {
	const parts = [
		counts.annotations > 0 && plural(counts.annotations, "annotation", "annotations"),
		counts.groups + (counts.cellCountGroups ?? 0) > 0 && plural(counts.groups + (counts.cellCountGroups ?? 0), "group", "groups"),
		counts.cellCounts > 0 && plural(counts.cellCounts, "cell count", "cell counts"),
		counts.imageAdjustments > 0 && plural(counts.imageAdjustments, "image adjustment", "image adjustments"),
	].filter((part): part is string => !!part);
	if (parts.length === 0) return "nothing";
	if (parts.length === 1) return parts[0];
	return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// The toast once it's done. Someone else may have put it back first, so
// it can be nothing.
function restoredMessage(counts: RestoreCounts): string {
	if (counts.collection) return "Put the collection back";
	const list = restoredList(counts);
	return list === "nothing" ? "Nothing to put back - it was already back" : `Put back ${list}`;
}

// What it deleted that's still deleted, for one change opened up - or
// that it's all back. Nothing for a change that didn't delete anything.
const DELETED_NOUNS: Record<string, [string, string]> = {
	"delete annotation": ["annotation", "annotations"],
	"delete annotations": ["annotation", "annotations"],
	"delete group": ["group", "groups"],
	"delete cell count group": ["group", "groups"],
	"merge groups": ["group", "groups"],
	"delete cell count": ["cell count", "cell counts"],
	"delete image adjustment": ["image adjustment", "image adjustments"],
};

function restoreStatus(changeSet: Pick<ChangeSet, "what" | "deleted">): string | null {
	if (wasPutBack(changeSet)) return "Already put back";
	if (changeSet.deleted === 0) return null;
	const [one, many] = DELETED_NOUNS[changeSet.what] ?? ["thing", "things"];
	return `${plural(changeSet.deleted, one, many)} still deleted`;
}

// Said above Put back, so it's clear what happens before it does.
function restoreNote({ what }: Pick<ChangeSet, "what">): string {
	const everyone = "It comes back for everyone in this collection, as a change of its own.";
	// Anything moved out of it since stays where it was moved to.
	return what === "delete group" || what === "merge groups" ? `${everyone} The group comes back with what was in it.` : everyone;
}

// Which icon a row gets.
type ChangeKind = "add" | "change" | "delete" | "merge" | "import" | "restore" | "people";

function changeKind(what: string): ChangeKind {
	if (what === "import") return what;
	if (PEOPLE.has(what)) return "people";
	if (what.startsWith("restore")) return "restore";
	if (what === "merge groups") return "merge";
	if (what.startsWith("add")) return "add";
	if (what.startsWith("delete")) return "delete";
	return "change";
}

// What each kind is called in the History filter, in the order it lists
// them - the store's ChangeKinds.All.
const KIND_LABELS: Record<ChangeKind, string> = {
	add: "Added",
	change: "Changed",
	delete: "Deleted",
	merge: "Merged",
	import: "Imported",
	restore: "Put back",
	people: "People and sharing",
};

// "AM" for Alice Moore - first and last word.
function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "?";
	const first = words[0][0];
	const last = words.length > 1 ? words[words.length - 1][0] : "";
	return (first + last).toUpperCase();
}

// Enough of a change set's id to tell it apart, and to find it in the store.
function shortId(id: string): string {
	return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

// A page of changes under day headings, keeping their order. The heading
// is worked out by the caller (savedDates' dayHeading), so this stays plain.
function byDay<T extends { created: string }>(items: T[], heading: (iso: string) => string): { heading: string; items: T[] }[] {
	const days: { heading: string; items: T[] }[] = [];
	for (const item of items) {
		const label = heading(item.created);
		const last = days[days.length - 1];
		if (last && last.heading === label) last.items.push(item);
		else days.push({ heading: label, items: [item] });
	}
	return days;
}

// Everyone else is told with a create per row, the same as an import, and an
// update for each one that was already there. Image adjustments are
// personal, so nobody else needs them. at is the store's stamp on the text
// (see storedText.ts).
function restoredOps(restored: Restored, at?: number): AnnotationOp[] {
	// Groups first, so an annotation that's in one never arrives before it.
	return [
		...restored.groups.map(({ count: _count, ...group }): AnnotationOp => ({
			kind: "create",
			entity: "annotationGroup",
			id: group.id,
			data: { ...group, notes: group.notes ?? "" },
		})),
		...(restored.cellCountGroups ?? []).map((group): AnnotationOp => ({ kind: "create", entity: "cellCountGroup", id: group.id, data: group })),
		...(restored.changedGroups ?? []).map(({ id, name, notes }): AnnotationOp => ({
			kind: "update",
			entity: "annotationGroup",
			id,
			data: { name, notes: notes ?? "" },
		})),
		...(restored.changedCellCountGroups ?? []).map(({ id, name, notes }): AnnotationOp => ({
			kind: "update",
			entity: "cellCountGroup",
			id,
			data: { name, notes },
		})),
		...restored.annotations.map((a): AnnotationOp => ({ kind: "create", entity: "annotation", id: a.id, data: a })),
		...(restored.changedAnnotations ?? []).map((a): AnnotationOp => ({ kind: "update", entity: "annotation", id: a.id, data: withWhen(a, { at, putBack: true }) })),
		...restored.cellCounts.map((c): AnnotationOp => ({ kind: "create", entity: "cellCount", id: c.id, data: c })),
		// Without dots, which the store left out - a null would wipe the ones
		// they have loaded.
		...(restored.changedCellCounts ?? []).map(({ dots: _dots, ...c }): AnnotationOp => ({
			kind: "update",
			entity: "cellCount",
			id: c.id,
			data: withWhen(c, { at, putBack: true }),
		})),
	];
}

export {
	KIND_LABELS,
	changeLabel,
	wasPutBack,
	canRestore,
	restoredList,
	restoredMessage,
	restoreStatus,
	restoreNote,
	changeKind,
	initials,
	shortId,
	byDay,
	restoredOps,
};
export type { ChangeSetSource, ChangeSet, ChangeKind, Restored, RestoreCounts };
