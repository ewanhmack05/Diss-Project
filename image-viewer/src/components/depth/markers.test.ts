import { describe, expect, it } from "vitest";
import { isShown, type Hidden } from "../collections/map/layers";
import {
	boxEdges,
	boxFromHits,
	boxOf,
	cornerOnSlice,
	countOnSlice,
	countSliceText,
	isMarker,
	isUsable,
	markerGeoJson,
	onSlice,
	rangeFromInputs,
	sameBox,
	shownMarkers,
	sliceAlongDepth,
	sliceAtZ,
	sliceOf,
	sliceRangeText,
	sliceTagText,
	type Ray,
} from "./markers";
import type { Vec3 } from "./volume";

describe("boxFromHits", () => {
	it("spans the two corners, whichever way round they're clicked", () => {
		expect(boxFromHits({ x: 900, y: 100, slice: 7 }, { x: 300, y: 500, slice: 2 })).toEqual({
			minX: 300,
			minY: 100,
			maxX: 900,
			maxY: 500,
			sliceFrom: 2,
			sliceTo: 7,
		});
	});

	it("is one slice deep when both corners are on the same slice", () => {
		const box = boxFromHits({ x: 0, y: 0, slice: 4 }, { x: 10, y: 10, slice: 4 });
		expect([box.sliceFrom, box.sliceTo]).toEqual([4, 4]);
	});
});

describe("isUsable", () => {
	it("needs some width and height", () => {
		expect(isUsable(boxFromHits({ x: 0, y: 0, slice: 1 }, { x: 50, y: 40, slice: 3 }))).toBe(true);
		expect(isUsable(boxFromHits({ x: 0, y: 0, slice: 1 }, { x: 2, y: 40, slice: 3 }))).toBe(false);
		expect(isUsable(boxFromHits({ x: 5, y: 5, slice: 1 }, { x: 5, y: 5, slice: 1 }))).toBe(false);
	});
});

describe("markerGeoJson and boxOf", () => {
	const box = { minX: 120.04, minY: 40, maxX: 900.26, maxY: 610.57, sliceFrom: 2, sliceTo: 6 };

	it("stores the footprint as a rectangle in map coordinates, to a tenth", () => {
		const stored = JSON.parse(markerGeoJson(box));
		expect(stored.type).toBe("Feature");
		expect(stored.geometry.type).toBe("Polygon");
		expect(stored.geometry.coordinates[0]).toEqual([
			[120, -40],
			[900.3, -40],
			[900.3, -610.6],
			[120, -610.6],
			[120, -40],
		]);
	});

	it("reads back as the same box, to a tenth", () => {
		const back = boxOf({ geoJson: markerGeoJson(box), sliceFrom: 2, sliceTo: 6 });
		expect(back).toEqual({ minX: 120, minY: 40, maxX: 900.3, maxY: 610.6, sliceFrom: 2, sliceTo: 6 });
	});

	it("is nothing for an annotation without a range, or GeoJSON that doesn't read", () => {
		expect(boxOf({ geoJson: markerGeoJson(box), sliceFrom: null, sliceTo: null })).toBeNull();
		expect(boxOf({ geoJson: markerGeoJson(box) })).toBeNull();
		expect(boxOf({ geoJson: "not json", sliceFrom: 1, sliceTo: 2 })).toBeNull();
		expect(boxOf({ geoJson: JSON.stringify({ type: "Feature", geometry: null }), sliceFrom: 1, sliceTo: 2 })).toBeNull();
	});
});

describe("isMarker and onSlice", () => {
	it("is a marker only with both ends of a range", () => {
		expect(isMarker({ sliceFrom: 0, sliceTo: 0 })).toBe(true);
		expect(isMarker({ sliceFrom: 2 })).toBe(false);
		expect(isMarker({})).toBe(false);
	});

	it("puts a marker on the 2D map only on its slices", () => {
		const marker = { sliceFrom: 3, sliceTo: 5 };
		expect([2, 3, 4, 5, 6].map((slice) => onSlice(marker, slice, true))).toEqual([false, true, true, true, false]);
	});

	it("leaves everything else on every slice, and everything on a flat slide", () => {
		expect(onSlice({}, 9, true)).toBe(true);
		expect(onSlice({ sliceFrom: 3, sliceTo: 5 }, 9, false)).toBe(true);
	});
});

describe("sliceRangeText", () => {
	it("counts from 1, like the Depth tab", () => {
		expect(sliceRangeText({ sliceFrom: 2, sliceTo: 6 })).toBe("slices 3 to 7");
		expect(sliceRangeText({ sliceFrom: 0, sliceTo: 0 })).toBe("slice 1");
		expect(sliceRangeText({})).toBeNull();
	});
});

