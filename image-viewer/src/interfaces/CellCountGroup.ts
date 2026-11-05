// A named set of cell counts inside one collection - see annotation-store's
// CellCounts/CellCountGroup.cs. One level, and a count is in at most one (its
// groupId). Count is how many are in it, as the store last said.
interface CellCountGroup {
	id: string;
	collectionId: string;
	name: string;
	notes: string;
	created: string;
	count: number;
}

export type { CellCountGroup };
