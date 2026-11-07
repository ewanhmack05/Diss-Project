import assert from "node:assert/strict";
import { test } from "node:test";
import { geoJsonSquares, SLIDE_SIZE } from "../scenes/helpers.js";
import { SCENES } from "../scenes/index.js";

test("the GeoJSON made for importing has what was asked for, inside the slide", () => {
	const file = geoJsonSquares(60);
	assert.equal(file.type, "FeatureCollection");
	assert.equal(file.features.length, 60);
	for (const feature of file.features) {
		for (const [x, y] of feature.geometry.coordinates[0]) {
			assert.ok(x >= 0 && x <= SLIDE_SIZE.width, `x ${x}`);
			assert.ok(y >= 0 && y <= SLIDE_SIZE.height, `y ${y}`);
		}
	}
});

test("each square is a closed ring with its own label", () => {
	const { features } = geoJsonSquares(4);
	for (const feature of features) {
		const ring = feature.geometry.coordinates[0];
		assert.deepEqual(ring[0], ring.at(-1));
	}
	assert.equal(new Set(features.map((f) => f.properties.label)).size, 4);
});

test("scene names are unique and safe as file names", () => {
	const names = SCENES.map((scene) => scene.name);
	assert.equal(new Set(names).size, names.length);
	for (const name of names) assert.match(name, /^[a-z-]+$/);
});

test("every scene says who is in it and has something to run", () => {
	for (const scene of SCENES) {
		assert.ok(scene.cast.length >= 1 && scene.cast.length <= 2, scene.name);
		assert.equal(typeof scene.run, "function", scene.name);
		assert.ok(scene.title.length > 5, scene.name);
	}
});