describe("boxEdges", () => {
	const slide = { width: 2000, height: 1000 };
	const size: Vec3 = [1, 0.5, 0.4];
	const layers = [0, 1, 2, 3];

	it("is twelve edges - 24 points", () => {
		expect(boxEdges({ minX: 0, minY: 0, maxX: 2000, maxY: 1000, sliceFrom: 0, sliceTo: 3 }, slide, size, layers)).toHaveLength(24);
	});

	it("covers the whole block for the whole slide and every slice", () => {
		const edges = boxEdges({ minX: 0, minY: 0, maxX: 2000, maxY: 1000, sliceFrom: 0, sliceTo: 3 }, slide, size, layers);
		const range = (axis: number) => [Math.min(...edges.map((p) => p[axis])), Math.max(...edges.map((p) => p[axis]))];
		expect(range(0)).toEqual([-0.5, 0.5]);
		expect(range(1)).toEqual([-0.25, 0.25]);
		const [back, front] = range(2);
		expect(back).toBeCloseTo(-0.2);
		expect(front).toBeCloseTo(0.2);
	});

	it("is as deep as its slices - the front one of four is the front quarter", () => {
		const edges = boxEdges({ minX: 0, minY: 0, maxX: 2000, maxY: 1000, sliceFrom: 0, sliceTo: 0 }, slide, size, layers);
		const zs = edges.map((p) => p[2]);
		expect(Math.max(...zs)).toBeCloseTo(0.2);
		expect(Math.min(...zs)).toBeCloseTo(0.1);
	});

	it("skips the gaps in a volume, and is nothing for slices it hasn't got", () => {
		// Slices 0 and 1, a gap, then 2 and 3.
		const withGap = [0, 1, null, 2, 3];
		const edges = boxEdges({ minX: 0, minY: 0, maxX: 10, maxY: 10, sliceFrom: 1, sliceTo: 2 }, slide, size, withGap);
		expect(edges).toHaveLength(24);
		expect(boxEdges({ minX: 0, minY: 0, maxX: 10, maxY: 10, sliceFrom: 8, sliceTo: 9 }, slide, size, layers)).toEqual([]);
	});
});

describe("shownMarkers", () => {
	const box = { minX: 100, minY: 200, maxX: 300, maxY: 400, sliceFrom: 2, sliceTo: 5 };
	const marker = (createdById: string, groupId: string | null, colour: string) => ({
		created: "2026-11-01T10:00:00Z",
		createdById,
		groupId,
		colour,
		geoJson: markerGeoJson(box),
		sliceFrom: box.sliceFrom,
		sliceTo: box.sliceTo,
	});
	const flat = { ...marker("ann", "g1", "#00ff00"), sliceFrom: null, sliceTo: null };
	const annotations = [marker("ann", "g1", "#ff0000"), marker("bob", "g2", "#0000ff"), flat];
	const hiding = (people: string[], groups: string[]): Hidden => ({ people: new Set(people), groups: new Set(groups) });

	it("draws every marker with its own colour when nothing's hidden, and nothing flat", () => {
		expect(shownMarkers(annotations, () => true)).toEqual([
			{ box, colour: "#ff0000" },
			{ box, colour: "#0000ff" },
		]);
	});

	it("leaves out a group turned off on the On the map tab", () => {
		const hidden = hiding([], ["g2"]);
		expect(shownMarkers(annotations, (a) => isShown(a, hidden)).map((m) => m.colour)).toEqual(["#ff0000"]);
	});

	it("leaves out a person turned off on the On the map tab", () => {
		const hidden = hiding(["ann"], []);
		expect(shownMarkers(annotations, (a) => isShown(a, hidden)).map((m) => m.colour)).toEqual(["#0000ff"]);
	});

	it("leaves out what the Saved list's filters leave out", () => {
		expect(shownMarkers(annotations, (a) => a.createdById === "bob").map((m) => m.colour)).toEqual(["#0000ff"]);
	});
});

describe("sliceOf", () => {
	it("puts a shape drawn on a volume on the slice it was drawn on", () => {
		expect(sliceOf(true, 4, false)).toEqual({ sliceFrom: 4, sliceTo: 4 });
	});

	it("leaves it on every slice when asked, and always on a flat slide", () => {
		expect(sliceOf(true, 4, true)).toEqual({});
		expect(sliceOf(false, 0, false)).toEqual({});
	});
});

describe("boxOf and shapes", () => {
	const footprint = markerGeoJson({ minX: 0, minY: 0, maxX: 10, maxY: 10, sliceFrom: 2, sliceTo: 2 });

	it("is a box for a rectangle on its slices", () => {
		expect(boxOf({ geoJson: footprint, sliceFrom: 2, sliceTo: 2, shape: "rectangle" })).not.toBeNull();
	});

	it("isn't for a polygon drawn on one slice - its extent would claim more than was drawn", () => {
		expect(boxOf({ geoJson: footprint, sliceFrom: 2, sliceTo: 2, shape: "polygon" })).toBeNull();
	});
});

