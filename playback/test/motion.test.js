import assert from "node:assert/strict";
import { test } from "node:test";
import { arc, easedPath, pathThrough, sliderX, stepsFor, wobblyLoop } from "../lib/motion.js";

test("an eased path ends exactly where it was going", () => {
	const path = easedPath({ x: 0, y: 0 }, { x: 100, y: 50 }, 10);
	assert.equal(path.length, 10);
	assert.deepEqual(path.at(-1), { x: 100, y: 50 });
});

test("an eased path starts slow and speeds up", () => {
	const path = easedPath({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
	assert.ok(path[0].x < 10);
	assert.ok(path[5].x - path[4].x > path[0].x);
});

test("an eased path copes with being asked for no steps", () => {
	assert.deepEqual(easedPath({ x: 0, y: 0 }, { x: 5, y: 5 }, 0), [{ x: 5, y: 5 }]);
});

test("steps are capped both ways so moves never crawl or jump", () => {
	assert.equal(stepsFor({ x: 0, y: 0 }, { x: 1, y: 0 }), 6);
	assert.equal(stepsFor({ x: 0, y: 0 }, { x: 5000, y: 0 }), 40);
	assert.equal(stepsFor({ x: 0, y: 0 }, { x: 200, y: 0 }), 20);
});

test("a path through waypoints visits every one", () => {
	const points = [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ x: 10, y: 10 },
	];
	const path = pathThrough(points, 2);
	assert.deepEqual(path, [
		{ x: 0, y: 0 },
		{ x: 5, y: 0 },
		{ x: 10, y: 0 },
		{ x: 10, y: 5 },
		{ x: 10, y: 10 },
	]);
});

test("an arc stays on its circle", () => {
	for (const point of arc({ x: 10, y: 20 }, 5, 0, 200, 8)) {
		assert.ok(Math.abs(Math.hypot(point.x - 10, point.y - 20) - 5) < 1e-9);
	}
});

test("a wobbly loop closes and is the same every time", () => {
	const loop = wobblyLoop({ x: 0, y: 0 }, 50);
	assert.ok(Math.hypot(loop[0].x - loop.at(-1).x, loop[0].y - loop.at(-1).y) < 1e-6);
	assert.deepEqual(loop, wobblyLoop({ x: 0, y: 0 }, 50));
});

test("sliderX lands where the value sits, and stays on the slider", () => {
	const box = { x: 100, width: 200 };
	assert.equal(sliderX(box, -1, 1, 0), 200);
	assert.equal(sliderX(box, 0, 2, 2), 300);
	assert.equal(sliderX(box, 0, 2, 9), 300);
	assert.equal(sliderX(box, 0, 2, -9), 100);
});
