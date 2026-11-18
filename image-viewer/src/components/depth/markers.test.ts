import { describe, expect, it } from "vitest";
import { boxEdges, boxFromHits, boxOf, isMarker, isUsable, markerGeoJson, onSlice, sliceRangeText } from "./markers";
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
