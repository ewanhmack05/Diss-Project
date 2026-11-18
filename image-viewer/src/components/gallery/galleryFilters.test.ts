import { describe, expect, it } from "vitest";
import {
	GALLERY_PAGE_SIZE,
	NO_GALLERY_FILTERS,
	activeGalleryFilterCount,
	filterSlides,
	galleryFacets,
	isGalleryFiltered,
	isWorkedOn,
	isZStack,
	matchesSlideSearch,
	neighbourShown,
	pageOf,
	pageOfSlide,
	passesGalleryFilters,
	shownText,
	type GalleryFilters,
	type SlideActivity,
} from "./galleryFilters";
import type { GallerySlide, SlideSummary } from "./slides";

function slide(id: string, extra: Partial<GallerySlide> = {}): GallerySlide {
	return {
		id,
		fileName: `${id}.mrxs`,
		width: 1000,
		height: 1000,
		tileSize: 256,
		objectivePower: 40,
		mppX: 0.25,
		mppY: 0.25,
		kind: "brightfield",
		channels: [],
		slices: [{ index: 0, gapBefore: false }],
		...extra,
	};
}

const volume = (id: string) => slide(id, { kind: null, objectivePower: null, fileName: id, slices: [0, 1, 2].map((index) => ({ index, gapBefore: false })) });

function activity(summaries: SlideSummary[] = [], people: [string, number][] = []): SlideActivity {
	return { summaries: new Map(summaries.map((s) => [s.slideId, s])), people: new Map(people) };
}

const none = activity();

function filters(patch: Partial<GalleryFilters>): GalleryFilters {
	return { ...NO_GALLERY_FILTERS, ...patch };
}

describe("searching slides", () => {
	const scanned = slide("hcrc-019", { name: "019" });

	it("finds the name the scanner gave it, the id or the file name, in any case", () => {
		expect(matchesSlideSearch(scanned, "019")).toBe(true);
		expect(matchesSlideSearch(scanned, "HCRC")).toBe(true);
		expect(matchesSlideSearch(scanned, ".mrxs")).toBe(true);
		expect(matchesSlideSearch(scanned, "liver")).toBe(false);
	});

	it("needs every word, wherever they are", () => {
		expect(matchesSlideSearch(scanned, "hcrc 19")).toBe(true);
		expect(matchesSlideSearch(scanned, "hcrc 20")).toBe(false);
	});

	it("matches everything when there's nothing typed", () => {
		expect(matchesSlideSearch(scanned, "   ")).toBe(true);
	});

	it("searches the id when the scanner gave no name", () => {
		expect(matchesSlideSearch(slide("CMU-1", { name: undefined }), "cmu")).toBe(true);
	});
});

describe("filtering slides", () => {
	it("keeps any of the kinds picked, slides that don't say counting as their own kind", () => {
		const fluorescent = slide("f", { kind: "fluorescence" });
		const unknown = slide("u", { kind: null });
		expect(passesGalleryFilters(fluorescent, filters({ kinds: ["fluorescence"] }), none)).toBe(true);
		expect(passesGalleryFilters(slide("b"), filters({ kinds: ["fluorescence"] }), none)).toBe(false);
		expect(passesGalleryFilters(unknown, filters({ kinds: ["unknown"] }), none)).toBe(true);
	});

	it("tells z-stacks from flat slides by their slices", () => {
		expect(isZStack(volume("liver"))).toBe(true);
		expect(isZStack(slide("flat"))).toBe(false);
		// A tiler from before slices were sent only has flat slides.
		expect(isZStack(slide("old", { slices: undefined }))).toBe(false);
		expect(passesGalleryFilters(volume("liver"), filters({ stacks: "yes" }), none)).toBe(true);
		expect(passesGalleryFilters(volume("liver"), filters({ stacks: "no" }), none)).toBe(false);
	});

	it("keeps any of the objectives picked, leaving out slides that don't say", () => {
		expect(passesGalleryFilters(slide("a", { objectivePower: 20 }), filters({ objectives: [20, 40] }), none)).toBe(true);
		expect(passesGalleryFilters(slide("a", { objectivePower: 10 }), filters({ objectives: [20, 40] }), none)).toBe(false);
		expect(passesGalleryFilters(volume("v"), filters({ objectives: [40] }), none)).toBe(false);
	});

	it("keeps slides with any of the channels picked", () => {
		const dapi = slide("d", { kind: "fluorescence", channels: ["DAPI", "FITC"] });
		expect(passesGalleryFilters(dapi, filters({ channels: ["FITC"] }), none)).toBe(true);
		expect(passesGalleryFilters(dapi, filters({ channels: ["Cy5"] }), none)).toBe(false);
	});

	it("goes by annotation-store for collections", () => {
		const worked = activity([{ slideId: "a", collections: 2, liveSessions: 0 }]);
		expect(passesGalleryFilters(slide("a"), filters({ collections: "yes" }), worked)).toBe(true);
		expect(passesGalleryFilters(slide("b"), filters({ collections: "yes" }), worked)).toBe(false);
		expect(passesGalleryFilters(slide("b"), filters({ collections: "no" }), worked)).toBe(true);
	});

	it("counts a live session or someone with it open as people on it now", () => {
		const live = activity([{ slideId: "s", collections: 1, liveSessions: 1 }], [["p", 2]]);
		expect(isWorkedOn(slide("s"), live)).toBe(true);
		expect(isWorkedOn(slide("p"), live)).toBe(true);
		expect(isWorkedOn(slide("q"), live)).toBe(false);
		expect(filterSlides([slide("s"), slide("p"), slide("q")], "", filters({ working: "yes" }), live).map((s) => s.id)).toEqual(["s", "p"]);
	});

	it("needs every filter and the search, and keeps the order", () => {
		const slides = [slide("hcrc-002"), volume("liver"), slide("hcrc-001", { objectivePower: 20 }), slide("hcrc-003")];
		const shown = filterSlides(slides, "hcrc", filters({ stacks: "no", objectives: [40] }), none);
		expect(shown.map((s) => s.id)).toEqual(["hcrc-002", "hcrc-003"]);
	});

	it("counts each section that's narrowing once", () => {
		expect(activeGalleryFilterCount(NO_GALLERY_FILTERS)).toBe(0);
		expect(activeGalleryFilterCount(filters({ kinds: ["brightfield", "fluorescence"], stacks: "no", working: "yes" }))).toBe(3);
		expect(isGalleryFiltered("", NO_GALLERY_FILTERS)).toBe(false);
		expect(isGalleryFiltered(" x ", NO_GALLERY_FILTERS)).toBe(true);
		expect(isGalleryFiltered("", filters({ collections: "no" }))).toBe(true);
	});
});

