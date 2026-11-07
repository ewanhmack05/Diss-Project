import { describe, expect, it } from "vitest";
import { DefaultColour } from "../annotation/Tools";
import { readArea, readRows, shownFromArea, shownFromRows } from "./sentArea";

const area = { center: [100, -100], resolution: 2, rotation: 0.5, extent: [0, -200, 200, 0] };

function polygon(minX: number, minY: number, maxX: number, maxY: number) {
	return JSON.stringify({
		type: "Feature",
		geometry: {
			type: "Polygon",
			coordinates: [
				[
					[minX, minY],
					[maxX, minY],
					[maxX, maxY],
					[minX, maxY],
					[minX, minY],
				],
			],
		},
		properties: {},
	});
}

describe("readArea", () => {
	it("takes one that makes sense", () => {
		expect(readArea(area)).toEqual(area);
	});

	it.each([
		["nothing", null],
		["not an object", "here"],
		["no centre", { ...area, center: undefined }],
		["a short centre", { ...area, center: [1] }],
		["a centre of text", { ...area, center: ["1", "2"] }],
		["a centre that is not a number", { ...area, center: [NaN, 2] }],
		["no resolution", { ...area, resolution: undefined }],
		["no zoom at all", { ...area, resolution: 0 }],
		["a negative zoom", { ...area, resolution: -1 }],
		["no rotation", { ...area, rotation: undefined }],
		["a short extent", { ...area, extent: [0, 0, 1] }],
		["an endless extent", { ...area, extent: [0, 0, Infinity, 1] }],
		["an inside out extent", { ...area, extent: [200, 0, 0, -200] }],
		["a flat extent", { ...area, extent: [0, 5, 200, 5] }],
	])("turns down %s", (_, payload) => {
		expect(readArea(payload)).toBeNull();
	});

	it("leaves behind anything extra", () => {
		expect(readArea({ ...area, sneaky: true })).toEqual(area);
	});
});

describe("readRows", () => {
	it("copes with parts missing", () => {
		expect(readRows({})).toEqual({ annotations: [], cellCounts: [], groups: [], cellCountGroups: [] });
		expect(readRows({ annotations: "no" })?.annotations).toEqual([]);
	});

	it("turns down what is not rows at all", () => {
		expect(readRows(null)).toBeNull();
		expect(readRows("no")).toBeNull();
	});
});

describe("shownFromArea", () => {
	it("draws the box turned as it was seen, and keeps the turn", () => {
		const shown = shownFromArea("m", area)!;
		expect(shown.messageId).toBe("m");
		expect(shown.keepRotation).toBe(true);
		expect(shown.features).toHaveLength(1);
		const extent = shown.features[0].getGeometry()!.getExtent();
		// Turned, so it's wider than the box it started as.
		expect(extent[2] - extent[0]).toBeGreaterThan(200);
	});

	it("is nothing for an area that makes no sense", () => {
		expect(shownFromArea("m", { nope: true })).toBeNull();
	});
});

