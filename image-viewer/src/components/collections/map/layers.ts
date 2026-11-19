// What's on the map from the active collection, and why the rest isn't - the
// On the map tab's chips. Each person and each group is a chip that can be
// turned off. Off chips are yours alone, and last until you move collection.
// See docs/layers.md.

interface Drawn {
	created: string;
	groupId?: string | null;
	createdById?: string;
	createdByName?: string;
}

interface Chip {
	// A Keycloak id or a group id, or NOBODY / UNGROUPED.
	key: string;
	name: string;
	count: number;
}

interface Person extends Chip {
	isMe: boolean;
}

// The chips that are off, a row each.
interface Hidden {
	people: ReadonlySet<string>;
	groups: ReadonlySet<string>;
}

// Annotations saved before sign-in have no author, and annotations in no
// group have no group. Each is a chip of its own, so they can be hidden too.
const NOBODY = "";
const UNGROUPED = "";

const NONE_HIDDEN: Hidden = { people: new Set(), groups: new Set() };

const personKey = (annotation: Drawn): string => annotation.createdById || NOBODY;
const groupKey = (annotation: Drawn): string => annotation.groupId || UNGROUPED;

// Everyone with an annotation here, with how many: you first, then by name,
// then anything from before sign-in. A name comes from their latest
// annotation, in case it's changed since their first.
function peopleIn(annotations: Drawn[], myId: string): Person[] {
	const found = new Map<string, Person & { latest: string }>();
	for (const annotation of annotations) {
		const key = personKey(annotation);
		const person = found.get(key);
		if (!person) {
			found.set(key, { key, name: annotation.createdByName || "", count: 1, isMe: key !== NOBODY && key === myId, latest: annotation.created });
			continue;
		}
		person.count++;
		if (annotation.created > person.latest && annotation.createdByName) {
			person.name = annotation.createdByName;
			person.latest = annotation.created;
		}
	}
	const rank = (p: Person) => (p.isMe ? 0 : p.key === NOBODY ? 2 : 1);
	return [...found.values()]
		.map(({ latest: _latest, ...person }) => ({
			...person,
			name: person.isMe ? "You" : person.key === NOBODY ? "Before sign-in" : person.name || "Someone",
		}))
		.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// The collection's groups by name, each with how many are in it - empty ones
// too, since they're still groups - then None for annotations in no group,
// if there are any.
function groupsIn(annotations: Drawn[], groups: { id: string; name: string }[]): Chip[] {
	const counts = new Map<string, number>();
	for (const annotation of annotations) counts.set(groupKey(annotation), (counts.get(groupKey(annotation)) ?? 0) + 1);
	const named = groups
		.map((group) => ({ key: group.id, name: group.name, count: counts.get(group.id) ?? 0 }))
		.sort((a, b) => a.name.localeCompare(b.name));
	const ungrouped = counts.get(UNGROUPED) ?? 0;
	return ungrouped > 0 ? [...named, { key: UNGROUPED, name: "None", count: ungrouped }] : named;
}

// Whether an annotation is on the map - its person and its group both on.
// The map, the On the map count and the Select tab's All button all go by
// this, so they can't disagree.
function isShown(annotation: Drawn, hidden: Hidden): boolean {
	return !hidden.people.has(personKey(annotation)) && !hidden.groups.has(groupKey(annotation));
}

// Shown by the chips and let through by the open Saved list, when it's
// narrowing the map - exactly what tally counts as shown.
function onTheMap<T extends Drawn>(annotation: T, hidden: Hidden, passesSaved?: (annotation: T) => boolean): boolean {
	return isShown(annotation, hidden) && (!passesSaved || passesSaved(annotation));
}

// A group's annotations that are on the map, by id - what picking a group
// picks, since hidden ones can't be picked.
function shownInGroup<T extends Drawn & { id: string }>(annotations: T[], groupId: string, hidden: Hidden): string[] {
	return annotations.filter((a) => a.groupId === groupId && isShown(a, hidden)).map((a) => a.id);
}

// Every other chip in the row off, so only this one's on the map.
function onlyShowing(row: Chip[], key: string): Set<string> {
	return new Set(row.filter((chip) => chip.key !== key).map((chip) => chip.key));
}

// Whether this chip is the only one on in its row already.
function isOnlyShown(row: Chip[], hidden: ReadonlySet<string>, key: string): boolean {
	return row.length > 1 && !hidden.has(key) && row.every((chip) => chip.key === key || hidden.has(chip.key));
}

interface Tally {
	total: number;
	shown: number;
	// Why the rest are off. Each annotation is counted once, under the first
	// that applies - people, then groups, then the Saved list - so these and
	// shown always add up to total.
	byPeople: number;
	byGroups: number;
	bySaved: number;
}

// How many are on the map out of how many there are, and why. passesSaved is
// the open Saved list's search and filters, when it's narrowing the map.
function tally<T extends Drawn>(annotations: T[], hidden: Hidden, passesSaved?: (annotation: T) => boolean): Tally {
	const counts: Tally = { total: annotations.length, shown: 0, byPeople: 0, byGroups: 0, bySaved: 0 };
	for (const annotation of annotations) {
		if (hidden.people.has(personKey(annotation))) counts.byPeople++;
		else if (hidden.groups.has(groupKey(annotation))) counts.byGroups++;
		else if (passesSaved && !passesSaved(annotation)) counts.bySaved++;
		else counts.shown++;
	}
	return counts;
}

// Each reason for what's off, biggest first, for the line under the bar.
function reasons(counts: Tally): string[] {
	return [
		{ n: counts.byPeople, says: "by people" },
		{ n: counts.byGroups, says: "by groups" },
		{ n: counts.bySaved, says: "by the Saved list" },
	]
		.filter((reason) => reason.n > 0)
		.sort((a, b) => b.n - a.n)
		.map((reason) => `${reason.n} ${reason.says}`);
}

// What the Collections button says when some are off the map - "3
// annotations off the map" - or null when everything's on it.
function offTheMap(counts: Tally): string | null {
	const off = counts.total - counts.shown;
	if (off <= 0) return null;
	return `${off} ${off === 1 ? "annotation" : "annotations"} off the map`;
}

export { NOBODY, UNGROUPED, NONE_HIDDEN, personKey, groupKey, peopleIn, groupsIn, isShown, onTheMap, shownInGroup, onlyShowing, isOnlyShown, tally, reasons, offTheMap };
export type { Drawn, Chip, Person, Hidden, Tally };
