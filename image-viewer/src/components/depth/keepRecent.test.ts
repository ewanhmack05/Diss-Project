import { describe, expect, it } from "vitest";
import { keepRecent } from "./keepRecent";

describe("keepRecent", () => {
	it("keeps only the newest", () => {
		const map = new Map<string, number>();
		keepRecent(map, "liver", 1, 2);
		keepRecent(map, "prostate", 2, 2);
		keepRecent(map, "003", 3, 2);
		expect([...map.keys()]).toEqual(["prostate", "003"]);
	});

	it("using one again makes it the newest, so it's kept", () => {
		const map = new Map<string, number>();
		keepRecent(map, "liver", 1, 2);
		keepRecent(map, "prostate", 2, 2);
		keepRecent(map, "liver", 1, 2);
		keepRecent(map, "003", 3, 2);
		expect([...map.keys()]).toEqual(["liver", "003"]);
	});

	it("replaces a key's value without growing", () => {
		const map = new Map<string, number>([["liver", 1]]);
		keepRecent(map, "liver", 9, 2);
		expect([...map]).toEqual([["liver", 9]]);
	});
});
