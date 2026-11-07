import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "../lib/actor.js";
import { FEATURES, LOOKED_AT } from "../lib/coverage.js";

function fakePage({ failing = false } = {}) {
	const page = {
		calls: 0,
		on() {},
		waitForTimeout: async () => {},
		evaluate: async () => {
			page.calls++;
			if (failing) throw new Error("page is loading");
		},
	};
	return page;
}

test("a caption clears the other person's, so a stale one can't read as current", async () => {
	const sam = new Actor(fakePage(), "sam");
	const jo = new Actor(fakePage(), "jo");
	sam.others = [jo];
	await sam.caption("Sam: draws", 0);
	assert.equal(sam.page.calls, 1);
	assert.equal(jo.page.calls, 1);
});

test("keepOthers leaves the other person's caption up", async () => {
	const sam = new Actor(fakePage(), "sam");
	const jo = new Actor(fakePage(), "jo");
	sam.others = [jo];
	await sam.caption("Sam: draws", 0, { keepOthers: true });
	assert.equal(jo.page.calls, 0);
});

test("someone else's page being mid load doesn't fail the scene", async () => {
	const sam = new Actor(fakePage(), "sam");
	sam.others = [new Actor(fakePage({ failing: true }), "jo")];
	await assert.doesNotReject(sam.caption("Sam: draws", 0));
});

test("everything only checked by eye is a real feature", () => {
	for (const id of LOOKED_AT) assert.ok(id in FEATURES, id);
});
