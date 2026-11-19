import assert from "node:assert/strict";
import { test } from "node:test";
import { frameStats, quietAfter } from "../lib/measure.js";

test("frameStats works out frames a second and the gaps between them", () => {
	const times = Array.from({ length: 61 }, (_, i) => i * (1000 / 60));
	assert.deepEqual(frameStats(times), { fps: 60, median: 16.7, p95: 16.7 });
});

test("frameStats shows a slow frame in the 95th percentile, not the median", () => {
	const gaps = [...Array(19).fill(10), 100];
	const times = gaps.reduce((all, gap) => [...all, all.at(-1) + gap], [0]);
	const stats = frameStats(times);
	assert.equal(stats.median, 10);
	assert.equal(stats.p95, 100);
});

test("frameStats with fewer than two frames is all zero", () => {
	assert.deepEqual(frameStats([5]), { fps: 0, median: 0, p95: 0 });
});

test("quietAfter is the last tile before a quiet gap", () => {
	assert.equal(quietAfter([30, 80, 120, 900], 400), 120);
	assert.equal(quietAfter([120, 30, 80], 400), 120);
});

test("quietAfter with nothing fetched is sharp at once", () => {
	assert.equal(quietAfter([], 400), 0);
});
