import { describe, expect, it } from "vitest";
import {
	cameraFromBlock,
	cameraToBlock,
	camerasToDraw,
	cutOutline,
	easeCamera,
	easeTime,
	EASE_HALF_LIFE_MS,
	frustumLines,
	fromBlock,
	isStill,
	sameCamera,
	textureToWorld,
	toBlock,
	viewBoxInBlock,
} from "./cameras";
import { textureRay, type Vec3 } from "./volume";

const close = (a: Vec3, b: Vec3, digits = 9) => a.forEach((value, i) => expect(value).toBeCloseTo(b[i], digits));

describe("block units", () => {
	it("go there and back", () => {
		const size: Vec3 = [1, 1.4, 0.2];
		close(fromBlock(toBlock([0.3, -0.5, 2.2], size), size), [0.3, -0.5, 2.2]);
	});

	it("put a camera in the same place against blocks stretched differently", () => {
		// Alice draws the block twice as deep as Bob does.
		const alice: Vec3 = [1, 1.4, 0.4];
		const bob: Vec3 = [1, 1.4, 0.2];
		const camera = cameraToBlock([0.5, 0.7, 0.4], [0, 0, 0], 40, alice);
		// Just off a corner of Alice's block is just off the same corner of Bob's.
		expect(camera.position).toEqual([0.5, 0.5, 1]);
		const there = cameraFromBlock(camera, bob);
		close(there.position, [0.5, 0.7, 0.2]);
		close(there.target, [0, 0, 0]);
	});
});

describe("sameCamera", () => {
	const a = { position: [1, 2, 3] as Vec3, target: [0, 0, 0] as Vec3, fov: 40 };

	it("is the same within a hair", () => {
		expect(sameCamera(a, { ...a, position: [1, 2, 3.00001] })).toBe(true);
	});

	it("isn't once it's moved, or turned to look elsewhere", () => {
		expect(sameCamera(a, { ...a, position: [1, 2, 3.1] })).toBe(false);
		expect(sameCamera(a, { ...a, target: [0.1, 0, 0] })).toBe(false);
	});

	it("treats none and none as the same, and none and some as not", () => {
		expect(sameCamera(null, undefined)).toBe(false);
		expect(sameCamera(null, null)).toBe(true);
		expect(sameCamera(a, null)).toBe(false);
	});
});

describe("frustumLines", () => {
	it("is four edges out from the camera then the base - sixteen points", () => {
		const lines = frustumLines([0, 0, 2], [0, 0, 0], 40, 0.1);
		expect(lines).toHaveLength(16);
		for (let i = 0; i < 8; i += 2) expect(lines[i]).toEqual([0, 0, 2]);
	});

	it("puts its base that far along where it's looking, as wide as its field of view", () => {
		const lines = frustumLines([0, 0, 2], [0, 0, 0], 90, 0.5, 1);
		const base = lines.filter((_, i) => i % 2 === 1).slice(0, 4);
		// tan(45°) * 0.5 = 0.5 either side, 0.5 along -z.
		for (const corner of base) {
			expect(corner[2]).toBeCloseTo(1.5);
			expect(Math.abs(corner[0])).toBeCloseTo(0.5);
			expect(Math.abs(corner[1])).toBeCloseTo(0.5);
		}
	});

	it("still works looking straight down", () => {
		const lines = frustumLines([0, 3, 0], [0, 0, 0], 40, 0.2);
		expect(lines.flat().every(Number.isFinite)).toBe(true);
		expect(lines[1][1]).toBeCloseTo(2.8);
	});
});

describe("viewBoxInBlock", () => {
	it("lays a 2D view on its slice, slide pixels to the block", () => {
		// The whole of a 2000 x 1000 slide, unrotated, on the first of 4 layers.
		const viewport = { center: [1000, -500] as [number, number], resolution: 1, rotation: 0, extent: [0, -1000, 2000, 0] as [number, number, number, number] };
		const size: Vec3 = [1, 0.5, 0.4];
		const ring = viewBoxInBlock(viewport, { width: 2000, height: 1000 }, size, 0, 4);
		expect(ring).toHaveLength(5);
		// Top-left of the slide is the block's top-left; layer 0 is at the front.
		close(ring[0], [-0.5, 0.25, 0.15]);
		close(ring[2], [0.5, -0.25, 0.15]);
	});
});

describe("textureToWorld", () => {
	it("undoes the ray into texture space", () => {
		const size: Vec3 = [1, 1.3, 0.25];
		const world: Vec3 = [0.2, -0.1, 0.05];
		const { origin } = textureRay(world, [0, 0, 1], size);
		close(textureToWorld(origin, size), world);
	});
});

