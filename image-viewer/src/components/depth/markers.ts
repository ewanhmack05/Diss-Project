// Annotations at a depth. A 3D marker is a box round a feature in a volume,
// saved as an ordinary rectangle annotation with the slices it spans
// (sliceFrom to sliceTo) - see docs/volume-live.md, phase 6. A shape drawn in
// 2D on a volume gets the one slice it was drawn on (sliceOf). Both go
// through onSlice for the 2D map.

import type { Annotation } from "../../interfaces/Annotation";
import { layerZ, type Vec3 } from "./volume";

// A spot on the tissue: slide pixels (y down the slide) and its slice.
interface Hit {
	x: number;
	y: number;
	slice: number;
}

// A marker's box: slide pixels, y down, and the slices it spans, inclusive.
interface MarkerBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
	sliceFrom: number;
	sliceTo: number;
}

// The box two corners make - clicked anywhere on the block, so turning or
// cutting it first lets the corners be at different depths.
function boxFromHits(a: Hit, b: Hit): MarkerBox {
	return {
		minX: Math.min(a.x, b.x),
		minY: Math.min(a.y, b.y),
		maxX: Math.max(a.x, b.x),
		maxY: Math.max(a.y, b.y),
		sliceFrom: Math.min(a.slice, b.slice),
		sliceTo: Math.max(a.slice, b.slice),
	};
}

// Too thin to be a box round anything - two clicks on the same spot, say.
const SMALLEST_SIDE_PX = 4;

function isUsable(box: MarkerBox): boolean {
	return box.maxX - box.minX >= SMALLEST_SIDE_PX && box.maxY - box.minY >= SMALLEST_SIDE_PX && box.sliceFrom <= box.sliceTo;
}

// Slides pixels to a tenth, like everything else saved (see CoordinateDecimals).
const tenth = (n: number) => Math.round(n * 10) / 10;

// The box's footprint as an annotation's GeoJSON: a rectangle in map
// coordinates (y is minus the pixel row), stored the way drawn shapes are.
function markerGeoJson(box: MarkerBox): string {
	// Rounded as pixels, then flipped - Math.round takes halves up, so rounding
	// after flipping would round a row one way and its mirror the other.
	const [x0, x1, y0, y1] = [tenth(box.minX), tenth(box.maxX), -tenth(box.minY), -tenth(box.maxY)];
	return JSON.stringify({
		type: "Feature",
		geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
		properties: null,
	});
}

type Ranged = Pick<Annotation, "geoJson" | "sliceFrom" | "sliceTo"> & Partial<Pick<Annotation, "shape">>;

// The range a shape drawn in 2D gets: the slice it was drawn on, on a
// volume, unless it's meant for all of them. Nothing on a flat slide, so 2D
// slides save exactly what they did before.
function sliceOf(volume: boolean, slice: number, everySlice: boolean): { sliceFrom?: number; sliceTo?: number } {
	return volume && !everySlice ? { sliceFrom: slice, sliceTo: slice } : {};
}

function isMarker(annotation: Pick<Annotation, "sliceFrom" | "sliceTo">): boolean {
	return typeof annotation.sliceFrom === "number" && typeof annotation.sliceTo === "number";
}

// A saved marker's box, back from its GeoJSON's extent and its range. Null
// for anything without a range, or GeoJSON that doesn't read.
function boxOf(annotation: Ranged): MarkerBox | null {
	// Only a rectangle is a box. A polygon or line on its slices isn't drawn
	// in the block - its extent would claim more than was drawn.
	if (!isMarker(annotation) || (annotation.shape !== undefined && annotation.shape !== "rectangle")) return null;
	let points: number[][];
	try {
		const geometry = JSON.parse(annotation.geoJson)?.geometry;
		points = geometry?.type === "Polygon" ? geometry.coordinates.flat() : geometry?.type === "LineString" ? geometry.coordinates : [];
	} catch {
		return null;
	}
	if (points.length === 0 || !points.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) return null;
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => -p[1]);
	return {
		minX: Math.min(...xs),
		maxX: Math.max(...xs),
		minY: Math.min(...ys),
		maxY: Math.max(...ys),
		sliceFrom: annotation.sliceFrom!,
		sliceTo: annotation.sliceTo!,
	};
}

