import Feature from "ol/Feature";
import type { Geometry } from "ol/geom";
import LineString from "ol/geom/LineString";
import MultiPolygon from "ol/geom/MultiPolygon";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import { describe, expect, it } from "vitest";
import type { Viewport } from "../realtime/realtime";
import { boundsOf, previewScale, previewSize, previewTiles, shapesOf, tiersOf, tileUrl } from "./previewTiles";

// Slide 003's real size.
const slide = { width: 101832, height: 219976, tileSize: 256 };

function viewport(extent: [number, number, number, number], rotation = 0): Viewport {
	return { center: [(extent[0] + extent[2]) / 2, (extent[1] + extent[3]) / 2], resolution: 1, rotation, extent };
}

describe("tiersOf", () => {
	it("runs from one tile to full size, each double the last", () => {
		const tiers = tiersOf(slide);
		expect(tiers[0]).toEqual({ z: 0, cols: 1, rows: 1, downsample: 2 ** (tiers.length - 1) });
		const native = tiers[tiers.length - 1];
		expect(native.downsample).toBe(1);
		expect(native.cols).toBe(Math.ceil(101832 / 256));
		expect(native.rows).toBe(Math.ceil(219976 / 256));
		tiers.slice(1).forEach((tier, i) => expect(tier.downsample).toBe(tiers[i].downsample / 2));
	});

	it("matches the tiler for the same size - ten tiers for slide 003", () => {
		// 219976 halves to 256 or under after 10 steps, and the single tile tier makes 11.
		expect(tiersOf(slide)).toHaveLength(11);
	});

	it("is one tier for a slide that fits in a tile", () => {
		expect(tiersOf({ width: 100, height: 200, tileSize: 256 })).toEqual([{ z: 0, cols: 1, rows: 1, downsample: 1 }]);
	});
});

describe("boundsOf", () => {
	it("turns the map y round, since tiles count down from the top", () => {
		expect(boundsOf(viewport([100, -400, 300, -200]))).toEqual({ left: 100, top: 200, right: 300, bottom: 400 });
	});

	it("goes round the turned box", () => {
		const turned = boundsOf(viewport([0, -100, 200, 0], Math.PI / 2));
		expect(turned.right - turned.left).toBeCloseTo(100);
		expect(turned.bottom - turned.top).toBeCloseTo(200);
	});
});

describe("previewTiles", () => {
	it("uses a coarse tier for a big area, with few tiles", () => {
		const tiles = previewTiles(slide, { left: 0, top: 0, right: 100000, bottom: 200000 }, 400);
		expect(tiles.length).toBeLessThanOrEqual(16);
		expect(tiles[0].downsample).toBeGreaterThan(64);
	});

	it("uses full size for an area smaller than the picture", () => {
		const tiles = previewTiles(slide, { left: 1000, top: 1000, right: 1100, bottom: 1100 }, 400);
		expect(tiles[0].downsample).toBe(1);
	});

	it("is sharp enough - a tile pixel is no bigger than a picture pixel", () => {
		const span = 8000;
		const tiles = previewTiles(slide, { left: 0, top: 0, right: span, bottom: 4000 }, 400);
		expect(span / tiles[0].downsample).toBeGreaterThanOrEqual(400);
	});

	it("places each tile where it goes on the slide", () => {
		const tiles = previewTiles(slide, { left: 300, top: 300, right: 500, bottom: 500 }, 200);
		expect(tiles[0]).toMatchObject({ x: 1, y: 1, left: 256, top: 256, downsample: 1 });
	});

	it("never asks for a tile off the slide", () => {
		const tiers = tiersOf(slide);
		const tiles = previewTiles(slide, { left: -5000, top: -5000, right: 200000, bottom: 300000 }, 400);
		for (const tile of tiles) {
			expect(tile.x).toBeGreaterThanOrEqual(0);
			expect(tile.y).toBeGreaterThanOrEqual(0);
			expect(tile.x).toBeLessThan(tiers[tile.z].cols);
			expect(tile.y).toBeLessThan(tiers[tile.z].rows);
		}
	});

	it("is nothing for an area right off the slide", () => {
		expect(previewTiles(slide, { left: -9000, top: -9000, right: -8000, bottom: -8000 }, 400)).toEqual([]);
	});

	it("never goes past the limit however long and thin it is", () => {
		expect(previewTiles(slide, { left: 0, top: 0, right: 101832, bottom: 219976 }, 4000).length).toBeLessThanOrEqual(16);
	});
});