describe("the Filter sheet's chips", () => {
	it("counts every slide, kinds in a set order and objectives low to high", () => {
		const facets = galleryFacets([
			slide("a", { kind: "fluorescence", channels: ["FITC", "DAPI"], objectivePower: 40 }),
			slide("b", { objectivePower: 20 }),
			slide("c"),
			volume("liver"),
		]);
		expect(facets.kinds).toEqual([
			{ value: "brightfield", count: 2 },
			{ value: "fluorescence", count: 1 },
			{ value: "unknown", count: 1 },
		]);
		expect(facets.objectives).toEqual([
			{ value: 20, count: 1 },
			{ value: 40, count: 2 },
		]);
		expect(facets.channels.map((c) => c.value)).toEqual(["DAPI", "FITC"]);
		expect(facets.zStacks).toBe(1);
	});
});

describe("moving along what's showing", () => {
	const all = ["a", "b", "c", "d", "e"].map((id) => slide(id));
	const shown = [all[0], all[2], all[4]];

	it("steps between the ones showing", () => {
		expect(neighbourShown(shown, all, "c", 1)?.id).toBe("e");
		expect(neighbourShown(shown, all, "c", -1)?.id).toBe("a");
		expect(neighbourShown(shown, all, "e", 1)).toBeNull();
	});

	it("goes to the nearest showing one either side of an open slide that's filtered out", () => {
		expect(neighbourShown(shown, all, "b", 1)?.id).toBe("c");
		expect(neighbourShown(shown, all, "b", -1)?.id).toBe("a");
		expect(neighbourShown(shown, all, "d", 1)?.id).toBe("e");
		expect(neighbourShown([all[0]], all, "d", 1)).toBeNull();
	});

	it("has nowhere to go from a slide the tiler doesn't have", () => {
		expect(neighbourShown(shown, all, "zzz", 1)).toBeNull();
	});
});

describe("pages of cards", () => {
	const many = Array.from({ length: 60 }, (_, i) => slide(`s${i}`));

	it("opens on the page the open slide's on, or the first", () => {
		expect(pageOfSlide(many, "s0", GALLERY_PAGE_SIZE)).toBe(0);
		expect(pageOfSlide(many, `s${GALLERY_PAGE_SIZE}`, GALLERY_PAGE_SIZE)).toBe(1);
		expect(pageOfSlide(many, "s59", GALLERY_PAGE_SIZE)).toBe(2);
		expect(pageOfSlide(many, "gone", GALLERY_PAGE_SIZE)).toBe(0);
	});

	it("cuts a page out, the last one short", () => {
		expect(pageOf(many, 0, 24).map((s) => s.id)).toEqual(many.slice(0, 24).map((s) => s.id));
		expect(pageOf(many, 2, 24)).toHaveLength(12);
	});
});

describe("how many are showing", () => {
	const shown = [slide("a"), slide("b"), slide("c")];

	it("says where the open one is among them, and how many there are in all", () => {
		expect(shownText(shown, 202, "b")).toBe("2 of 3 · 202 in all");
	});

	it("says how many show when the open one isn't one of them", () => {
		expect(shownText(shown, 1500, "z")).toBe("3 showing · 1,500 in all");
	});
});
