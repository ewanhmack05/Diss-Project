import { describe, expect, it } from "vitest";
import {
	NOBODY,
	NONE_HIDDEN,
	UNGROUPED,
	groupKey,
	groupsIn,
	isOnlyShown,
	isShown,
	offTheMap,
	onTheMap,
	shownInGroup,
	onlyShowing,
	peopleIn,
	personKey,
	reasons,
	tally,
	type Drawn,
	type Hidden,
} from "./layers";

const drawn = (createdById?: string, createdByName?: string, groupId?: string | null, created = "2026-11-01T10:00:00Z"): Drawn => ({
	created,
	createdById,
	createdByName,
	groupId,
});

const hiding = (people: string[] = [], groups: string[] = []): Hidden => ({ people: new Set(people), groups: new Set(groups) });

describe("peopleIn", () => {
	it("is nobody when there's nothing drawn", () => {
		expect(peopleIn([], "me")).toEqual([]);
	});

	it("counts each person's annotations", () => {
		const people = peopleIn([drawn("bob", "Bob Hughes"), drawn("bob", "Bob Hughes"), drawn("ann", "Ann Lee")], "me");
		expect(people).toEqual([
			{ key: "ann", name: "Ann Lee", count: 1, isMe: false },
			{ key: "bob", name: "Bob Hughes", count: 2, isMe: false },
		]);
	});

	it("puts you first as You, then by name, then before sign-in last", () => {
		const people = peopleIn([drawn(), drawn("zoe", "Zoe Park"), drawn("me", "Ewan M"), drawn("ann", "Ann Lee")], "me");
		expect(people.map((p) => p.name)).toEqual(["You", "Ann Lee", "Zoe Park", "Before sign-in"]);
		expect(people[0].isMe).toBe(true);
	});

	it("treats an empty id the same as a missing one", () => {
		expect(peopleIn([drawn("", ""), drawn()], "me")).toEqual([{ key: NOBODY, name: "Before sign-in", count: 2, isMe: false }]);
	});

	it("never calls the before sign-in chip you, even with no id of your own", () => {
		expect(peopleIn([drawn()], "")[0].isMe).toBe(false);
	});

	it("takes the name from their latest annotation", () => {
		const people = peopleIn(
			[
				drawn("bob", "Bob H", null, "2026-11-01T10:00:00Z"),
				drawn("bob", "Bob Hughes", null, "2026-11-03T10:00:00Z"),
				drawn("bob", "Robert", null, "2026-11-02T10:00:00Z"),
			],
			"me",
		);
		expect(people[0].name).toBe("Bob Hughes");
	});

	it("keeps a name it has when a later annotation has none", () => {
		const people = peopleIn([drawn("bob", "Bob Hughes", null, "2026-11-01T10:00:00Z"), drawn("bob", "", null, "2026-11-05T10:00:00Z")], "me");
		expect(people[0].name).toBe("Bob Hughes");
	});

	it("says Someone for a person with no name at all", () => {
		expect(peopleIn([drawn("bob", "")], "me")[0].name).toBe("Someone");
	});
});

describe("groupsIn", () => {
	const groups = [
		{ id: "g2", name: "Vessels" },
		{ id: "g1", name: "Tumour margin" },
	];

	it("lists groups by name with their counts, then None for the rest", () => {
		const chips = groupsIn([drawn("a", "A", "g1"), drawn("a", "A", "g1"), drawn("a", "A", "g2"), drawn("a", "A", null)], groups);
		expect(chips).toEqual([
			{ key: "g1", name: "Tumour margin", count: 2 },
			{ key: "g2", name: "Vessels", count: 1 },
			{ key: UNGROUPED, name: "None", count: 1 },
		]);
	});

	it("keeps empty groups, since they're still groups", () => {
		expect(groupsIn([], groups).map((c) => c.count)).toEqual([0, 0]);
	});

	it("has no None chip when everything's in a group", () => {
		expect(groupsIn([drawn("a", "A", "g1")], groups).some((c) => c.key === UNGROUPED)).toBe(false);
	});

	it("makes no chip for a group id it hasn't loaded", () => {
		// Deleting a group clears its annotations' groupId (forgetGroup), so
		// this is only the moment between the two.
		expect(groupsIn([drawn("a", "A", "not-loaded")], [])).toEqual([]);
	});
});