describe("cutOutline", () => {
	const size: Vec3 = [1, 1, 1];

	it("is nothing with no cut", () => {
		expect(cutOutline("none", 0.5, size)).toEqual([]);
	});

	it("is a closed square across the block for a straight cut", () => {
		const ring = cutOutline("x", 0.25, size);
		expect(ring).toHaveLength(5);
		expect(ring[0]).toEqual(ring[4]);
		for (const p of ring) expect(p[0]).toBeCloseTo(-0.25);
	});

	it("is a hexagon through the middle on the diagonal", () => {
		const ring = cutOutline("diagonal", 0.5, size);
		expect(ring).toHaveLength(7);
		// Every point is on the cut: x + y + z = 1.5 in texture space.
		for (const p of ring) {
			const t = [p[0] + 0.5, 0.5 - p[1], 0.5 - p[2]];
			expect(t[0] + t[1] + t[2]).toBeCloseTo(1.5);
		}
	});

	it("goes round in order, so no edge crosses the middle", () => {
		const ring = cutOutline("diagonal", 0.5, size);
		const middle = ring.slice(0, -1).reduce((m, p) => [m[0] + p[0] / 6, m[1] + p[1] / 6, m[2] + p[2] / 6], [0, 0, 0]);
		const sides = ring.slice(0, -1).map((p, i) => {
			const q = ring[i + 1];
			const a = [p[0] - middle[0], p[1] - middle[1], p[2] - middle[2]];
			const b = [q[0] - middle[0], q[1] - middle[1], q[2] - middle[2]];
			return a[0] * b[1] - a[1] * b[0] + a[1] * b[2] - a[2] * b[1] + a[2] * b[0] - a[0] * b[2];
		});
		expect(sides.every((s) => s > 0) || sides.every((s) => s < 0)).toBe(true);
	});

	it("scales with the block", () => {
		// A Y cut at 0 is the block's top face, 2 high and 0.4 deep.
		const ring = cutOutline("y", 0, [1, 2, 0.4]);
		for (const p of ring) expect(p[1]).toBeCloseTo(1);
		expect(Math.max(...ring.map((p) => p[2]))).toBeCloseTo(0.2);
	});
});

describe("camerasToDraw", () => {
	const person = (id: string, host = false) => ({ connectionId: id, host });

	it("draws everyone up to six", () => {
		const people = ["a", "b", "c", "d", "e", "f"].map((id) => person(id));
		expect(camerasToDraw(people, new Map(), 0)).toHaveLength(6);
	});

	it("past that, the host and whoever's moved in the last minute", () => {
		const people = [person("host", true), ...["a", "b", "c", "d", "e", "f"].map((id) => person(id))];
		const moved = new Map([
			["a", 100_000],
			["b", 10_000],
		]);
		expect(camerasToDraw(people, moved, 120_000).map((p) => p.connectionId)).toEqual(["host", "a"]);
	});
});

describe("isStill", () => {
	it("is still once it's not moved for half a minute, or never has", () => {
		expect(isStill(0, 30_001)).toBe(true);
		expect(isStill(0, 29_000)).toBe(false);
		expect(isStill(undefined, 5)).toBe(true);
	});
});

describe("easeCamera", () => {
	const from = { position: [2, 0, 0] as Vec3, target: [0, 0, 0] as Vec3 };
	const goal = { position: [0, 0, 2] as Vec3, target: [0, 0.5, 0] as Vec3 };

	it("closes half the gap each half-life", () => {
		const step = easeCamera(from, goal, EASE_HALF_LIFE_MS);
		close(step.position, [1, 0, 1]);
		close(step.target, [0, 0.25, 0]);
		expect(step.done).toBe(false);
	});

	it("is the same however the frames fall", () => {
		// One 120 ms frame or ten 12 ms ones end up in the same place.
		const once = easeCamera(from, goal, 120);
		let many = { ...from };
		for (let i = 0; i < 10; i++) many = easeCamera(many, goal, 12);
		close(once.position, many.position);
		close(once.target, many.target);
	});

	it("lands exactly on the goal once it's close, and says it's done", () => {
		let now = { ...from };
		let frames = 0;
		let step;
		do {
			step = easeCamera(now, goal, 16);
			now = step;
			frames++;
		} while (!step.done && frames < 1000);
		expect(step.done).toBe(true);
		expect(now.position).toEqual(goal.position);
		expect(now.target).toEqual(goal.target);
		// About as long as easeTime says, give or take a frame.
		expect(Math.abs(frames * 16 - easeTime(Math.hypot(2, 2)))).toBeLessThanOrEqual(32);
	});

	it("doesn't move with no time passed, or go backwards with time that's gone wrong", () => {
		close(easeCamera(from, goal, 0).position, from.position);
		close(easeCamera(from, goal, -50).position, from.position);
	});
});

describe("easeTime", () => {
	it("is nothing when it's already there", () => {
		expect(easeTime(0)).toBe(0);
	});

	it("is a half-life for every halving down to landing", () => {
		// From 1 world unit: log2(1 / 1e-4), about 13.3 half-lives.
		expect(easeTime(1)).toBeCloseTo(EASE_HALF_LIFE_MS * Math.log2(1e4));
	});
});
