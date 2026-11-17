// A slide's slices, as the tiler lists them. A flat slide has one; a volume -
// serial sections lined up on one canvas - has one per section. gapBefore is
// true when the cuts between it and the slice before are missing, so the two
// were only lined up by the tissue's outline.
interface Slice {
	index: number;
	gapBefore: boolean;
}

// What a tiler from before volumes sends nothing for.
const FLAT: Slice[] = [{ index: 0, gapBefore: false }];

// How many slices either side of the one showing are kept loaded, so a
// step to the next one shows straight away. Each is a WebGL tile layer with
// its own GL context, and browsers only allow about 16 - the map already
// uses 8, so one each side brings it to 10.
const NEIGHBOURS = 1;

function isVolume(slices: readonly Slice[]): boolean {
	return slices.length > 1;
}

function clampSlice(slice: number, count: number): number {
	if (count <= 0) return 0;
	return Math.min(count - 1, Math.max(0, Math.round(slice)));
}

// The slices to keep loaded: the current one first, then outwards, nearest
// first, never past either end.
function sliceWindow(current: number, count: number, neighbours = NEIGHBOURS): number[] {
	const centre = clampSlice(current, count);
	const window = [centre];
	for (let distance = 1; distance <= neighbours; distance++) {
		if (centre - distance >= 0) window.push(centre - distance);
		if (centre + distance < count) window.push(centre + distance);
	}
	return window;
}

// The base URL a slice's Zoomify tiles hang off. Null is the slide's own
// route - its default slice - which is all a flat slide ever uses, so its
// tiles keep the URLs (and cache) they always had.
function sliceBaseUrl(tilerUrl: string, slideId: string, slice: number | null): string {
	return sliceUrlFrom(`${tilerUrl}/slides/${encodeURIComponent(slideId)}/`, slice);
}

// The same, from the slide's own base URL (which ends in a slash).
function sliceUrlFrom(slideBaseUrl: string, slice: number | null): string {
	return slice === null ? slideBaseUrl : `${slideBaseUrl}slice/${slice}/`;
}

// Slices count from 1 for people, from 0 everywhere else.
function sliceLabel(slice: number, count: number): string {
	return `Slice ${slice + 1} of ${count}`;
}

// Whether the slice showing sits next to a gap, either side.
function gapsAround(slices: readonly Slice[], slice: number): { before: boolean; after: boolean } {
	return {
		before: slices[slice]?.gapBefore ?? false,
		after: slices[slice + 1]?.gapBefore ?? false,
	};
}

interface KeyLike {
	key: string;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}

// PageDown goes deeper (the next slice), PageUp back. Not with a modifier,
// so the browser's own Ctrl+PageUp/Down (switching tabs) still works.
function keyStep(event: KeyLike): -1 | 1 | null {
	if (event.altKey || event.ctrlKey || event.metaKey) return null;
	if (event.key === "PageDown") return 1;
	if (event.key === "PageUp") return -1;
	return null;
}

// Shift and the wheel moves through slices instead of zooming. Scrolling
// down goes deeper, the same way as PageDown. Some browsers turn Shift+wheel
// into a sideways scroll, so whichever axis moved counts.
function wheelStep(deltaX: number, deltaY: number): -1 | 1 | null {
	const delta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
	if (delta === 0) return null;
	return delta > 0 ? 1 : -1;
}

// How far the wheel has to turn for one slice, in pixels of deltaY. A mouse
// notch is about 100, so one notch is one slice; a trackpad sends lots of
// small deltas, which add up to a slice per swipe rather than racing
// through the stack.
const WHEEL_PER_SLICE = 80;
// A pause this long starts the count again, so half a swipe left over
// doesn't tip the next one over early.
const WHEEL_RESET_MS = 250;

// Turns wheel events into slice steps: adds up the deltas and gives a step
// each time they pass WHEEL_PER_SLICE. Lines and pages are turned into pixels
// first (deltaMode 1 and 2).
function wheelStepper(perSlice = WHEEL_PER_SLICE, resetMs = WHEEL_RESET_MS) {
	let total = 0;
	let last = -Infinity;
	return (deltaX: number, deltaY: number, deltaMode: number, timeMs: number): -1 | 1 | null => {
		if (timeMs - last > resetMs) total = 0;
		last = timeMs;
		const scale = deltaMode === 1 ? 40 : deltaMode === 2 ? 800 : 1;
		const direction = wheelStep(deltaX, deltaY);
		if (direction === null) return null;
		// Turning back starts again, so what was left over going one way
		// doesn't eat the first notch the other way.
		if (Math.sign(total) === -direction) total = 0;
		total += direction * Math.max(Math.abs(deltaX), Math.abs(deltaY)) * scale;
		if (Math.abs(total) < perSlice) return null;
		const step = total > 0 ? 1 : -1;
		total -= step * perSlice;
		return step;
	};
}

// What the tiler's /slides/{id} says, made safe: an older tiler sends no
// slices, and a default that isn't one of them falls back to the first.
// sectionMicrons is how thick the sections were cut, if the volume says -
// null otherwise, and for anything that isn't a positive number.
function readSlices(metadata: { slices?: Slice[]; defaultSlice?: number; sectionMicrons?: number | null }): {
	slices: Slice[];
	defaultSlice: number;
	sectionMicrons: number | null;
} {
	const slices = metadata.slices && metadata.slices.length > 0 ? metadata.slices : FLAT;
	const fallback = metadata.defaultSlice ?? 0;
	const defaultSlice = fallback >= 0 && fallback < slices.length ? fallback : 0;
	const thickness = metadata.sectionMicrons;
	const sectionMicrons = typeof thickness === "number" && Number.isFinite(thickness) && thickness > 0 ? thickness : null;
	return { slices, defaultSlice, sectionMicrons };
}

export { FLAT, NEIGHBOURS, isVolume, clampSlice, sliceWindow, sliceBaseUrl, sliceUrlFrom, sliceLabel, gapsAround, keyStep, wheelStep, wheelStepper, readSlices };
export type { Slice, KeyLike };