describe("isShown", () => {
	it("shows everything when nothing's hidden", () => {
		expect(isShown(drawn("bob", "Bob", "g1"), NONE_HIDDEN)).toBe(true);
	});

	it("hides a hidden person's annotations", () => {
		expect(isShown(drawn("bob", "Bob"), hiding(["bob"]))).toBe(false);
		expect(isShown(drawn("ann", "Ann"), hiding(["bob"]))).toBe(true);
	});

	it("hides annotations from before sign-in as their own person", () => {
		expect(isShown(drawn(), hiding([NOBODY]))).toBe(false);
		expect(isShown(drawn("bob", "Bob"), hiding([NOBODY]))).toBe(true);
	});

	it("hides a hidden group's annotations, whoever drew them", () => {
		expect(isShown(drawn("bob", "Bob", "g1"), hiding([], ["g1"]))).toBe(false);
		expect(isShown(drawn("bob", "Bob", "g2"), hiding([], ["g1"]))).toBe(true);
	});

	it("hides annotations in no group with the None chip, and only those", () => {
		expect(isShown(drawn("bob", "Bob", null), hiding([], [UNGROUPED]))).toBe(false);
		expect(isShown(drawn("bob", "Bob"), hiding([], [UNGROUPED]))).toBe(false);
		expect(isShown(drawn("bob", "Bob", "g1"), hiding([], [UNGROUPED]))).toBe(true);
	});

	it("needs both the person and the group on", () => {
		expect(isShown(drawn("bob", "Bob", "g2"), hiding(["bob"], ["g1"]))).toBe(false);
	});

	it("keeps people and groups apart, though NOBODY and UNGROUPED are both empty", () => {
		expect(isShown(drawn("bob", "Bob", null), hiding([NOBODY]))).toBe(true);
		expect(isShown(drawn(undefined, undefined, "g1"), hiding([], [UNGROUPED]))).toBe(true);
	});
});

describe("onTheMap", () => {
	it("is isShown when the Saved list isn't narrowing the map", () => {
		expect(onTheMap(drawn("bob", "Bob", "g1"), NONE_HIDDEN)).toBe(true);
		expect(onTheMap(drawn("bob", "Bob", "g1"), hiding([], ["g1"]))).toBe(false);
	});

	it("needs the chips and the Saved list both to let it through", () => {
		const onlyAnn = (a: Drawn) => a.createdById === "ann";
		expect(onTheMap(drawn("ann", "Ann", "g1"), NONE_HIDDEN, onlyAnn)).toBe(true);
		expect(onTheMap(drawn("bob", "Bob", "g1"), NONE_HIDDEN, onlyAnn)).toBe(false);
		expect(onTheMap(drawn("ann", "Ann", "g1"), hiding(["ann"]), onlyAnn)).toBe(false);
	});
});

describe("shownInGroup", () => {
	const annotations = [
		{ ...drawn("bob", "Bob", "g1"), id: "a" },
		{ ...drawn("ann", "Ann", "g1"), id: "b" },
		{ ...drawn("ann", "Ann", "g2"), id: "c" },
		{ ...drawn("ann", "Ann", null), id: "d" },
	];

	it("is the group's annotations", () => {
		expect(shownInGroup(annotations, "g1", NONE_HIDDEN)).toEqual(["a", "b"]);
	});

	it("leaves out a hidden person's", () => {
		expect(shownInGroup(annotations, "g1", hiding(["bob"]))).toEqual(["b"]);
	});

	it("is nothing when the group itself is hidden", () => {
		expect(shownInGroup(annotations, "g1", hiding([], ["g1"]))).toEqual([]);
	});

	it("is nothing for a group with nothing in it", () => {
		expect(shownInGroup(annotations, "empty", NONE_HIDDEN)).toEqual([]);
	});
});

describe("onlyShowing and isOnlyShown", () => {
	const row = peopleIn([drawn("me", "Ewan"), drawn("bob", "Bob"), drawn()], "me");

	it("turns off every other chip in the row", () => {
		expect(onlyShowing(row, "me")).toEqual(new Set(["bob", NOBODY]));
	});

	it("knows when a chip's already the only one on", () => {
		expect(isOnlyShown(row, onlyShowing(row, "bob"), "bob")).toBe(true);
		expect(isOnlyShown(row, onlyShowing(row, "bob"), "me")).toBe(false);
		expect(isOnlyShown(row, new Set(), "bob")).toBe(false);
	});

	it("never says only for the one chip there is", () => {
		const alone = peopleIn([drawn("me", "Ewan")], "me");
		expect(isOnlyShown(alone, new Set(), "me")).toBe(false);
	});

	it("works the same for a row of groups", () => {
		const groups = groupsIn([drawn("a", "A", "g1"), drawn("a", "A", null)], [{ id: "g1", name: "Margin" }]);
		expect(onlyShowing(groups, "g1")).toEqual(new Set([UNGROUPED]));
	});
});

