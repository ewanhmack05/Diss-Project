// Putting a whole collection back to how it was just after a change, as
// annotation-store's History/CollectionRollback.cs does it, and the wording.

interface RollbackCounts {
	back: number;
	changed: number;
	gone: number;
}

// What GET and POST /changesets/{id}/rollback answer.
interface RollbackView {
	annotations: RollbackCounts;
	groups: RollbackCounts;
	cellCounts: RollbackCounts;
	// The collection's newest entry, to send back with the rollback.
	latest: number | null;
	entriesWalked: number;
	fromSnapshot: boolean;
}

const number = (n: number) => n.toLocaleString("en-GB");

function plural(n: number, one: string, many: string): string {
	return `${number(n)} ${n === 1 ? one : many}`;
}

function previewPath(changeSetId: string): string {
	return `/changesets/${encodeURIComponent(changeSetId)}/rollback`;
}

// latest is the newest entry you were looking at - if there's a newer one the
// store says so, rather than undoing something you haven't seen.
function rollbackPath(changeSetId: string, latest: number | null): string {
	const path = previewPath(changeSetId);
	return latest === null ? path : `${path}?latest=${latest}`;
}

// A deleted collection is never the one you're in. Who can is the same as for
// putting a change back - see canRestore.
function canRollBack({ what }: { what: string }, canEdit: boolean): boolean {
	return canEdit && what !== "delete collection";
}

// One line for each kind of row and thing that'd happen to it.
function rollbackLines({ annotations, groups, cellCounts }: Pick<RollbackView, "annotations" | "groups" | "cellCounts">): string[] {
	const kinds: [RollbackCounts, string, string][] = [
		[annotations, "annotation", "annotations"],
		[groups, "group", "groups"],
		[cellCounts, "cell count", "cell counts"],
	];
	return kinds.flatMap(([counts, one, many]) => [
		...(counts.back > 0 ? [`${plural(counts.back, one, many)} ${counts.back === 1 ? "comes" : "come"} back`] : []),
		...(counts.changed > 0
			? [`${plural(counts.changed, one, many)} ${counts.changed === 1 ? "goes" : "go"} back how ${counts.changed === 1 ? "it was" : "they were"}`]
			: []),
		...(counts.gone > 0 ? [`${plural(counts.gone, one, many)} added since ${counts.gone === 1 ? "is" : "are"} taken out`] : []),
	]);
}

function nothingToDo(view: Pick<RollbackView, "annotations" | "groups" | "cellCounts">): boolean {
	return rollbackLines(view).length === 0;
}

// Said above the button, so it's clear what happens before it does.
const ROLLBACK_NOTE =
	"This undoes every change since this one, whoever made it, for everyone in this collection. It's a change of its own, so anything taken out can come back, and it can be gone back on too. Image adjustments stay as they are.";

export { canRollBack, nothingToDo, previewPath, rollbackLines, rollbackPath, ROLLBACK_NOTE };
export type { RollbackCounts, RollbackView };