describe("sliceTagText", () => {
	const footprint = markerGeoJson({ minX: 0, minY: 0, maxX: 10, maxY: 10, sliceFrom: 3, sliceTo: 8 });

	it("says 3D for a box made in 3D, and just the slice for a 2D shape", () => {
		expect(sliceTagText({ geoJson: footprint, sliceFrom: 3, sliceTo: 8, shape: "rectangle" })).toBe("3D · slices 4 to 9");
		expect(sliceTagText({ geoJson: footprint, sliceFrom: 3, sliceTo: 3, shape: "polygon" })).toBe("Slice 4");
		expect(sliceTagText({ geoJson: footprint, sliceFrom: null, sliceTo: null, shape: "polygon" })).toBeNull();
	});

	it("says just the slice for a rectangle drawn in 2D on one", () => {
		expect(sliceTagText({ geoJson: footprint, sliceFrom: 2, sliceTo: 2, shape: "rectangle" })).toBe("Slice 3");
	});
});

describe("countOnSlice and countSliceText", () => {
	it("is only on the slice it was counted on", () => {
		expect(countOnSlice({ slice: 4 }, 4, true)).toBe(true);
		expect(countOnSlice({ slice: 4 }, 5, true)).toBe(false);
	});

	it("is on every slice without one, and everything is on a flat slide", () => {
		expect(countOnSlice({}, 5, true)).toBe(true);
		expect(countOnSlice({ slice: null }, 5, true)).toBe(true);
		expect(countOnSlice({ slice: 4 }, 0, false)).toBe(true);
	});

	it("says the slice from 1", () => {
		expect(countSliceText({ slice: 0 })).toBe("Slice 1");
		expect(countSliceText({})).toBeNull();
	});
});

describe("rangeFromInputs", () => {
	it("turns the boxes, from 1, into a range from 0, either way round", () => {
		expect(rangeFromInputs("4", "9", 15)).toEqual({ sliceFrom: 3, sliceTo: 8 });
		expect(rangeFromInputs("9", "4", 15)).toEqual({ sliceFrom: 3, sliceTo: 8 });
		expect(rangeFromInputs(" 15 ", "15", 15)).toEqual({ sliceFrom: 14, sliceTo: 14 });
	});

	it("is null until both are whole slices in the volume", () => {
		for (const [from, to] of [
			["", "4"],
			["0", "4"],
			["4", "16"],
			["2.5", "4"],
			["-1", "4"],
			["four", "4"],
		])
			expect(rangeFromInputs(from, to, 15)).toBeNull();
	});
});

// A block 1 across, 1 high and 1 deep, four slices, layer 0 at the front
// (+z). Layer middles are at z 0.375, 0.125, -0.125 and -0.375.
const cube: Vec3 = [1, 1, 1];
const slide = { width: 1000, height: 800 };
const four = [0, 1, 2, 3];
const ray = (origin: Vec3, direction: Vec3): Ray => ({ origin, direction });

describe("cornerOnSlice", () => {
	it("is where the ray meets the slice's plane, in slide pixels", () => {
		expect(cornerOnSlice(ray([0, 0, 5], [0, 0, -1]), 1, slide, cube, four)).toEqual({ x: 500, y: 400, slice: 1 });
		expect(cornerOnSlice(ray([0.25, 0.25, 5], [0, 0, -1]), 1, slide, cube, four)).toEqual({ x: 750, y: 200, slice: 1 });
	});

	it("follows an angled ray to that slice's depth", () => {
		const corner = cornerOnSlice(ray([0, 0, 5], [0.1, 0, -1]), 0, slide, cube, four);
		expect(corner?.x).toBeCloseTo(962.5);
		expect(corner?.y).toBeCloseTo(400);
	});

	it("finds the slice's layer past a gap", () => {
		// Slice 2 is layer 3 here, not layer 2.
		const corner = cornerOnSlice(ray([0, 0, 5], [0.05, 0, -1]), 2, slide, cube, [0, 1, null, 2]);
		expect(corner?.x).toBeCloseTo(768.75);
	});

	it("keeps the corner on the slide", () => {
		expect(cornerOnSlice(ray([2, -3, 5], [0, 0, -1]), 1, slide, cube, four)).toEqual({ x: 1000, y: 800, slice: 1 });
	});

	it("is nothing along the plane, behind the camera, or for a slice not in the block", () => {
		expect(cornerOnSlice(ray([0, 0, 0.125], [1, 0, 0]), 1, slide, cube, four)).toBeNull();
		expect(cornerOnSlice(ray([0, 0, 5], [0, 0, 1]), 1, slide, cube, four)).toBeNull();
		expect(cornerOnSlice(ray([0, 0, 5], [0, 0, -1]), 9, slide, cube, four)).toBeNull();
	});
});