// The saved markers the block draws: only the ones on the map, so a person
// or group turned off on the On the map tab is off in 3D too.
function shownMarkers<T extends Ranged & Pick<Annotation, "colour">>(
	annotations: readonly T[],
	isOnTheMap: (annotation: T) => boolean,
): { box: MarkerBox; colour: string }[] {
	return annotations.flatMap((annotation) => {
		if (!isOnTheMap(annotation)) return [];
		const box = boxOf(annotation);
		return box ? [{ box, colour: annotation.colour }] : [];
	});
}

// Whether it belongs on the 2D map at this slice. Anything without a range
// is on every slice; so is everything on a flat slide.
function onSlice(annotation: Pick<Annotation, "sliceFrom" | "sliceTo">, slice: number, volume: boolean): boolean {
	if (!volume || !isMarker(annotation)) return true;
	return slice >= annotation.sliceFrom! && slice <= annotation.sliceTo!;
}

// "slices 3 to 7", or "slice 3" - from 1, as the Depth tab shows them.
function sliceRangeText(annotation: Pick<Annotation, "sliceFrom" | "sliceTo">): string | null {
	if (!isMarker(annotation)) return null;
	const from = annotation.sliceFrom! + 1;
	const to = annotation.sliceTo! + 1;
	return from === to ? `slice ${from}` : `slices ${from} to ${to}`;
}

// The Saved list's tag: "3D · slices 4 to 9" for a box through the slices,
// "Slice 4" for anything on one - a rectangle drawn in 2D is a one-slice box
// too, and reads as what it was.
function sliceTagText(annotation: Ranged): string | null {
	const range = sliceRangeText(annotation);
	if (range === null) return null;
	return boxOf(annotation) && annotation.sliceFrom !== annotation.sliceTo ? `3D · ${range}` : range[0].toUpperCase() + range.slice(1);
}

// Whether a count belongs on the 2D map at this slice. A count is on the one
// slice its dots were placed on; one without a slice is on all of them.
function countOnSlice(count: { slice?: number | null }, slice: number, volume: boolean): boolean {
	return !volume || typeof count.slice !== "number" || count.slice === slice;
}

// "Slice 5" for a count on a volume - from 1, as the Depth tab shows them.
function countSliceText(count: { slice?: number | null }): string | null {
	return typeof count.slice === "number" ? `Slice ${count.slice + 1}` : null;
}

// A range from the edit form's two boxes, typed from 1: whole numbers within
// the volume, either way round. Null until they make sense.
function rangeFromInputs(from: string, to: string, count: number): { sliceFrom: number; sliceTo: number } | null {
	const [a, b] = [from, to].map((text) => (/^\s*\d+\s*$/.test(text) ? Number(text) : NaN));
	if (!(a >= 1 && b >= 1 && a <= count && b <= count)) return null;
	return { sliceFrom: Math.min(a, b) - 1, sliceTo: Math.max(a, b) - 1 };
}

// The box as twelve edges in the scene, for line segments - the block
// centred on the origin, size big, layer 0 at the front. Its depth runs from
// the front of its first slice's layer to the back of its last. Empty when
// none of its slices are in the block.
function boxEdges(box: MarkerBox, slide: { width: number; height: number }, size: Vec3, layerSlice: readonly (number | null)[]): Vec3[] {
	const layers = layerSlice.length;
	const inRange = layerSlice.flatMap((slice, layer) => (slice !== null && slice >= box.sliceFrom && slice <= box.sliceTo ? [layer] : []));
	if (inRange.length === 0 || layers === 0) return [];
	const half = size[2] / layers / 2;
	const front = layerZ(inRange[0], layers, size[2]) + half;
	const back = layerZ(inRange[inRange.length - 1], layers, size[2]) - half;
	const x = (px: number) => (px / slide.width - 0.5) * size[0];
	const y = (py: number) => (0.5 - py / slide.height) * size[1];
	const [x0, x1, y0, y1] = [x(box.minX), x(box.maxX), y(box.minY), y(box.maxY)];
	const corner = (i: number): Vec3 => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? back : front];
	const edges: Vec3[] = [];
	for (let i = 0; i < 8; i++)
		for (const bit of [1, 2, 4])
			if (!(i & bit)) edges.push(corner(i), corner(i | bit));
	return edges;
}

export { SMALLEST_SIDE_PX, boxFromHits, isUsable, markerGeoJson, isMarker, boxOf, shownMarkers, onSlice, sliceOf, sliceRangeText, sliceTagText, countOnSlice, countSliceText, rangeFromInputs, boxEdges };
export type { Hit, MarkerBox };
