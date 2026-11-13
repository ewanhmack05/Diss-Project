import { describe, expect, it } from "vitest";
import {
	BLOCK_WIDTH,
	blockSize,
	buildVolume,
	cutPlane,
	defaultStretch,
	firstHit,
	layerSlices,
	layerZ,
	textureRay,
	thumbnailUrl,
	tissueAlpha,
	type Clip,
	type SliceImage,
} from "./volume";
import type { Slice } from "./slices";

const GLASS: [number, number, number] = [238, 238, 238];
const PINK: [number, number, number] = [225, 150, 222];
const PURPLE: [number, number, number] = [120, 60, 160];

// A width x height picture, all one colour except a square of another.
function picture(width: number, height: number, fill: [number, number, number], square?: { x: number; y: number; size: number; colour: [number, number, number] }): SliceImage {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const inSquare = square && x >= square.x && x < square.x + square.size && y >= square.y && y < square.y + square.size;
			const [r, g, b] = inSquare ? square.colour : fill;
			data.set([r, g, b, 255], (y * width + x) * 4);
		}
	}
	return { data, width, height };
}

const slices = (count: number, gapBefore: number[] = []): Slice[] =>
	Array.from({ length: count }, (_, index) => ({ index, gapBefore: gapBefore.includes(index) }));

const everything: Clip = { normal: [0, 0, 0], offset: 1, firstLayer: 0, lastLayer: 99 };

describe("tissueAlpha", () => {
	it("makes glass see-through and stain solid", () => {
		expect(tissueAlpha(...GLASS)).toBe(0);
		expect(tissueAlpha(255, 255, 255)).toBe(0);
		expect(tissueAlpha(0, 0, 0)).toBe(0);
		expect(tissueAlpha(...PINK)).toBe(255);
		expect(tissueAlpha(...PURPLE)).toBe(255);
	});

	it("ramps between, so edges are soft", () => {
		// Saturation of (200, 180, 200) is 20/200 * 255 = 25.5 - just past glass.
		const faint = tissueAlpha(200, 180, 200);
		expect(faint).toBeGreaterThan(0);
		expect(faint).toBeLessThan(255);
	});
});

