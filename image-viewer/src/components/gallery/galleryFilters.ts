// What the gallery's search box and Filter sheet narrow the slides to. All of
// it's worked out here from what the tiler and annotation-store already said
// about each slide - nothing goes back to a server - so it's instant, and the
// same with 4 slides or 4,000.

import type { Either } from "../saved/filters";
import { slideName, type GallerySlide, type SlideSummary } from "./slides";

// In the kinds filter, for a slide that doesn't say what it is.
const UNKNOWN_KIND = "unknown";

interface GalleryFilters {
	// "brightfield", "fluorescence" or UNKNOWN_KIND - any of these.
	kinds: string[];
	// Objective powers, 40 for x40 - any of these.
	objectives: number[];
	// Fluorescence channel names - slides with any of these.
	channels: string[];
	// yes is z-stacks (a volume - more than one slice), no is flat slides.
	stacks: Either;
	// Collections you can open with something in them.
	collections: Either;
	// Someone working on it now - a live session on it, or someone with it open.
	working: Either;
}

const NO_GALLERY_FILTERS: GalleryFilters = {
	kinds: [],
	objectives: [],
	channels: [],
	stacks: "any",
	collections: "any",
	working: "any",
};

// What a slide's checked against besides the tiler's info.
interface SlideActivity {
	summaries: Map<string, SlideSummary>;
	// Other people with each slide open now, by id.
	people: Map<string, number>;
}

function kindOf(slide: Pick<GallerySlide, "kind">): string {
	return slide.kind ?? UNKNOWN_KIND;
}

function isZStack(slide: Pick<GallerySlide, "slices">): boolean {
	return (slide.slices?.length ?? 1) > 1;
}

function hasCollections(slide: Pick<GallerySlide, "id">, activity: SlideActivity): boolean {
	return (activity.summaries.get(slide.id)?.collections ?? 0) > 0;
}

// The same as the live dot on a strip tile.
function isWorkedOn(slide: Pick<GallerySlide, "id">, activity: SlideActivity): boolean {
	return (activity.summaries.get(slide.id)?.liveSessions ?? 0) > 0 || (activity.people.get(slide.id) ?? 0) > 0;
}

function either(value: Either, is: boolean): boolean {
	return value === "any" || (value === "yes") === is;
}

// Every word typed is somewhere in the name the scanner gave it, its id or
// its file name, in any case - "hcrc 01" finds hcrc-010 to hcrc-019.
function matchesSlideSearch(slide: Pick<GallerySlide, "id" | "name" | "fileName">, search: string): boolean {
	const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const text = `${slideName(slide)} ${slide.id} ${slide.fileName ?? ""}`.toLowerCase();
	return words.every((word) => text.includes(word));
}

function passesGalleryFilters(slide: GallerySlide, filters: GalleryFilters, activity: SlideActivity): boolean {
	if (filters.kinds.length > 0 && !filters.kinds.includes(kindOf(slide))) return false;
	if (filters.objectives.length > 0 && (slide.objectivePower == null || !filters.objectives.includes(slide.objectivePower))) return false;
	if (filters.channels.length > 0 && !(slide.channels ?? []).some((channel) => filters.channels.includes(channel))) return false;
	return (
		either(filters.stacks, isZStack(slide)) &&
		either(filters.collections, hasCollections(slide, activity)) &&
		either(filters.working, isWorkedOn(slide, activity))
	);
}

function filterSlides<T extends GallerySlide>(slides: T[], search: string, filters: GalleryFilters, activity: SlideActivity): T[] {
	return slides.filter((slide) => matchesSlideSearch(slide, search) && passesGalleryFilters(slide, filters, activity));
}

function activeGalleryFilterCount(filters: GalleryFilters): number {
	return (
		(filters.kinds.length > 0 ? 1 : 0) +
		(filters.objectives.length > 0 ? 1 : 0) +
		(filters.channels.length > 0 ? 1 : 0) +
		(filters.stacks !== "any" ? 1 : 0) +
		(filters.collections !== "any" ? 1 : 0) +
		(filters.working !== "any" ? 1 : 0)
	);
}

// Whether anything's narrowing the gallery - with nothing, every slide shows.
function isGalleryFiltered(search: string, filters: GalleryFilters): boolean {
	return search.trim() !== "" || activeGalleryFilterCount(filters) > 0;
}

interface Facet<T> {
	value: T;
	count: number;
}

// The chips the Filter sheet offers, each with how many slides it covers -
// counted over every slide, so a chip doesn't vanish when another filter is on.
interface GalleryFacets {
	kinds: Facet<string>[];
	objectives: Facet<number>[];
	channels: Facet<string>[];
	zStacks: number;
}

function counted<T>(values: T[], order: (a: T, b: T) => number): Facet<T>[] {
	const counts = new Map<T, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => order(a.value, b.value));
}

const KIND_ORDER = ["brightfield", "fluorescence", UNKNOWN_KIND];

function galleryFacets(slides: GallerySlide[]): GalleryFacets {
	return {
		kinds: counted(slides.map(kindOf), (a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b)),
		objectives: counted(
			slides.map((slide) => slide.objectivePower).filter((power): power is number => power != null),
			(a, b) => a - b,
		),
		channels: counted(
			slides.flatMap((slide) => slide.channels ?? []),
			(a, b) => a.localeCompare(b),
		),
		zStacks: slides.filter(isZStack).length,
	};
}

// The slide the arrows go to from the one that's open, among the ones
// showing. When the open one's filtered out, it's the nearest showing one on
// that side of it in the full list. Null at either end.
function neighbourShown<T extends Pick<GallerySlide, "id">>(shown: T[], all: Pick<GallerySlide, "id">[], currentId: string, step: -1 | 1): T | null {
	const at = shown.findIndex((slide) => slide.id === currentId);
	if (at !== -1) return shown[at + step] ?? null;
	const order = new Map(all.map((slide, index) => [slide.id, index]));
	const from = order.get(currentId);
	if (from === undefined) return null;
	const side = shown.filter((slide) => {
		const index = order.get(slide.id);
		return index !== undefined && (step === 1 ? index > from : index < from);
	});
	return (step === 1 ? side[0] : side[side.length - 1]) ?? null;
}

// How many cards a page of the gallery shows. The strips aren't paged - they
// scroll, along the scrollbar or with the arrows.
const GALLERY_PAGE_SIZE = 24;

// The page the open slide's on, or the first page when it isn't showing.
function pageOfSlide(shown: Pick<GallerySlide, "id">[], currentId: string, pageSize: number): number {
	const at = shown.findIndex((slide) => slide.id === currentId);
	return at === -1 ? 0 : Math.floor(at / pageSize);
}

function pageOf<T>(shown: T[], page: number, pageSize: number): T[] {
	return shown.slice(page * pageSize, (page + 1) * pageSize);
}

// "3 of 12" while filtered - where the open one is among those showing, or
// how many show when it isn't one of them - and how many there are in all.
function shownText(shown: Pick<GallerySlide, "id">[], total: number, currentId: string): string {
	const at = shown.findIndex((slide) => slide.id === currentId);
	const where = at === -1 ? `${shown.length.toLocaleString("en-GB")} showing` : `${(at + 1).toLocaleString("en-GB")} of ${shown.length.toLocaleString("en-GB")}`;
	return `${where} · ${total.toLocaleString("en-GB")} in all`;
}

export {
	GALLERY_PAGE_SIZE,
	NO_GALLERY_FILTERS,
	UNKNOWN_KIND,
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
};
export type { Facet, GalleryFacets, GalleryFilters, SlideActivity };
