import { describe, expect, it } from "vitest";
import {
	BLOCK_WIDTH,
	blockSize,
	blockWidthFor,
	VOXEL_BUDGET,
	buildVolume,
	addSlice,
	emptyVolume,
	DETAIL_PIXELS,
	detailSlice,
	detailTier,
	FACE_TILES,
	faceAxis,
	faceLength,
	facePixel,
	faceTier,
	faceTiles,
	cutPlane,
	defaultStretch,
	depthStretch,
	firstHit,
	layerSlices,
	layerZ,
	slabAt,
	spacingText,
	textureRay,
	thumbnailUrl,
	tissueAlpha,
	type Clip,
	type DetailView,
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

describe("emptyVolume and addSlice", () => {
	it("fill the block a slice at a time, in any order, the same as buildVolume", () => {
		const pictures = [picture(3, 2, PINK), picture(3, 2, GLASS, { x: 1, y: 0, size: 1, colour: PURPLE }), picture(3, 2, PURPLE)];
		const volume = emptyVolume(3, 2, slices(3, [2]));
		addSlice(volume, 2, pictures[2]);
		addSlice(volume, 0, pictures[0]);
		addSlice(volume, 1, pictures[1]);

		expect(volume).toEqual(buildVolume(pictures, slices(3, [2])));
		expect(volume.layerSlice).toEqual([0, 1, null, 2]);
	});

	it("refuses a picture of the wrong size or a slice it hasn't got", () => {
		const volume = emptyVolume(2, 2, slices(2));
		expect(() => addSlice(volume, 0, picture(3, 2, PINK))).toThrow(/differ in size/);
		expect(() => addSlice(volume, 5, picture(2, 2, PINK))).toThrow(/no slice 5/);
		expect(() => emptyVolume(2, 2, [])).toThrow(/no slices/);
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

	it("gets deeper to make room for gaps, so a slice keeps its thickness", () => {
		const [, , solid] = blockSize(W, H, 16, MPP, 1);
		expect(blockSize(W, H, 16, MPP, 1, undefined, 0)[2]).toBeCloseTo(solid, 12);
		expect(blockSize(W, H, 16, MPP, 1, undefined, 1)[2]).toBeCloseTo(2 * solid, 12);
		expect(blockSize(W, H, 16, MPP, 1, undefined, 3)[2]).toBeCloseTo(4 * solid, 12);
		// Each slice's share is solid / 16 * 4, and its slab a quarter of that.
		expect(blockSize(W, H, 16, MPP, 1, undefined, -2)[2]).toBeCloseTo(solid, 12);
	});
});

describe("depthStretch", () => {
	// Kartasalo's liver: 32384 px at 0.46 um, 52 layers at 5 um.
	const liver = { width: 32384, height: 31872, mpp: 0.46, layers: 52, microns: 5 };
	const scale = defaultStretch(liver.width, liver.layers, liver.mpp, liver.microns);

	it("is the panel's stretch times the default when not true", () => {
		expect(depthStretch(false, scale, 1)).toBeCloseTo(scale);
		expect(depthStretch(false, scale, 2)).toBeCloseTo(2 * scale);
	});

	it("is no stretch at all for true depth, whatever the slider says", () => {
		expect(depthStretch(true, scale, 1)).toBe(1);
		expect(depthStretch(true, scale, 4)).toBe(1);
	});

	it("makes the liver block 0.26 mm deep against 14.9 mm across, about 11.5x thinner than default", () => {
		const [, , trueDepth] = blockSize(liver.width, liver.height, liver.layers, liver.mpp, depthStretch(true, scale, 1), liver.microns);
		const [, , drawnDepth] = blockSize(liver.width, liver.height, liver.layers, liver.mpp, depthStretch(false, scale, 1), liver.microns);
		expect(trueDepth).toBeCloseTo((52 * 5) / (32384 * 0.46), 6);
		expect(drawnDepth / trueDepth).toBeCloseTo(11.46, 1);
	});
});

describe("slabAt", () => {
	it("with no gap, every depth is in a layer", () => {
		expect(slabAt(0, 4, 0)).toBe(0);
		expect(slabAt(0.26, 4, 0)).toBe(1);
		expect(slabAt(1, 4, 0)).toBe(3);
	});

	it("a gap as thick as a slice leaves the middle half of each share", () => {
		// 4 layers: shares 0.25 deep, slabs the middle 0.125 of each.
		expect(slabAt(0.125, 4, 1)).toBe(0);
		expect(slabAt(0.0625, 4, 1)).toBe(0);
		expect(slabAt(0.1875, 4, 1)).toBe(0);
		expect(slabAt(0.06, 4, 1)).toBeNull();
		expect(slabAt(0.2, 4, 1)).toBeNull();
		expect(slabAt(0.26, 4, 1)).toBeNull();
		expect(slabAt(0.375, 4, 1)).toBe(1);
		expect(slabAt(0.875, 4, 1)).toBe(3);
	});

	it("stays inside the block at its faces", () => {
		expect(slabAt(-0.5, 4, 0)).toBe(0);
		expect(slabAt(1.5, 4, 0)).toBe(3);
		expect(slabAt(1, 4, 1)).toBeNull();
	});
});

describe("spacingText", () => {
	it("says none, or how many slices thick", () => {
		expect(spacingText(0)).toBe("None");
		expect(spacingText(1)).toBe("1x a slice");
		expect(spacingText(2.5)).toBe("2.5x a slice");
	});
});

describe("blockWidthFor", () => {
	it("is the full 1024 for the 16-layer liver", () => {
		expect(BLOCK_WIDTH).toBe(1024);
		expect(blockWidthFor(16, 45104 / 40288)).toBe(BLOCK_WIDTH);
	});

	it("is the full 1024 for Kartasalo's liver too - 47 slices and 5 gaps, 215 MB", () => {
		const width = blockWidthFor(52, 31872 / 32384);
		expect(width).toBe(1024);
		expect(width * Math.round((width * 31872) / 32384) * 52 * 4).toBeLessThan(220e6);
	});

	it("is narrower for 260 slices, and keeps the block inside the budget", () => {
		const width = blockWidthFor(260, 1);
		expect(width).toBeLessThan(BLOCK_WIDTH);
		expect(width * width * 260).toBeLessThanOrEqual(VOXEL_BUDGET);
		expect((width + 1) * (width + 1) * 260).toBeGreaterThan(VOXEL_BUDGET);
	});

	it("never goes below what the tiler will make", () => {
		expect(blockWidthFor(100000, 1)).toBe(32);
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

	describe("spaced out", () => {
		// All tissue, every layer - so anything but a gap is a hit.
		const solid = buildVolume([picture(10, 10, PURPLE), picture(10, 10, PURPLE), picture(10, 10, PURPLE)], slices(3));
		const spaced: Clip = { ...everything, spacing: 1 };

		it("can't land in a gap - nothing's drawn there", () => {
			// Layer 0's share is z 0-1/3, its slab the middle half: 1/12 to 3/12.
			expect(firstHit(solid, [-1, 0.5, 0.02], [1, 0, 0], spaced)).toBeNull();
			expect(firstHit(solid, [-1, 0.5, 0.3], [1, 0, 0], spaced)).toBeNull();
			expect(firstHit(solid, [-1, 0.5, 0.02], [1, 0, 0], everything)).not.toBeNull();
		});

		it("lands on a slab from the side", () => {
			expect(firstHit(solid, [-1, 0.5, 0.5], [1, 0, 0], spaced)!.layer).toBe(1);
			expect(firstHit(solid, [-1, 0.5, 0.84], [1, 0, 0], spaced)!.layer).toBe(2);
		});

		it("doesn't step over a slab however thin it is", () => {
			// Tissue only on the last layer, whose slab is centred at z 5/6. A gap 20
			// slices thick leaves it 0.0159 deep - half-voxel steps of 0.05 from the
			// front land at 0.80 and 0.85, either side of it.
			const back = buildVolume([picture(10, 10, GLASS), picture(10, 10, GLASS), picture(10, 10, GLASS, { x: 6, y: 2, size: 3, colour: PURPLE })], slices(3));
			const hit = firstHit(back, [0.75, 0.35, -1], down, { ...everything, spacing: 20 });
			expect(hit!.layer).toBe(2);
			expect(hit!.x).toBeCloseTo(0.75, 9);
		});

		it("going in from the front, lands on the first slab, not in the gap before it", () => {
			const hit = firstHit(solid, [0.5, 0.5, -1], down, spaced);
			expect(hit!.layer).toBe(0);
		});
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
		expect(thumbnailUrl("/tiler", "liver", 3)).toBe("/tiler/slides/liver/thumbnail.jpg?width=1024&slice=3");
	});
});

describe("detailTier", () => {
	const liver = { width: 32384, height: 31872, tileSize: 256 };

	it("is the sharpest tier that fits the budget - 1/8 of Kartasalo's liver", () => {
		const tier = detailTier(liver, 16384);
		expect(tier.downsample).toBe(8);
		expect([tier.width, tier.height]).toEqual([4048, 3984]);
		expect(tier.width * tier.height).toBeLessThanOrEqual(DETAIL_PIXELS);
		expect([tier.cols, tier.rows]).toEqual([16, 16]);
	});

	it("and the prostate", () => {
		const tier = detailTier({ width: 23456, height: 28896, tileSize: 256 }, 16384);
		expect([tier.downsample, tier.width, tier.height]).toEqual([8, 2932, 3612]);
	});

	it("stays inside the GPU's biggest texture", () => {
		expect(detailTier(liver, 2048).downsample).toBe(16);
	});

	it("takes the slide as it is when it's small enough", () => {
		expect(detailTier({ width: 3000, height: 2000, tileSize: 256 }, 16384)).toMatchObject({ downsample: 1, width: 3000, height: 2000 });
	});

	it("falls back to the coarsest when nothing fits", () => {
		expect(detailTier(liver, 16384, 10).z).toBe(0);
	});
});

describe("the sharp cut face", () => {
	const liver = { width: 32384, height: 31872, tileSize: 256 };
	const prostate = { width: 23456, height: 28896, tileSize: 256 };

	it("is only for X and Y cuts", () => {
		expect(faceAxis("x")).toBe("x");
		expect(faceAxis("y")).toBe("y");
		expect(faceAxis("z")).toBeNull();
		expect(faceAxis("diagonal")).toBeNull();
		expect(faceAxis("none")).toBeNull();
	});

	it("is 1/8 of Kartasalo's liver: 16 tiles down each of 47 slices, 4x the block", () => {
		const tier = faceTier(liver, "x", 47, 16384, 1008);
		expect(tier?.downsample).toBe(8);
		expect(faceLength(tier!, "x")).toBe(3984);
		expect(tier!.rows * 47).toBe(752);
		expect(tier!.rows * 47).toBeLessThanOrEqual(FACE_TILES);
	});

	it("goes coarser for more slices: 1/32 for the 260-slice prostate", () => {
		const down = faceTier(prostate, "x", 260, 16384, 551);
		expect([down?.downsample, faceLength(down!, "x"), down!.rows * 260]).toEqual([32, 903, 1040]);
		const across = faceTier(prostate, "y", 260, 16384, 447);
		expect([across?.downsample, faceLength(across!, "y"), across!.cols * 260]).toEqual([32, 733, 780]);
	});

	it("is none when nothing finer than the block fits", () => {
		// 1000 slices of the prostate: even 1/64 is 2 tiles each, and no finer than its block.
		expect(faceTier(prostate, "x", 1000, 16384, 551)).toBeNull();
		expect(faceTier(liver, "x", 47, 16384, 4000)).toBeNull();
	});

	it("stays inside the GPU's biggest texture", () => {
		expect(faceTier(liver, "x", 1, 2048, 1008)?.downsample).toBe(16);
	});

	it("is the column the cut goes through, in that tier's pixels", () => {
		const tier = faceTier(liver, "x", 47, 16384, 1008)!;
		expect(facePixel(tier, "x", 0.5)).toBe(2024);
		expect(facePixel(tier, "y", 0.5)).toBe(1992);
		// Nothing cut away: the face is the block's side, its last column.
		expect(facePixel(tier, "x", 1)).toBe(4047);
		expect(facePixel(tier, "x", 0)).toBeNull();
	});

	it("comes from one column of tiles for an X cut, end to end down the slide", () => {
		const tier = faceTier(liver, "x", 47, 16384, 1008)!;
		const tiles = faceTiles(tier, 256, "x", 2024);
		expect(tiles).toHaveLength(16);
		expect(tiles.every((tile) => tile.x === 7 && tile.pick === 2024 - 7 * 256 && tile.z === tier.z)).toBe(true);
		expect(tiles.map((tile) => tile.y)).toEqual([...Array(16).keys()]);
		expect(tiles.map((tile) => tile.at)).toEqual([...Array(16).keys()].map((i) => i * 256));
	});

	it("and one row of tiles for a Y cut, across it", () => {
		const tier = faceTier(liver, "y", 47, 16384, 1024)!;
		const tiles = faceTiles(tier, 256, "y", 300);
		expect(tiles).toHaveLength(tier.cols);
		expect(tiles.every((tile) => tile.y === 1 && tile.pick === 44)).toBe(true);
		expect(tiles.map((tile) => tile.x)).toEqual([...Array(tier.cols).keys()]);
	});
});

describe("detailSlice", () => {
	// Slices 0-4, a gap before 3: layers [0, 1, 2, gap, 3, 4].
	const layerSlice = [0, 1, 2, null, 3, 4];
	const view: DetailView = {
		layerSlice,
		current: 2,
		firstLayer: 0,
		lastLayer: 5,
		spacing: 0,
		cut: "none",
		cutPosition: 0.5,
		cameraInFront: true,
	};

	it("solid, from the front: the front slice - it's the only one that shows", () => {
		expect(detailSlice(view)).toBe(0);
	});

	it("solid, from behind: the back slice", () => {
		expect(detailSlice({ ...view, cameraInFront: false })).toBe(4);
	});

	it("follows the slices drawn", () => {
		expect(detailSlice({ ...view, firstLayer: 1 })).toBe(1);
		expect(detailSlice({ ...view, lastLayer: 2, cameraInFront: false })).toBe(2);
	});

	it("steps past a gap layer to the next slice in", () => {
		expect(detailSlice({ ...view, firstLayer: 3 })).toBe(3);
		expect(detailSlice({ ...view, lastLayer: 3, cameraInFront: false })).toBe(2);
	});

	it("from behind a Z cut, the face it leaves", () => {
		// The cut at 0.5 keeps layers 0-2.
		expect(detailSlice({ ...view, cut: "z", cameraInFront: false })).toBe(2);
		expect(detailSlice({ ...view, cut: "z", cutPosition: 0.75, cameraInFront: false })).toBe(3);
		// 0.9 keeps part of the last layer, so its face is there.
		expect(detailSlice({ ...view, cut: "z", cutPosition: 0.9, cameraInFront: false })).toBe(4);
		// From the front a Z cut changes nothing.
		expect(detailSlice({ ...view, cut: "z" })).toBe(0);
	});

	it("spaced out: the slice the 2D view's on, wherever the camera is", () => {
		expect(detailSlice({ ...view, spacing: 1 })).toBe(2);
		expect(detailSlice({ ...view, spacing: 1, current: 4, cameraInFront: false })).toBe(4);
	});

	it("nothing when that slice isn't drawn, or nothing is", () => {
		expect(detailSlice({ ...view, spacing: 1, firstLayer: 4 })).toBeNull();
		expect(detailSlice({ ...view, cut: "z", cutPosition: 0, cameraInFront: false })).toBeNull();
		expect(detailSlice({ ...view, firstLayer: 3, lastLayer: 3 })).toBeNull();
	});
});