describe("tally", () => {
	const annotations = [
		drawn("bob", "Bob", "g1"),
		drawn("bob", "Bob", null),
		drawn("ann", "Ann", "g1"),
		drawn("ann", "Ann", "g2"),
		drawn("ann", "Ann", null),
	];

	it("is everything shown with nothing hidden", () => {
		expect(tally(annotations, NONE_HIDDEN)).toEqual({ total: 5, shown: 5, byPeople: 0, byGroups: 0, bySaved: 0 });
	});

	it("counts each off annotation once, people first", () => {
		// Bob's g1 one is off by person and by group - it counts under people.
		expect(tally(annotations, hiding(["bob"], ["g1"]))).toEqual({ total: 5, shown: 2, byPeople: 2, byGroups: 1, bySaved: 0 });
	});

	it("counts the Saved list last, only for what the chips let through", () => {
		const onlyAnn = (a: Drawn) => a.createdById === "ann";
		expect(tally(annotations, hiding([], ["g2"]), onlyAnn)).toEqual({ total: 5, shown: 2, byPeople: 0, byGroups: 1, bySaved: 2 });
	});

	it("always adds up to the total, for every mix", () => {
		const people = [[], ["bob"], ["ann"], ["bob", "ann"]];
		const groups = [[], ["g1"], [UNGROUPED], ["g1", "g2", UNGROUPED]];
		const saved = [undefined, () => true, () => false, (a: Drawn) => a.groupId === "g1"];
		for (const p of people)
			for (const g of groups)
				for (const s of saved) {
					const counts = tally(annotations, hiding(p, g), s);
					expect(counts.shown + counts.byPeople + counts.byGroups + counts.bySaved).toBe(counts.total);
					// And shown is exactly what the map and the 3D block draw.
					expect(counts.shown).toBe(annotations.filter((a) => onTheMap(a, hiding(p, g), s)).length);
				}
	});
});

describe("reasons", () => {
	it("is nothing when everything's shown", () => {
		expect(reasons({ total: 3, shown: 3, byPeople: 0, byGroups: 0, bySaved: 0 })).toEqual([]);
	});

	it("lists the biggest first, and leaves out ones that hide nothing", () => {
		expect(reasons({ total: 20, shown: 5, byPeople: 3, byGroups: 0, bySaved: 12 })).toEqual(["12 by the Saved list", "3 by people"]);
	});
});

describe("offTheMap", () => {
	it("is nothing when everything's shown, or there's nothing", () => {
		expect(offTheMap({ total: 4, shown: 4, byPeople: 0, byGroups: 0, bySaved: 0 })).toBeNull();
		expect(offTheMap({ total: 0, shown: 0, byPeople: 0, byGroups: 0, bySaved: 0 })).toBeNull();
	});

	it("counts everything off, whatever the reason", () => {
		expect(offTheMap({ total: 24, shown: 7, byPeople: 9, byGroups: 3, bySaved: 5 })).toBe("17 annotations off the map");
	});

	it("says annotation for one", () => {
		expect(offTheMap({ total: 2, shown: 1, byPeople: 0, byGroups: 0, bySaved: 1 })).toBe("1 annotation off the map");
	});

	it("follows the tally, so the dot and the tab agree", () => {
		const annotations = [drawn("bob", "Bob", "g1"), drawn("ann", "Ann")];
		expect(offTheMap(tally(annotations, hiding(["bob"])))).toBe("1 annotation off the map");
		expect(offTheMap(tally(annotations, NONE_HIDDEN))).toBeNull();
		expect(offTheMap(tally(annotations, NONE_HIDDEN, () => false))).toBe("2 annotations off the map");
	});
});

describe("keys", () => {
	it("are the id, or the empty key without one", () => {
		expect(personKey(drawn("bob", "Bob"))).toBe("bob");
		expect(personKey(drawn())).toBe(NOBODY);
		expect(groupKey(drawn("a", "A", "g1"))).toBe("g1");
		expect(groupKey(drawn("a", "A", null))).toBe(UNGROUPED);
	});
});
