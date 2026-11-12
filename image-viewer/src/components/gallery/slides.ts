import type { DockSide } from "../toolbar/dock";

// A slide as the tiler lists it (GET /slides - see its SlideCatalog). The
// first block is what it's always sent; the rest came in with the gallery,
// so a tiler from before then leaves them out and the card does without.
interface GallerySlide {
	id: string;
	fileName: string;
	width: number;
	height: number;
	tileSize: number;
	objectivePower: number | null;
	mppX: number | null;
	mppY: number | null;

	// What the scanner called it, or the id when it didn't say.
	name?: string;
	kind?: "brightfield" | "fluorescence" | null;
	// Fluorescence channels, in the file's order. Empty for brightfield.
	channels?: string[];
	// How many zoom levels the tiles go down.
	levels?: number;
	objectiveName?: string | null;
	camera?: string | null;
	// What's outside the scanned area, as #rrggbb.
	backgroundColour?: string | null;
	fileBytes?: number;
}

// What annotation-store knows about a slide (GET /slides/summary). Slides
// with nothing on them aren't in its answer at all.
interface SlideSummary {
	slideId: string;
	// Collections you can open that have something in them.
	collections: number;
	// Sessions you're in that haven't ended.
	liveSessions: number;
}

// cards - a row each with everything about the slide. The strips are
// thumbnails only, with arrows in a ribbon over them.
type GalleryLayout = "cards" | "strip-vertical" | "strip-horizontal";

// Docked it's always a strip, running the way the edge does. Floating it's
// whichever the toggle says.
function galleryLayout(dockedSide: DockSide | null, expanded: boolean): GalleryLayout {
	if (dockedSide === "left" || dockedSide === "right") return "strip-vertical";
	if (dockedSide === "top" || dockedSide === "bottom") return "strip-horizontal";
	return expanded ? "cards" : "strip-horizontal";
}

function slideName(slide: Pick<GallerySlide, "id" | "name">): string {
	return slide.name?.trim() || slide.id;
}

// By id, with numbers in number order - 2 before 10.
function sortSlides<T extends Pick<GallerySlide, "id">>(slides: T[]): T[] {
	return [...slides].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

const whole = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

function pixelsText(slide: Pick<GallerySlide, "width" | "height">): string {
	return `${whole.format(slide.width)} x ${whole.format(slide.height)} px`;
}

// How big the scanned area really is. Null when the slide doesn't say how
// many microns a pixel is.
function physicalText(slide: Pick<GallerySlide, "width" | "height" | "mppX" | "mppY">): string | null {
	if (!slide.mppX || !slide.mppY) return null;
	const mm = (pixels: number, mpp: number) => ((pixels * mpp) / 1000).toFixed(1);
	return `${mm(slide.width, slide.mppX)} x ${mm(slide.height, slide.mppY)} mm`;
}

// The most it zooms in to, and how much of the slide a pixel is there. The
// second is the one to trust - a scan saved smaller still reports the
// objective it was scanned with.
function zoomText(slide: Pick<GallerySlide, "objectivePower" | "mppX">): string | null {
	const parts: string[] = [];
	if (slide.objectivePower) parts.push(`Max zoom x${Number(slide.objectivePower.toFixed(1))}`);
	if (slide.mppX) parts.push(`${slide.mppX.toFixed(2)} µm/px`);
	return parts.length > 0 ? parts.join(" · ") : null;
}

const KIND_TEXT = { brightfield: "Brightfield", fluorescence: "Fluorescence" } as const;

function kindText(slide: Pick<GallerySlide, "kind" | "channels">): string | null {
	const parts: string[] = [];
	if (slide.kind) parts.push(KIND_TEXT[slide.kind]);
	if (slide.channels && slide.channels.length > 0) parts.push(slide.channels.join(", "));
	return parts.length > 0 ? parts.join(" · ") : null;
}

function bytesText(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	if (mb < 1024) return `${Math.round(mb)} MB`;
	return `${(mb / 1024).toFixed(1)} GB`;
}

function fileText(slide: Pick<GallerySlide, "levels" | "fileBytes">): string | null {
	const parts: string[] = [];
	if (slide.levels) parts.push(`${slide.levels} zoom levels`);
	if (slide.fileBytes) parts.push(bytesText(slide.fileBytes));
	return parts.length > 0 ? parts.join(" · ") : null;
}

// The scanner's objective and camera - for the card's tooltip, not a line.
function scannerText(slide: Pick<GallerySlide, "objectiveName" | "camera">): string | null {
	const parts = [slide.objectiveName, slide.camera].filter((part): part is string => !!part);
	return parts.length > 0 ? parts.join(" · ") : null;
}

function plural(count: number, one: string, many: string): string {
	return `${whole.format(count)} ${count === 1 ? one : many}`;
}

// summary is undefined for a slide annotation-store had nothing to say about.
function collectionsText(summary: SlideSummary | undefined): string {
	const count = summary?.collections ?? 0;
	return count === 0 ? "No collections yet" : plural(count, "collection", "collections");
}

function liveText(summary: SlideSummary | undefined): string | null {
	const count = summary?.liveSessions ?? 0;
	return count === 0 ? null : plural(count, "live session", "live sessions");
}

// Other people with this slide open right now.
function peopleText(count: number): string | null {
	return count === 0 ? null : `${plural(count, "person", "people")} here now`;
}

// The slide before or after the one that's open, the way they're listed.
// Null at either end, or when the open one isn't in the list.
function neighbour<T extends Pick<GallerySlide, "id">>(slides: T[], currentId: string, step: -1 | 1): T | null {
	const at = slides.findIndex((slide) => slide.id === currentId);
	return at === -1 ? null : (slides[at + step] ?? null);
}

function positionText(slides: Pick<GallerySlide, "id">[], currentId: string): string {
	const at = slides.findIndex((slide) => slide.id === currentId);
	return at === -1 ? plural(slides.length, "slide", "slides") : `${at + 1} of ${slides.length}`;
}

// Wide enough for the biggest it's drawn at on a sharp screen, and the same
// for every card and strip so the browser only fetches each slide's once.
const THUMBNAIL_WIDTH = 192;

// A square from the middle of the slide - its shorter side across, so a
// slide twice as tall as it's wide shows its middle half. The tiler cuts it,
// so it's read at the size it's shown rather than cropped from a smaller
// picture of the whole slide.
function thumbnailUrl(tilerUrl: string, slideId: string): string {
	return `${tilerUrl}/slides/${encodeURIComponent(slideId)}/thumbnail.jpg?width=${THUMBNAIL_WIDTH}&square=true`;
}

// The one tile that's the whole slide - smaller, but every tiler has it.
// Shown cropped to the same middle square (see GalleryPanel.css).
function wholeSlideTileUrl(tilerUrl: string, slideId: string): string {
	return `${tilerUrl}/slides/${encodeURIComponent(slideId)}/TileGroup0/0-0-0.jpg`;
}

export {
	bytesText,
	collectionsText,
	fileText,
	galleryLayout,
	kindText,
	liveText,
	neighbour,
	peopleText,
	physicalText,
	pixelsText,
	positionText,
	scannerText,
	slideName,
	sortSlides,
	thumbnailUrl,
	wholeSlideTileUrl,
	zoomText,
	THUMBNAIL_WIDTH,
};
export type { GalleryLayout, GallerySlide, SlideSummary };
