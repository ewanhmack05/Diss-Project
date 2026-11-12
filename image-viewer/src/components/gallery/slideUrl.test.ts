import { describe, expect, it } from "vitest";
import { isSlideId, searchWithSlide, slideFromSearch } from "./slideUrl";

describe("slideFromSearch", () => {
	it("reads ?slide=", () => {
		expect(slideFromSearch("?slide=001")).toBe("001");
	});

	it("is found next to an invite", () => {
		expect(slideFromSearch("?invite=abc_DEF-123&slide=002")).toBe("002");
	});

	it("is null when it isn't there or is empty", () => {
		expect(slideFromSearch("")).toBeNull();
		expect(slideFromSearch("?invite=abc")).toBeNull();
		expect(slideFromSearch("?slide=")).toBeNull();
		expect(slideFromSearch("?slide=%20%20")).toBeNull();
	});

	it("trims what's around it", () => {
		expect(slideFromSearch("?slide=%20003%20")).toBe("003");
	});

	// It goes into the tiler's path, so nothing that could be more than a name.
	it.each(["../003", "003/../../etc", "a b", "<script>", "003?x", "%2e%2e", ".hidden", "x".repeat(65)])("turns down %s", (bad) => {
		expect(slideFromSearch(`?slide=${encodeURIComponent(bad)}`)).toBeNull();
	});

	it("takes ids with dots, dashes and underscores in", () => {
		expect(slideFromSearch("?slide=CMU-1_small.v2")).toBe("CMU-1_small.v2");
	});
});

describe("isSlideId", () => {
	it("is false for nothing", () => {
		expect(isSlideId(null)).toBe(false);
		expect(isSlideId(undefined)).toBe(false);
		expect(isSlideId("")).toBe(false);
	});
});

describe("searchWithSlide", () => {
	it("adds the slide", () => {
		expect(searchWithSlide("", "001", "003")).toBe("?slide=001");
	});

	it("changes the one that's there", () => {
		expect(searchWithSlide("?slide=001", "002", "003")).toBe("?slide=002");
	});

	it("keeps everything else in the query", () => {
		expect(searchWithSlide("?renderer=canvas&slide=001", "002", "003")).toBe("?renderer=canvas&slide=002");
	});

	// The slide it starts on keeps the plain address.
	it("leaves the start slide out", () => {
		expect(searchWithSlide("?slide=001", "003", "003")).toBe("");
		expect(searchWithSlide("?renderer=canvas&slide=001", "003", "003")).toBe("?renderer=canvas");
	});

	it("goes back and forth to the same address", () => {
		const there = searchWithSlide("?renderer=canvas", "001", "003");
		expect(slideFromSearch(there)).toBe("001");
		expect(searchWithSlide(there, "003", "003")).toBe("?renderer=canvas");
	});
});