describe("how what was sent is drawn", () => {
	const annotation = (extra: object) => ({ annotations: [{ geoJson: polygon(0, 0, 10, 10), ...extra }], cellCounts: [], groups: [] });

	it("keeps an annotation looking as it did", () => {
		const [feature] = shownFromRows("m", annotation({ colour: "#FF0000", lineThickness: 4, lineStyle: "dashed", shape: "arrow" }))!.features;
		expect(feature.getProperties()).toMatchObject({ colour: "#FF0000", lineThickness: 4, lineStyle: "dashed", shape: "arrow" });
		expect(feature.get("part")).toBeUndefined();
	});

	it("turns down a colour or thickness that makes no sense", () => {
		const [feature] = shownFromRows("m", annotation({ colour: "url(evil)", lineThickness: 9000, lineStyle: "wobbly" }))!.features;
		expect(feature.get("colour")).toBe(DefaultColour);
		expect(feature.get("lineThickness")).toBe(6);
		expect(feature.get("lineStyle")).toBe("solid");
	});

	it("keeps each dot's own colour, and the count's size", () => {
		const shown = shownFromRows("m", {
			annotations: [],
			groups: [],
			cellCounts: [
				{
					dotSize: 8,
					dots: JSON.stringify([
						{ x: 1, y: 2, colour: "#00ff00" },
						{ x: 3, y: 4, colour: "#0000ff" },
					]),
				},
			],
		})!;
		expect(shown.features.map((f) => [f.get("part"), f.get("colour"), f.get("dotSize")])).toEqual([
			["dot", "#00ff00", 8],
			["dot", "#0000ff", 8],
		]);
	});

	it("marks a count's box, and a sent area's", () => {
		const counted = shownFromRows("m", {
			annotations: [],
			groups: [],
			cellCounts: [{ regionOfInterest: { geoJson: polygon(0, 0, 5, 5) }, dots: "[]" }],
		})!;
		expect(counted.features[0].get("part")).toBe("region");
		expect(shownFromArea("m", area)!.features[0].get("part")).toBe("area");
	});
});

describe("shownFromRows", () => {
	const annotations = (...geoJson: string[]) => ({ annotations: geoJson.map((g) => ({ geoJson: g })), cellCounts: [], groups: [] });

	it("goes round everything, with some room, leaving your turn alone", () => {
		const shown = shownFromRows("m", annotations(polygon(0, 0, 1000, 1000), polygon(3000, 2000, 4000, 3000)))!;
		expect(shown.keepRotation).toBe(false);
		expect(shown.features).toHaveLength(2);
		expect(shown.viewport.center).toEqual([2000, 1500]);
		const [minX, minY, maxX, maxY] = shown.viewport.extent;
		expect(minX).toBeLessThan(0);
		expect(minY).toBeLessThan(0);
		expect(maxX).toBeGreaterThan(4000);
		expect(maxY).toBeGreaterThan(3000);
	});

	it("leaves out a shape it cannot read, keeping the rest", () => {
		const shown = shownFromRows("m", annotations("not json", polygon(0, 0, 10, 10), ""))!;
		expect(shown.features).toHaveLength(1);
	});

	it("draws a count's box and dots", () => {
		const shown = shownFromRows("m", {
			annotations: [],
			groups: [],
			cellCounts: [
				{
					regionOfInterest: { geoJson: polygon(0, 0, 500, 500) },
					dots: JSON.stringify([
						{ x: 10, y: 20, colour: "#fff" },
						{ x: 30, y: 40, colour: "#fff" },
					]),
				},
			],
		})!;
		expect(shown.features).toHaveLength(3);
	});

	it("copes with a count whose dots are not there or are nonsense", () => {
		const payload = (dots: unknown) => ({ annotations: [], groups: [], cellCounts: [{ regionOfInterest: { geoJson: polygon(0, 0, 5, 5) }, dots }] });
		expect(shownFromRows("m", payload(null))!.features).toHaveLength(1);
		expect(shownFromRows("m", payload("not json"))!.features).toHaveLength(1);
		expect(shownFromRows("m", payload(JSON.stringify([{ x: "a", y: 1 }])))!.features).toHaveLength(1);
	});

	it("gives a single dot some room, since it has no size", () => {
		const shown = shownFromRows("m", { annotations: [], groups: [], cellCounts: [{ dots: JSON.stringify([{ x: 100, y: 100, colour: "#fff" }]) }] })!;
		const [minX, , maxX] = shown.viewport.extent;
		expect(maxX - minX).toBeGreaterThanOrEqual(200);
		expect(shown.viewport.center).toEqual([100, 100]);
	});

	it("is nothing when there is nothing to draw", () => {
		expect(shownFromRows("m", annotations())).toBeNull();
		expect(shownFromRows("m", annotations("not json"))).toBeNull();
		expect(shownFromRows("m", null)).toBeNull();
	});
});