describe("layers", () => {
	it("are one per slice, with an empty one at each gap", () => {
		expect(layerSlices(slices(4))).toEqual([0, 1, 2, 3]);
		expect(layerSlices(slices(15, [10]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, null, 10, 11, 12, 13, 14]);
	});

	it("don't start with a gap", () => {
		expect(layerSlices(slices(2, [0]))).toEqual([0, 1]);
	});
});

describe("buildVolume", () => {
	it("stacks the slices as premultiplied RGBA, glass empty", () => {
		const volume = buildVolume([picture(4, 3, GLASS), picture(4, 3, PINK)], slices(2));

		expect([volume.width, volume.height, volume.depth]).toEqual([4, 3, 2]);
		// Glass has no alpha, so no colour either - filtering next to it adds nothing.
		expect(Array.from(volume.rgba.slice(0, 4))).toEqual([0, 0, 0, 0]);
		expect(Array.from(volume.rgba.slice(4 * 3 * 4, 4 * 3 * 4 + 4))).toEqual([...PINK, 255]);
	});

	it("premultiplies a partly see-through edge", () => {
		// (200, 180, 200) is just past glass - partly see-through.
		const volume = buildVolume([picture(1, 1, [200, 180, 200])], slices(1));
		const [r, g, b, a] = Array.from(volume.rgba);
		expect(a).toBeGreaterThan(0);
		expect(a).toBeLessThan(255);
		expect(r).toBe(Math.round((200 * a) / 255));
		expect(g).toBe(Math.round((180 * a) / 255));
		expect(b).toBe(Math.round((200 * a) / 255));
	});

	it("leaves a gap layer empty", () => {
		const volume = buildVolume([picture(2, 2, PINK), picture(2, 2, PINK)], slices(2, [1]));

		expect(volume.layerSlice).toEqual([0, null, 1]);
		expect(volume.rgba.slice(2 * 2 * 4, 2 * 2 * 4 * 2).every((v) => v === 0)).toBe(true);
	});

	it("refuses pictures that don't match the slices", () => {
		expect(() => buildVolume([picture(2, 2, PINK)], slices(2))).toThrow(/1 pictures for 2 slices/);
		expect(() => buildVolume([picture(2, 2, PINK), picture(3, 2, PINK)], slices(2))).toThrow(/differ in size/);
		expect(() => buildVolume([], [])).toThrow(/no slices/);
	});
});

describe("blockSize", () => {
	// The liver volume: 40288 x 45104 at 0.27366 um, 16 layers.
	const W = 40288;
	const H = 45104;
	const MPP = 0.27366;

	it("is 1 wide and keeps the slide's shape", () => {
		const [x, y] = blockSize(W, H, 16, MPP, 1);
		expect(x).toBe(1);
		expect(y).toBeCloseTo(H / W, 9);
	});

	it("is really very thin - 64 um of sections against 11 mm across", () => {
		const [, , z] = blockSize(W, H, 16, MPP, 1);
		expect(z).toBeCloseTo(64 / (W * MPP), 9);
		expect(z).toBeLessThan(0.01);
	});

	it("stretches to a fifth as deep as it's wide by default", () => {
		const stretch = defaultStretch(W, 16, MPP);
		const [, , z] = blockSize(W, H, 16, MPP, stretch);
		expect(z).toBeCloseTo(0.2, 9);
		expect(stretch).toBeGreaterThan(30);
	});

	it("without a pixel size, counts layers against the block's pixels", () => {
		expect(blockSize(1000, 500, 16, null, 1)[2]).toBeCloseTo(16 / BLOCK_WIDTH, 9);
	});
});

describe("cutPlane", () => {
	it("cuts each axis at the position given", () => {
		expect(cutPlane("x", 0.3)).toEqual({ normal: [1, 0, 0], offset: 0.3 });
		expect(cutPlane("z", 2)).toEqual({ normal: [0, 0, 1], offset: 1 });
	});

	it("keeps everything with no cut", () => {
		const { normal, offset } = cutPlane("none", 0.1);
		expect(normal).toEqual([0, 0, 0]);
		expect(0 <= offset).toBe(true);
	});

	it("runs the diagonal from one corner to the opposite one", () => {
		const { normal, offset } = cutPlane("diagonal", 0.5);
		const dot = (p: number[]) => p[0] * normal[0] + p[1] * normal[1] + p[2] * normal[2];
		expect(dot([0, 0, 0])).toBeLessThanOrEqual(offset);
		expect(dot([1, 1, 1])).toBeGreaterThan(offset);
		expect(dot([0.5, 0.5, 0.5])).toBeCloseTo(offset, 9);
	});
});

describe("firstHit", () => {
	// 3 layers of 10 x 10: glass, then a purple square at (6..8, 2..4) on the
	// middle layer, then glass.
	const volume = buildVolume(
		[picture(10, 10, GLASS), picture(10, 10, GLASS, { x: 6, y: 2, size: 3, colour: PURPLE }), picture(10, 10, GLASS)],
		slices(3),
	);
	const down: [number, number, number] = [0, 0, 1];

	it("lands on the tissue under the ray, in the right layer", () => {
		const hit = firstHit(volume, [0.75, 0.35, -1], down, everything);
		expect(hit).not.toBeNull();
		expect(hit!.layer).toBe(1);
		expect(hit!.x).toBeCloseTo(0.75, 9);
		expect(hit!.y).toBeCloseTo(0.35, 9);
	});

	it("goes straight through glass", () => {
		expect(firstHit(volume, [0.2, 0.8, -1], down, everything)).toBeNull();
	});

	it("misses the block altogether", () => {
		expect(firstHit(volume, [2, 2, -1], down, everything)).toBeNull();
		expect(firstHit(volume, [0.5, 0.5, -1], [0, 0, -1], everything)).toBeNull();
	});

	it("can't land on what's been cut away", () => {
		const cut: Clip = { ...everything, ...cutPlane("x", 0.5) };
		expect(firstHit(volume, [0.75, 0.35, -1], down, cut)).toBeNull();
	});

	it("can't land on a layer that isn't drawn", () => {
		expect(firstHit(volume, [0.75, 0.35, -1], down, { ...everything, firstLayer: 2, lastLayer: 2 })).toBeNull();
	});

	it("works from the side too", () => {
		const hit = firstHit(volume, [-1, 0.35, 0.5], [1, 0, 0], everything);
		expect(hit!.layer).toBe(1);
		expect(hit!.x).toBeGreaterThanOrEqual(0.6);
		expect(hit!.x).toBeLessThan(0.62);
	});
});

describe("textureRay", () => {
	const size: [number, number, number] = [1, 1.12, 0.2];

	it("puts the box's corners at texture 0 and 1, y down and layer 0 at the front", () => {
		// Top left front corner of the box in the scene.
		const { origin } = textureRay([-0.5, 0.56, 0.1], [0, 0, -1], size);
		expect(origin[0]).toBeCloseTo(0, 9);
		expect(origin[1]).toBeCloseTo(0, 9);
		expect(origin[2]).toBeCloseTo(0, 9);
	});

	it("turns a ray going back into the scene into one going down the layers", () => {
		const { direction } = textureRay([0, 0, 1], [0, 0, -1], size);
		expect(direction[2]).toBeGreaterThan(0);
	});

	it("lands a ray from the camera on the tissue the shader would draw there", () => {
		// The purple square of the firstHit tests, from in front of a box of this size.
		const volume = buildVolume(
			[picture(10, 10, GLASS), picture(10, 10, GLASS, { x: 6, y: 2, size: 3, colour: PURPLE }), picture(10, 10, GLASS)],
			slices(3),
		);
		// Scene x 0.25 is texture x 0.75; scene y (0.5 - 0.35) * 1.12 is texture y 0.35.
		const ray = textureRay([0.25, (0.5 - 0.35) * 1.12, 1], [0, 0, -1], size);
		const hit = firstHit(volume, ray.origin, ray.direction, everything);
		expect(hit?.layer).toBe(1);
		expect(hit!.x).toBeCloseTo(0.75, 6);
		expect(hit!.y).toBeCloseTo(0.35, 6);
	});
});

describe("layerZ", () => {
	it("puts layer 0 at the front and the last at the back, in the middle of each", () => {
		expect(layerZ(0, 4, 0.2)).toBeCloseTo(0.075, 9);
		expect(layerZ(3, 4, 0.2)).toBeCloseTo(-0.075, 9);
		expect(layerZ(0, 1, 0.2)).toBeCloseTo(0, 9);
	});
});

describe("thumbnailUrl", () => {
	it("asks the tiler for one slice at the block's width", () => {
		expect(thumbnailUrl("/tiler", "liver", 3)).toBe("/tiler/slides/liver/thumbnail.jpg?width=512&slice=3");
	});
});
