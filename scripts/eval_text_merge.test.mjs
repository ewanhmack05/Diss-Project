// Tests for eval_text_merge.mjs. test_eval_latency.py runs them with the Python ones.
//
//   node --test scripts/eval_text_merge.test.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { compare, generator, jumpTo, lastSaveWins, summarise, survived, table, transformIndex, typing, yjsMerge } from "./eval_text_merge.mjs";

const settings = { people: 3, seconds: 30, seed: 1 };

test("the same seed gives the same typing, and another seed different typing", () => {
	assert.deepEqual(typing(settings), typing(settings));
	assert.notDeepEqual(typing(settings).keys, typing({ ...settings, seed: 2 }).keys);
});

test("the generator stays between 0 and 1", () => {
	const random = generator(7);
	for (let i = 0; i < 1000; i++) {
		const value = random();
		assert.ok(value >= 0 && value < 1);
	}
});

test("keys are in time order, and every word is unique", () => {
	const { keys, words } = typing(settings);
	assert.ok(keys.every((key, i) => i === 0 || keys[i - 1].at <= key.at));
	assert.equal(new Set(words).size, words.length);
	assert.equal(keys.length, words.join("").length);
});

test("a jump lands between words, never inside one", () => {
	assert.equal(jumpTo("", 0.5), 0);
	assert.equal(jumpTo("ab cd ", 0), 0);
	assert.equal(jumpTo("ab cd ", 0.2), 3);
	assert.equal(jumpTo("ab cd ", 0.5), 3);
	assert.equal(jumpTo("ab cd ", 0.99), 6);
	assert.equal(jumpTo("ab cd", 0.7), 5);
});

test("a caret moves through someone else's change as the viewer moves it", () => {
	assert.equal(transformIndex(5, [{ insert: "ab" }]), 7);
	assert.equal(transformIndex(5, [{ retain: 2 }, { insert: "ab" }]), 7);
	// Text inserted exactly at the caret goes after it.
	assert.equal(transformIndex(5, [{ retain: 5 }, { insert: "ab" }]), 5);
	assert.equal(transformIndex(5, [{ retain: 7 }, { insert: "ab" }]), 5);
	assert.equal(transformIndex(5, [{ delete: 2 }]), 3);
	assert.equal(transformIndex(5, [{ retain: 4 }, { delete: 3 }]), 4);
	assert.equal(transformIndex(0, [{ insert: "ab" }]), 0);
});

test("someone typing at the same spot can't push your next letter away from your word", () => {
	const keys = [
		{ at: 0, person: 0, letter: "A", jump: null },
		{ at: 0.1, person: 1, letter: "B", jump: null },
		{ at: 1, person: 0, letter: "A", jump: null },
		{ at: 1.1, person: 1, letter: "B", jump: null },
		{ at: 2, person: 0, letter: "A", jump: null },
		{ at: 2.1, person: 1, letter: "B", jump: null },
	];
	const trace = { keys, words: ["AAA", "BBB"] };
	assert.equal(survived(yjsMerge(trace, { people: 2, notice: 0.5 }).text, trace).wordsIntact, 1);
});

test("survived counts letters kept and words in one piece", () => {
	const trace = { keys: Array(8), words: ["abc ", "de "] };
	assert.deepEqual(survived("abc xxxx", trace), { letters: 1, wordsIntact: 0.5 });
	assert.deepEqual(survived("", trace), { letters: 0, wordsIntact: 0 });
});

test("Yjs keeps every letter and everyone ends up with the same text, however late they hear", () => {
	for (const notice of [0, 0.5, 5, 60]) {
		const trace = typing(settings);
		const merged = yjsMerge(trace, { people: 3, notice });
		assert.equal(merged.converged, true);
		assert.equal(merged.text.length, trace.keys.length);
	}
});

test("one person typing alone loses nothing either way", () => {
	const trace = typing({ people: 1, seconds: 30, seed: 3 });
	assert.equal(survived(lastSaveWins(trace, { people: 1, notice: 2 }).text, trace).wordsIntact, 1);
	assert.equal(survived(yjsMerge(trace, { people: 1, notice: 2 }).text, trace).wordsIntact, 1);
});

test("two people typing in turn with time to see each other lose nothing under last save wins", () => {
	const keys = [];
	const words = [];
	for (let i = 0; i < 6; i++) {
		const word = `P${i % 2}x${i} `;
		words.push(word);
		for (let c = 0; c < word.length; c++) keys.push({ at: i * 30 + c * 0.2, person: i % 2, letter: word[c], jump: null });
	}
	assert.equal(survived(lastSaveWins({ keys, words }, { people: 2, notice: 1 }).text, { keys, words }).wordsIntact, 1);
});

test("two people typing at the same time lose words under last save wins, and not under Yjs", () => {
	const run = compare({ people: 2, notice: 2, seconds: 120, seed: 1 });
	assert.ok(run.lastSave.wordsIntact < 1, "last save should lose something");
	assert.equal(run.yjs.letters, 1);
});

test("losing more with more people or longer notice shows up in the summary", () => {
	const runs = [compare({ people: 2, notice: 0.5, seconds: 120, seed: 0 }), compare({ people: 12, notice: 5, seconds: 120, seed: 0 })];
	const [few, many] = summarise(runs);
	assert.ok(many.lastSaveWordsIntact < few.lastSaveWordsIntact);
	assert.equal(few.yjsConverged, true);
});

test("the table has a row per setting with the same number of cells", () => {
	const text = table(summarise([compare({ people: 2, notice: 2, seconds: 30, seed: 0 })]));
	const lines = text.split("\n");
	assert.equal(lines.length, 3);
	assert.equal(new Set(lines.map((line) => line.split("|").length)).size, 1);
	assert.match(lines[2], /^\| 2 \| 2s \|/);
});