describe("tileUrl", () => {
	it("is the shape the tiler serves", () => {
		expect(tileUrl("/tiler", "003", { z: 4, x: 1, y: 2 })).toBe("/tiler/slides/003/TileGroup0/4-1-2.jpg");
		expect(tileUrl("/tiler", "kliver", { z: 4, x: 1, y: 2 }, 13)).toBe("/tiler/slides/kliver/slice/13/TileGroup0/4-1-2.jpg");
		expect(tileUrl("/tiler", "kliver", { z: 0, x: 0, y: 0 }, 0)).toBe("/tiler/slides/kliver/slice/0/TileGroup0/0-0-0.jpg");
	});

	it("can't be sent elsewhere by a slide id from a message", () => {
		expect(tileUrl("/tiler", "../../x", { z: 0, x: 0, y: 0 })).toBe("/tiler/slides/..%2F..%2Fx/TileGroup0/0-0-0.jpg");
	});
});

describe("previewSize and previewScale", () => {
	it("keeps the shape of the area", () => {
		expect(previewSize(viewport([0, -300, 400, 0]), 400)).toEqual({ width: 400, height: 300 });
	});

	it("stays within limits for a very long or very tall one", () => {
		expect(previewSize(viewport([0, -10, 1000, 0]), 400).height).toBe(200);
		expect(previewSize(viewport([0, -9000, 10, 0]), 400).height).toBe(400);
	});

	it("fits all of the area in", () => {
		const area = viewport([0, -9000, 1000, 0]);
		const size = previewSize(area, 400);
		const scale = previewScale(area, size);
		expect(1000 * scale).toBeLessThanOrEqual(size.width);
		expect(9000 * scale).toBeLessThanOrEqual(size.height + 1e-9);
	});
});

describe("shapesOf", () => {
	const feature = (geometry: Geometry) => new Feature({ geometry });

	it("flips y for lines and areas, and says which close", () => {
		const shapes = shapesOf([
			feature(
				new LineString([
					[1, -2],
					[3, -4],
				]),
			),
			feature(
				new Polygon([
					[
						[0, 0],
						[10, 0],
						[10, -10],
						[0, 0],
					],
				]),
			),
		]);
		expect(shapes.paths[0]).toMatchObject({
			points: [
				[1, 2],
				[3, 4],
			],
			closed: false,
		});
		expect(shapes.paths[1].closed).toBe(true);
		expect(shapes.paths[1].points[2]).toEqual([10, 10]);
	});

	it("takes points as dots", () => {
		expect(shapesOf([feature(new Point([5, -6]))]).dots).toMatchObject([{ x: 5, y: 6 }]);
	});

	it("takes every part of a shape in several parts", () => {
		const square = (x: number) => [
			[
				[x, 0],
				[x + 1, 0],
				[x + 1, 1],
				[x, 0],
			],
		];
		expect(shapesOf([feature(new MultiPolygon([square(0), square(5)]))]).paths).toHaveLength(2);
	});

	it("draws each in its own colour, thickness and dashes", () => {
		const line = new Feature({
			geometry: new LineString([
				[0, 0],
				[1, 1],
			]),
			colour: "#ff0000",
			lineThickness: 5,
			lineStyle: "dashed",
		});
		const dot = new Feature({ geometry: new Point([1, 1]), colour: "#00ff00" });
		const shapes = shapesOf([line, dot]);
		expect(shapes.paths[0]).toMatchObject({ colour: "#ff0000", width: 5, dashed: true });
		expect(shapes.dots[0].colour).toBe("#00ff00");
	});

	it("copes with a feature with no shape", () => {
		expect(shapesOf([new Feature()])).toEqual({ paths: [], dots: [] });
	});

	it("stops at what a thumbnail can draw", () => {
		const lines = Array.from({ length: 2100 }, () =>
			feature(
				new LineString([
					[0, 0],
					[1, 1],
				]),
			),
		);
		expect(shapesOf(lines).paths).toHaveLength(2000);
	});
});