describe("sliceAlongDepth", () => {
	const middle = { x: 500, y: 400 };

	it("is the slice where a side-on ray crosses the depth line", () => {
		expect(sliceAlongDepth(ray([5, 0, -0.125], [-1, 0, 0]), middle, slide, cube, four)).toBe(2);
		expect(sliceAlongDepth(ray([5, 0, 0.375], [-1, 0, 0]), middle, slide, cube, four)).toBe(0);
	});

	it("takes where a ray passes closest, when it misses the line", () => {
		// One above the line and level with it: closest at its own depth.
		expect(sliceAlongDepth(ray([5, 1, 0.3], [-1, 0, 0]), middle, slide, cube, four)).toBe(0);
		// From above and to the side, aimed through the line at z 0.13.
		expect(sliceAlongDepth(ray([5, 2, 0.13], [-5, -2, 0]), middle, slide, cube, four)).toBe(1);
	});

	it("uses the line through the corner given, not the block's middle", () => {
		const corner = { x: 750, y: 200 };
		expect(sliceAlongDepth(ray([5, 0.25, -0.3], [-1, 0, 0]), corner, slide, cube, four)).toBe(3);
	});

	it("reads depth against the block's own depth", () => {
		// z 0.06 is layer 1 in a cube, but layer 0 in a block 0.2 deep.
		expect(sliceAlongDepth(ray([5, 0, 0.06], [-1, 0, 0]), middle, slide, cube, four)).toBe(1);
		expect(sliceAlongDepth(ray([5, 0, 0.06], [-1, 0, 0]), middle, slide, [1, 1, 0.2], four)).toBe(0);
	});

	it("stops at the first and last slices past the block", () => {
		expect(sliceAlongDepth(ray([5, 0, 3], [-1, 0, 0]), middle, slide, cube, four)).toBe(0);
		expect(sliceAlongDepth(ray([5, 0, -3], [-1, 0, 0]), middle, slide, cube, four)).toBe(3);
	});

	it("is nothing looking straight down the line, nearly so, or behind the camera", () => {
		expect(sliceAlongDepth(ray([0, 0, 5], [0, 0, -1]), middle, slide, cube, four)).toBeNull();
		expect(sliceAlongDepth(ray([0, 0, 5], [0.01, 0, -1]), middle, slide, cube, four)).toBeNull();
		expect(sliceAlongDepth(ray([5, 0, 0], [1, 0, 0]), middle, slide, cube, four)).toBeNull();
	});
});

describe("sliceAtZ", () => {
	it("gives a gap layer to the nearer slice either side", () => {
		// Layers: slice 0, a gap, slice 1 - middles at z 1/3, 0 and -1/3.
		expect(sliceAtZ(0.05, 1, [0, null, 1])).toBe(0);
		expect(sliceAtZ(-0.05, 1, [0, null, 1])).toBe(1);
	});

	it("is nothing with no slices", () => {
		expect(sliceAtZ(0, 1, [])).toBeNull();
		expect(sliceAtZ(0, 1, [null])).toBeNull();
	});
});

describe("sameBox", () => {
	const box = { minX: 1, minY: 2, maxX: 3, maxY: 4, sliceFrom: 0, sliceTo: 2 };

	it("is every side and slice the same", () => {
		expect(sameBox(box, { ...box })).toBe(true);
		expect(sameBox(box, { ...box, sliceTo: 3 })).toBe(false);
		expect(sameBox(null, null)).toBe(true);
		expect(sameBox(box, null)).toBe(false);
	});
});

describe("three clicks", () => {
	it("makes a box across the first slice, as deep as the third click", () => {
		const first = { x: 200, y: 300, slice: 1 };
		// Second click from in front: on slice 1, whatever's under the pointer.
		const corner = cornerOnSlice(ray([0.25, 0.25, 5], [0, 0, -1]), first.slice, slide, cube, four)!;
		expect(boxFromHits(first, corner)).toEqual({ minX: 200, minY: 200, maxX: 750, maxY: 300, sliceFrom: 1, sliceTo: 1 });
		// Third from the side, level with slice 3.
		const slice = sliceAlongDepth(ray([5, 0.25, -0.375], [-1, 0, 0]), corner, slide, cube, four)!;
		expect(boxFromHits(first, { ...corner, slice })).toEqual({ minX: 200, minY: 200, maxX: 750, maxY: 300, sliceFrom: 1, sliceTo: 3 });
	});
});
