// What happens to people typing in the same label or notes box at once, merged
// with Yjs as the viewer does it, against each save replacing the last as a plain
// text field would. The same typing goes through both, on a made up clock, so it's
// the same every run and takes no time. See docs/evaluation.md.
//
// Simulated typing, not people: each word goes in a letter at a time, with pauses
// between words, and sometimes the cursor jumps elsewhere in the box. What a person
// sees of someone else's typing arrives --notice seconds late. Uses the viewer's
// own copy of Yjs, so it needs image-viewer's node_modules.
//
//   node scripts/eval_text_merge.mjs
//   node scripts/eval_text_merge.mjs --people 2,6,12 --notice 0.5,2,5 --seeds 5 --json text.json

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "image-viewer", "package.json"));
const Y = require("yjs");

const SECONDS_PER_LETTER = 0.2;
const PAUSE_SECONDS = [2, 6];
// How long after their last key a form saves.
const SAVE_AFTER_SECONDS = 1;
const JUMP_CHANCE = 0.2;

// Small seeded generator, so a seed always gives the same typing.
function generator(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Every key anyone presses, in time order. A word is unique, so it can be looked
// for afterwards: person letter, then a number, then a space.
function typing({ people, seconds, seed }) {
	const random = generator(seed);
	const keys = [];
	const words = [];
	for (let person = 0; person < people; person++) {
		let at = random() * PAUSE_SECONDS[1];
		for (let number = 0; at < seconds; number++) {
			const word = `${String.fromCharCode(65 + (person % 26))}${person}x${number} `;
			words.push(word);
			const jump = random() < JUMP_CHANCE ? random() : null;
			for (let i = 0; i < word.length; i++) {
				keys.push({ at, person, letter: word[i], jump: i === 0 ? jump : null });
				at += SECONDS_PER_LETTER;
			}
			at += PAUSE_SECONDS[0] + random() * (PAUSE_SECONDS[1] - PAUSE_SECONDS[0]);
		}
	}
	keys.sort((a, b) => a.at - b.at || a.person - b.person);
	return { keys, words };
}

// Where a jump lands: the start of the next word from that share of the way through.
// Someone clicks between words to add one. Landing inside a word would split it, and
// that would count against the merge when it's only the simulated person's doing.
function jumpTo(text, share) {
	const from = Math.floor(share * (text.length + 1));
	if (from === 0 || text[from - 1] === " ") return from;
	const space = text.indexOf(" ", from);
	return space === -1 ? text.length : space + 1;
}

// Where a caret ends up after someone else's change - the same as transformIndex in
// the viewer's realtime/sharedFields.ts, so words split here would split there. Text
// inserted exactly at the caret goes after it. Copied, since this runs in plain Node
// and that's TypeScript. The test pins the cases it has to agree on.
function transformIndex(index, delta) {
	let oldPos = 0;
	let result = index;
	for (const op of delta) {
		if (oldPos > index) break;
		if (op.retain !== undefined) {
			oldPos += op.retain;
		} else if (op.insert !== undefined) {
			if (oldPos < index) result += op.insert.length;
		} else if (op.delete !== undefined) {
			if (oldPos < index) result -= Math.min(op.delete, index - oldPos);
			oldPos += op.delete;
		}
	}
	return result;
}

// How much of what was typed is still there. Letters is the share of keys pressed
// that ended up in the box; intact is the share of words still in one piece, since
// a merge that keeps every letter but shuffles two people's words together hasn't
// really kept them.
function survived(text, { keys, words }) {
	return {
		letters: keys.length ? text.length / keys.length : 1,
		wordsIntact: words.length ? words.filter((word) => text.includes(word)).length / words.length : 1,
	};
}

// Each save replaces the whole box. Someone mid-edit keeps their own copy and
// saves it over whatever's happened since - they only pick up other people's
// saves while they've nothing unsaved.
function lastSaveWins(trace, { people, notice }) {
	const copies = Array.from({ length: people }, () => ({ text: "", cursor: 0, unsaved: false, lastKey: 0, seenSave: 0 }));
	const saves = [{ at: -1, text: "", number: 0 }];
	let saved = "";

	const catchUp = (copy, now) => {
		if (copy.unsaved) return;
		const seen = saves.filter((s) => s.at <= now - notice).at(-1);
		if (seen && seen.number > copy.seenSave) {
			copy.text = seen.text;
			copy.cursor = seen.text.length;
			copy.seenSave = seen.number;
		}
	};
	const settleTo = (now) => {
		const due = copies.filter((c) => c.unsaved && c.lastKey + SAVE_AFTER_SECONDS <= now).sort((a, b) => a.lastKey - b.lastKey);
		for (const copy of due) {
			saved = copy.text;
			copy.unsaved = false;
			copy.seenSave = saves.length;
			saves.push({ at: copy.lastKey + SAVE_AFTER_SECONDS, text: saved, number: saves.length });
		}
	};

	for (const key of trace.keys) {
		settleTo(key.at);
		const copy = copies[key.person];
		catchUp(copy, key.at);
		if (key.jump !== null) copy.cursor = jumpTo(copy.text, key.jump);
		copy.text = copy.text.slice(0, copy.cursor) + key.letter + copy.text.slice(copy.cursor);
		copy.cursor += 1;
		copy.unsaved = true;
		copy.lastKey = key.at;
	}
	settleTo(Number.POSITIVE_INFINITY);
	return { text: saved, saves: saves.length - 1 };
}

// The same typing into a Y.Text per person, passing updates on after the delay,
// as the hub relays them. Each person's caret moves through what arrives the way the
// viewer's text box moves it.
function yjsMerge(trace, { people, notice }) {
	const docs = Array.from({ length: people }, (_, i) => {
		const doc = new Y.Doc();
		doc.clientID = i + 1;
		return doc;
	});
	const texts = docs.map((doc) => doc.getText("box"));
	const cursors = docs.map(() => 0);
	texts.forEach((text, person) => {
		text.observe((event) => {
			if (event.transaction.origin === "remote") cursors[person] = transformIndex(cursors[person], event.delta);
		});
	});
	const queue = [];
	let updateBytes = 0;
	let updates = 0;

	docs.forEach((doc, from) => {
		doc.on("update", (update, origin) => {
			if (origin === "remote") return;
			updateBytes += update.length;
			updates += 1;
			queue.push({ from, update, at: currentTime + notice });
		});
	});

	let currentTime = 0;
	const deliver = (until) => {
		while (queue.length && queue[0].at <= until) {
			const { from, update } = queue.shift();
			docs.forEach((doc, to) => {
				if (to !== from) Y.applyUpdate(doc, update, "remote");
			});
		}
	};

	for (const key of trace.keys) {
		currentTime = key.at;
		deliver(key.at);
		const text = texts[key.person];
		const index = key.jump !== null ? jumpTo(text.toString(), key.jump) : cursors[key.person];
		text.insert(index, key.letter);
		cursors[key.person] = index + 1;
	}
	deliver(Number.POSITIVE_INFINITY);

	const finals = texts.map((text) => text.toString());
	return {
		text: finals[0],
		converged: finals.every((text) => text === finals[0]),
		updates,
		updateBytes,
		stateBytes: Y.encodeStateAsUpdate(docs[0]).length,
	};
}

function compare({ people, notice, seconds, seed }) {
	const trace = typing({ people, seconds, seed });
	const merged = yjsMerge(trace, { people, notice });
	const replaced = lastSaveWins(trace, { people, notice });
	return {
		people,
		notice,
		seconds,
		seed,
		keys: trace.keys.length,
		words: trace.words.length,
		yjs: {
			...survived(merged.text, trace),
			converged: merged.converged,
			updates: merged.updates,
			updateBytes: merged.updateBytes,
			stateBytes: merged.stateBytes,
			textBytes: merged.text.length,
		},
		lastSave: { ...survived(replaced.text, trace), saves: replaced.saves },
	};
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function summarise(runs) {
	const rows = [];
	for (const people of [...new Set(runs.map((r) => r.people))]) {
		for (const notice of [...new Set(runs.map((r) => r.notice))]) {
			const group = runs.filter((r) => r.people === people && r.notice === notice);
			if (!group.length) continue;
			rows.push({
				people,
				notice,
				runs: group.length,
				words: Math.round(mean(group.map((r) => r.words))),
				yjsLetters: mean(group.map((r) => r.yjs.letters)),
				yjsWordsIntact: mean(group.map((r) => r.yjs.wordsIntact)),
				yjsConverged: group.every((r) => r.yjs.converged),
				lastSaveLetters: mean(group.map((r) => r.lastSave.letters)),
				lastSaveWordsIntact: mean(group.map((r) => r.lastSave.wordsIntact)),
				bytesPerLetterRelayed: mean(group.map((r) => r.yjs.updateBytes / r.keys)),
				stateBytesPerLetter: mean(group.map((r) => r.yjs.stateBytes / r.yjs.textBytes)),
			});
		}
	}
	return rows;
}

function table(rows) {
	const pct = (value) => `${(100 * value).toFixed(1)}%`;
	const lines = [
		"| People | Notice | Words typed | Yjs letters kept | Yjs words intact | Last save letters kept | Last save words intact | Relayed per letter | Saved state per letter |",
		"|---|---|---|---|---|---|---|---|---|",
	];
	for (const row of rows) {
		lines.push(
			`| ${row.people} | ${row.notice}s | ${row.words} | ${pct(row.yjsLetters)} | ${pct(row.yjsWordsIntact)} | ${pct(row.lastSaveLetters)} | ${pct(row.lastSaveWordsIntact)} | ${row.bytesPerLetterRelayed.toFixed(1)} bytes | ${row.stateBytesPerLetter.toFixed(1)} bytes |`,
		);
	}
	return lines.join("\n");
}

function option(argv, name, fallback) {
	const at = argv.indexOf(`--${name}`);
	return at === -1 ? fallback : argv[at + 1];
}

function main(argv) {
	const people = option(argv, "people", "2,6,12").split(",").map(Number);
	const notices = option(argv, "notice", "0.5,2,5").split(",").map(Number);
	const seeds = Number(option(argv, "seeds", "5"));
	const seconds = Number(option(argv, "seconds", "120"));
	const runs = [];
	for (const count of people) {
		for (const notice of notices) {
			for (let seed = 0; seed < seeds; seed++) runs.push(compare({ people: count, notice, seconds, seed }));
		}
	}
	const rows = summarise(runs);
	console.log(table(rows));
	const out = option(argv, "json", null);
	if (out) writeFileSync(out, JSON.stringify({ settings: { people, notices, seeds, seconds }, summary: rows, runs }, null, 2));
}

export { compare, generator, jumpTo, lastSaveWins, summarise, survived, table, transformIndex, typing, yjsMerge };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
