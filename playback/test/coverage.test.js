import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { claimedIn, coverageGaps, FEATURES, NOT_SHOWN } from "../lib/coverage.js";

const SCENES = join(dirname(fileURLToPath(import.meta.url)), "..", "scenes");
const claimed = readdirSync(SCENES)
	.filter((file) => file.endsWith(".js"))
	.flatMap((file) => claimedIn(readFileSync(join(SCENES, file), "utf8")));

test("every feature on the list has a scene showing it", () => {
	assert.deepEqual(coverageGaps(claimed).missing, []);
});

test("scenes only claim features on the list, so a typo can't hide a gap", () => {
	assert.deepEqual(coverageGaps(claimed).unknown, []);
});

test("something not shown says why", () => {
	for (const [name, why] of Object.entries(NOT_SHOWN)) assert.ok(why.length > 10, name);
});

test("nothing is on both lists", () => {
	const descriptions = new Set(Object.values(FEATURES));
	for (const name of Object.keys(NOT_SHOWN)) assert.ok(!descriptions.has(name), name);
});

test("claimedIn finds did calls and nothing else", () => {
	assert.deepEqual(claimedIn(`sam.did('map-pan')\nguest.did( 'guest-join' )\nsam.caption('did')`), ["map-pan", "guest-join"]);
});

test("claimedIn finds either kind of quote, since formatting can change them", () => {
	assert.deepEqual(claimedIn(`sam.did("map-pan")\nsam.did('map-zoom')`), ["map-pan", "map-zoom"]);
});

test("coverageGaps reports both directions", () => {
	const { missing, unknown } = coverageGaps(["map-pan", "made-up"]);
	assert.ok(missing.includes("map-wheel-zoom"));
	assert.ok(!missing.includes("map-pan"));
	assert.deepEqual(unknown, ["made-up"]);
});
