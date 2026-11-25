import { describe, expect, it, vi } from "vitest";
import type { DocState } from "./realtime";
import { SharedFields } from "./sharedFields";
import { TextEdit, TEXT_FIELDS, idsOf, saveText, whatChanged, type SaveOptions, type TextField, type TextNow, type TextToSave, type When } from "./ownText";
import { TextSaves } from "./textSaves";
import { putInDoc, textToPut, type OpenFields } from "./putText";
import { StoredText, takeWhen, withWhen } from "./storedText";

// Yjs gives each copy a random number, which settles whose typing comes first
// when two people type in the same place. Set per run, so it's the same every
// time. It takes this when it loads, so it has to be there before that.
const numbers = vi.hoisted(() => {
	const source = { random: Math.random };
	crypto.getRandomValues = <T extends ArrayBufferView | null>(into: T): T => {
		if (into instanceof Uint32Array) for (let i = 0; i < into.length; i++) into[i] = Math.floor(source.random() * 4294967296);
		return into;
	};
	return source;
});

// People typing in the same form at once, over a slow network, with the hub,
// the store and the forms' own code. No character's ever typed twice, so whose
// each one is in an entry is there to see. Everything's on a made up clock and
// a seed, so a run's the same every time.

function seeded(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface Event {
	at: number;
	order: number;
	run: () => void;
	off: boolean;
}

class World {
	now = 0;
	readonly random: () => number;
	private events: Event[] = [];
	private order = 0;
	private chars = 0x4e00;
	// Ordinary typing, instead - the same few over and over.
	letters = "";

	constructor(seed: number) {
		this.random = seeded(seed);
	}

	after(ms: number, run: () => void): Event {
		const event = { at: this.now + ms, order: this.order++, run, off: false };
		this.events.push(event);
		return event;
	}

	readonly clock = {
		set: (run: () => void, ms: number) => this.after(ms, run),
		clear: (timer: unknown) => {
			(timer as Event).off = true;
		},
	};

	newChar = () => (this.letters ? this.letters[Math.floor(this.random() * this.letters.length)] : String.fromCharCode(this.chars++));

	latency = () => 5 + this.random() * this.random() * 600;

	wait(): Promise<void> {
		return new Promise((resolve) => this.after(this.latency(), resolve));
	}

	async run(): Promise<void> {
		for (let steps = 0; this.events.length > 0; steps++) {
			if (steps > 50_000) throw new Error("It never settles");
			let first = 0;
			for (let i = 1; i < this.events.length; i++) {
				const [a, b] = [this.events[i], this.events[first]];
				if (a.at < b.at || (a.at === b.at && a.order < b.order)) first = i;
			}
			const [event] = this.events.splice(first, 1);
			if (event.off) continue;
			this.now = event.at;
			event.run();
			for (let i = 0; i < 12; i++) await Promise.resolve();
		}
	}
}

// Delivers one thing after another, however long each takes, as a connection does.
class Line {
	private clear = 0;
	private readonly world: World;

	constructor(world: World) {
		this.world = world;
	}

	send(run: () => void): void {
		this.clear = Math.max(this.clear, this.world.now + this.world.latency());
		this.world.after(this.clear - this.world.now, run);
	}
}

interface Entry {
	who: string;
	// left is typing left behind, saved by someone else.
	what: "type" | "left" | "restore";
	before: TextNow;
	after: TextNow;
}

class Store {
	text: TextNow;
	log: Entry[] = [];
	turnedDown = 0;
	readsBack = true;
	// EditConflicts.StampText.
	private stamp = 0;
	readonly at = () => ++this.stamp;

	constructor(text: TextNow) {
		this.text = text;
	}

	// EditConflicts.StaleText and TextToStore.
	save(who: string, typed: TextToSave, what: "type" | "left"): { saved: TextNow } | { behind: TextNow } {
		const stale = (was: string, now: string, wanted: string) => wanted !== was && was !== now && wanted !== now;
		if (stale(typed.wasLabel, this.text.label, typed.label) || stale(typed.wasNotes, this.text.notes, typed.notes)) {
			this.turnedDown++;
			return { behind: this.text };
		}
		this.set(who, what, {
			label: typed.label === typed.wasLabel ? this.text.label : typed.label,
			notes: typed.notes === typed.wasNotes ? this.text.notes : typed.notes,
		});
		return { saved: this.text };
	}

	set(who: string, what: Entry["what"], after: TextNow): void {
		if (after.label !== this.text.label || after.notes !== this.text.notes) this.log.push({ who, what, before: this.text, after });
		this.text = after;
	}
}

class Hub {
	private doc: { instanceId: string; updates: Uint8Array[]; editors: Set<Person> } | null = null;
	private instances = 0;
	readonly people = new Set<Person>();

	open(person: Person, seed: Uint8Array): DocState {
		const seedIt = !this.doc;
		this.doc ??= { instanceId: `i${this.instances++}`, updates: [seed], editors: new Set() };
		this.doc.editors.add(person);
		return { instanceId: this.doc.instanceId, seeded: seedIt, updates: [...this.doc.updates], editors: [] };
	}

	update(from: Person, update: Uint8Array): void {
		if (!this.doc?.editors.has(from)) return;
		this.doc.updates.push(update);
		for (const person of this.doc.editors) if (person !== from) person.down.send(() => person.form?.fields.receive(update));
	}

	close(person: Person): void {
		this.doc?.editors.delete(person);
		if (this.doc?.editors.size === 0) this.doc = null;
	}

	op(from: Person, text: Partial<TextNow>, when: When): void {
		const { op, when: told } = takeWhen({ kind: "update", entity: "annotation", id: "row", data: withWhen(text, when) });
		for (const person of this.people) if (person !== from) person.down.send(() => person.heard(op.data as Partial<TextNow>, told));
	}

	leads(person: Person): boolean {
		return !this.doc || [...this.doc.editors].every((editor) => editor.name >= person.name);
	}

	alone(person: Person): boolean {
		return !this.doc || [...this.doc.editors].every((editor) => editor === person);
	}
}

// What useSharedText does.
class Form {
	readonly fields: SharedFields<TextField>;
	readonly edit: TextEdit;
	readonly saves: TextSaves;
	private readonly person: Person;
	private readonly stop: () => void;

	constructor(person: Person) {
		const { world, hub, stored, shown } = person;
		this.person = person;
		this.fields = new SharedFields<TextField>(TEXT_FIELDS, shown);
		this.edit = new TextEdit(shown, stored.sinceNow(), stored.ats("row"));
		this.saves = new TextSaves(
			this.edit,
			(options) => {
				void person.save(this.edit, options).then((turnedDown) => {
					if (turnedDown && person.form === this) this.saves.storedChanged();
				});
			},
			() => {
				if (!hub.leads(person)) return;
				for (const [field, text] of Object.entries(this.edit.putRight(hub.alone(person)))) this.fields.put(field as TextField, text);
			},
			world.clock,
		);
		this.fields.subscribe((change) => {
			this.edit.changed(change.field, change);
			this.saves.changed(change);
		});
		for (const field of TEXT_FIELDS) this.edit.opened(field, this.fields.chars(field));
		this.stop = stored.subscribe("row", (text, when) => {
			this.edit.storedNow(text, when);
			this.saves.storedChanged();
		});
		void this.fields.connect(person.transport());
	}

	close(): void {
		const alone = this.person.hub.alone(this.person);
		this.fields.dispose();
		this.person.up.send(() => this.person.hub.close(this.person));
		this.stop();
		this.saves.close(alone);
		this.person.form = null;
	}
}

class Person {
	form: Form | null = null;
	gone = false;
	// Every character they've typed, and taken out, themselves.
	readonly typed = new Set<string>();
	readonly took = new Set<string>();
	readonly stored = new StoredText();
	shown: TextNow;
	readonly up: Line;
	readonly down: Line;
	readonly name: string;
	readonly world: World;
	readonly hub: Hub;
	readonly store: Store;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(name: string, world: World, hub: Hub, store: Store) {
		this.name = name;
		this.world = world;
		this.hub = hub;
		this.store = store;
		this.shown = store.text;
		this.up = new Line(world);
		this.down = new Line(world);
		hub.people.add(this);
	}

	transport() {
		return {
			open: (seed: Uint8Array) =>
				new Promise<DocState>((resolve) => {
					this.up.send(() => {
						const state = this.hub.open(this, seed);
						this.down.send(() => resolve(state));
					});
				}),
			send: (update: Uint8Array) =>
				this.up.send(() => {
					if (!this.gone) this.hub.update(this, update);
				}),
		};
	}

	heard(text: Partial<TextNow>, when: When): void {
		const [{ id: _, ...fresh }] = this.stored.remember([{ id: "row", ...text }], when);
		this.shown = { ...this.shown, ...fresh };
	}

	// What the contexts' updateAnnotation does. A request and its answer, neither
	// in step with the hub.
	save(edit: TextEdit, options: SaveOptions): Promise<boolean> {
		let turnedDown = false;
		const { label, notes } = edit.next(options.everyones);
		this.shown = { label, notes };
		const run = () =>
			saveText(edit, options, async (typed, typedIds) => {
				if (this.gone) return { refused: true } as const;
				await this.world.wait();
				const answer = this.store.save(this.name, typed, options.everyones ? "left" : "type");
				const at = this.store.at();
				await this.world.wait();
				if ("behind" in answer) {
					turnedDown = true;
					this.heard(answer.behind, { at });
					return { ...answer, at };
				}
				// A count's answer only has what was changed.
				const now = this.store.readsBack ? answer.saved : whatChanged(typed);
				const when = { at, ids: idsOf(now, typed, typedIds) };
				this.heard(now, when);
				this.up.send(() => {
					if (!this.gone) this.hub.op(this, now, when);
				});
				return { saved: null, now, at };
			});
		const next = this.queue.then(run);
		this.queue = next;
		return next.then(() => turnedDown);
	}

	// Typed with a caret, which stays with the character before it.
	readonly keys: string[] = [];
	private caret = "";
	readonly typing = (before: boolean): void => {
		const shown = this.form!.fields.chars("notes").filter((char) => !char.gone);
		this.caret = before || shown.length === 0 ? "" : shown[shown.length - 1].id;
	};

	key(ch: string): void {
		const { fields } = this.form!;
		let at = 0;
		for (const { id, gone } of fields.chars("notes")) {
			if (!gone) at++;
			if (id === this.caret) break;
		}
		if (!this.caret) at = 0;
		const text = fields.get("notes");
		if (text.length >= 250) return;
		fields.set("notes", text.slice(0, at) + ch + text.slice(at), at + 1);
		this.keys.push(ch);
		this.caret = fields.chars("notes").filter((char) => !char.gone)[at].id;
	}

	type(field: TextField): void {
		const { fields } = this.form!;
		const text = fields.get(field);
		const { random } = this.world;
		const at = Math.floor(random() * (text.length + 1));
		if (random() < 0.25 && text.length > 0) {
			const from = Math.min(at, text.length - 1);
			const count = Math.min(1 + Math.floor(random() * 3), text.length - from);
			for (const ch of text.slice(from, from + count)) this.took.add(ch);
			fields.set(field, text.slice(0, from) + text.slice(from + count));
		} else if (text.length < 40) {
			let word = "";
			for (let left = 1 + Math.floor(random() * 4); left > 0; left--) word += this.world.newChar();
			for (const ch of word) this.typed.add(ch);
			fields.set(field, text.slice(0, at) + word + text.slice(at));
		}
	}

	// Crashed: whatever's on its way arrives, and nothing else does.
	vanish(): void {
		this.gone = true;
		this.form?.saves.cancel();
		this.form?.fields.dispose();
		this.form = null;
		this.hub.people.delete(this);
		this.hub.close(this);
	}

	// What useRestoreChangeSet and useGoBackItem do.
	async putBack(text: TextNow): Promise<void> {
		await this.world.wait();
		const was = this.store.text;
		this.store.set(this.name, "restore", text);
		const at = this.store.at();
		await this.world.wait();
		const [back] = textToPut("annotation", [{ id: "row", ...text }], [{ id: "row", ...was }]);
		this.heard(text, { at, putBack: true });
		const openFields = new Map<string, OpenFields>();
		const form = this.form;
		if (form) openFields.set("annotation:row", { put: (field, value, before) => form.fields.put(field as TextField, value, before) });
		const { open, send } = this.transport();
		await putInDoc(
			{
				openDoc: (_, seed) => open(seed),
				sendDocUpdate: (_, update) => send(update),
				closeDoc: () => this.up.send(() => this.hub.close(this)),
				openFields,
			},
			back,
		);
		this.up.send(() => this.hub.op(this, text, { at, putBack: true }));
	}
}

// Every entry adds only what its own person typed, and takes out only what
// they did. A restore isn't typing.
function expectOwnTyping(store: Store, people: Person[]): void {
	for (const { who, what, before, after } of store.log) {
		if (what !== "type") continue;
		const { typed, took } = people.find((person) => person.name === who)!;
		for (const field of TEXT_FIELDS) {
			const added = [...after[field]].filter((ch) => !before[field].includes(ch) && !typed.has(ch));
			const gone = [...before[field]].filter((ch) => !after[field].includes(ch) && !took.has(ch));
			if (added.length) throw new Error(`${who} saved "${added.join("")}": ${JSON.stringify([field, before, after])}`);
			if (gone.length) throw new Error(`${who} took out "${gone.join("")}": ${JSON.stringify([field, before, after])}`);
		}
	}
}

function typingFor(world: World, people: Person[], ms: number): void {
	for (const person of people) {
		let at = world.random() * 400;
		while (at < ms) {
			const field: TextField = world.random() < 0.7 ? "notes" : "label";
			world.after(at, () => {
				if (person.form) person.type(field);
			});
			// Mostly a run of keys, now and then a pause long enough to save.
			at += world.random() < 0.8 ? 60 + world.random() * 250 : 1200 + world.random() * 2500;
		}
	}
}

function setUp(seed: number, names: string[], text: TextNow = { label: "first", notes: "" }) {
	const world = new World(seed);
	numbers.random = seeded(seed + 1000);
	const store = new Store(text);
	const hub = new Hub();
	const people = names.map((name) => new Person(name, world, hub, store));
	return { world, store, hub, people };
}

// A few each time, so it's quick. VITE_TYPING_SEEDS=400 for a proper look.
const SEEDS = Array.from({ length: Number(import.meta.env.VITE_TYPING_SEEDS ?? 8) }, (_, i) => i + 1);
const TIMEOUT = SEEDS.length > 8 ? 600_000 : 20_000;

async function eachSeed(run: (seed: number) => Promise<void>): Promise<void> {
	const wrong: string[] = [];
	for (const seed of SEEDS) {
		try {
			await run(seed);
		} catch (error) {
			wrong.push(`seed ${seed}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (wrong.length) throw new Error(`${wrong.length} of ${SEEDS.length} seeds\n${wrong.slice(0, 5).join("\n")}`);
}

// Everyone's box says what's stored, and nobody has anything left to save.
function expectInStep(store: Store, people: Person[]): void {
	for (const { name, form } of people) {
		for (const field of TEXT_FIELDS) {
			const shown = form!.fields.get(field).trim();
			const now = store.text[field].trim();
			if (shown === now) continue;
			// Can't be saved empty, so the last one's kept.
			if (field === "label" && !shown) continue;
			throw new Error(`${name}'s ${field} says ${JSON.stringify(shown)}, and what's stored is ${JSON.stringify(now)}`);
		}
		if (form!.edit.hasMore()) throw new Error(`${name} has ${JSON.stringify(form!.edit.next())} to save`);
	}
}

describe("people typing in the same form", { timeout: TIMEOUT }, () => {
	it("saves everyone's own typing, and they all end up with what's stored", async () => {
		let turnedDown = 0;
		let entries = 0;
		await eachSeed(async (seed) => {
			const { world, store, people } = setUp(seed, ["A", "B", "C"].slice(0, 2 + (seed % 2)));
			store.readsBack = seed % 5 !== 0;
			for (const person of people) world.after(world.random() * 300, () => (person.form = new Form(person)));
			world.after(2500, () => typingFor(world, people, 20_000));
			await world.run();

			expectOwnTyping(store, people);
			expectInStep(store, people);
			turnedDown += store.turnedDown;
			entries += store.log.length;
		});
		// It's no test of saves crossing unless they do.
		expect(turnedDown).toBeGreaterThan(SEEDS.length);
		expect(entries).toBeGreaterThan(SEEDS.length * 4);
	});

	it("does when they open and close it as they go", async () => {
		await eachSeed(async (seed) => {
			const { world, store, people } = setUp(seed, ["A", "B", "C"]);
			for (const person of people) {
				let at = world.random() * 300;
				while (at < 15_000) {
					world.after(at, () => person.form?.close());
					world.after(at + 700 + world.random() * 500, () => {
						person.form ??= new Form(person);
					});
					at += 4000 + world.random() * 6000;
				}
			}
			world.after(1500, () => typingFor(world, people, 14_000));
			await world.run();
			expectOwnTyping(store, people);
		});
	});

	// Sentences, so letters repeat and whose each one is has to be worked out. No
	// one saves more of any letter than they typed.
	it("knows whose words are whose when two people write in the same box", async () => {
		const sentences = ["Alice thinks invasive. ", "Bob agrees. ", "Seen at the margin, so check again. ", "It is the same as the one on the left. "];
		await eachSeed(async (seed) => {
			const { world, store, people } = setUp(seed, ["A", "B", "C"].slice(0, 2 + (seed % 2)));
			for (const person of people) world.after(world.random() * 300, () => (person.form = new Form(person)));
			for (const person of people) {
				let at = 2500 + world.random() * 3000;
				for (let i = 0; i < 2; i++) {
					// After everything that's there, or before it.
					const before = world.random() < 0.3;
					const { typing } = person;
					world.after(at, () => typing(before));
					for (const ch of sentences[Math.floor(world.random() * sentences.length)]) {
						world.after(at, () => person.key(ch));
						at += 30 + world.random() * 160;
					}
					at += world.random() * 3000;
				}
			}
			await world.run();
			expectInStep(store, people);

			for (const person of people) {
				const more = new Map<string, number>();
				for (const { who, what, before, after } of store.log) {
					if (what === "restore" || who !== person.name) continue;
					for (const ch of new Set(after.notes)) {
						const added = after.notes.split(ch).length - before.notes.split(ch).length;
						if (added > 0) more.set(ch, (more.get(ch) ?? 0) + added);
					}
				}
				for (const [ch, count] of more) {
					const typed = person.keys.filter((key) => key === ch).length;
					if (count > typed) throw new Error(`${person.name} saved ${count} of "${ch}", having typed ${typed}: ${JSON.stringify(store.log.map((e) => [e.who, e.after.notes]))}`);
				}
			}
		});
	});

	// Whose a repeated letter is can be a guess, but not what the box says.
	it("still all ends up the same when everyone types the same letters", async () => {
		await eachSeed(async (seed) => {
			const { world, store, people } = setUp(seed, ["A", "B", "C"].slice(0, 2 + (seed % 2)));
			world.letters = "etaoin shrdlu";
			for (const person of people) world.after(world.random() * 300, () => (person.form = new Form(person)));
			world.after(2500, () => typingFor(world, people, 20_000));
			await world.run();
			expectInStep(store, people);
		});
	});

	// The gap: theirs used to come back on their next pause.
	it("never brings back old text after someone puts an old version back", async () => {
		await eachSeed(async (seed) => {
			const { world, store, people } = setUp(seed, ["A", "B"], { label: "ab", notes: "cdefg" });
			const [a, b] = people;
			const other = new Person("R", world, a.hub, store);
			a.form = new Form(a);
			b.form = new Form(b);
			world.after(2500, () => typingFor(world, people, 8000));
			// Sometimes it's one of them, with their own form open, and sometimes
			// they're mid word.
			const who = seed % 3 === 0 ? a : other;
			world.after(4000 + world.random() * 7000, () => void who.putBack({ label: "qr", notes: "wxyz" }));
			await world.run();

			const putBack = store.log.findIndex((entry) => entry.what === "restore");
			expect(putBack).toBeGreaterThanOrEqual(0);
			expectOwnTyping(store, people);
			for (const { after } of store.log.slice(putBack)) expect(after.label + after.notes).not.toMatch(/[a-g]/);
			expectInStep(store, people);
		});
	});

	it("shows a put back in a form that's just open", async () => {
		const { world, store, people } = setUp(1, ["A"], { label: "old", notes: "older" });
		const [a] = people;
		const other = new Person("R", world, a.hub, store);
		a.form = new Form(a);
		world.after(2000, () => void other.putBack({ label: "put back", notes: "" }));
		await world.run();
		expect(a.form.fields.values()).toEqual({ label: "put back", notes: "" });
		expect(store.text).toEqual({ label: "put back", notes: "" });
		expect(store.log).toHaveLength(1);
	});

	// Whoever put it back went before they could put it in the box.
	it("puts an old box right once you type in it, if you're alone", async () => {
		const { world, store, people } = setUp(1, ["A"], { label: "old words", notes: "" });
		const [a] = people;
		a.form = new Form(a);
		world.after(1000, () => store.set("R", "restore", { label: "new", notes: "" }));
		world.after(2000, () => a.form!.fields.set("label", "old words!"));
		await world.run();
		expect(store.text.label).toBe("new!");
		expect(a.form.fields.get("label")).toBe("new!");
	});

	it("loses nobody's typing when they vanish, and says who saved it", async () => {
		const { world, store, people } = setUp(1, ["A", "B"]);
		const [a, b] = people;
		a.form = new Form(a);
		b.form = new Form(b);
		world.after(3000, () => a.form!.fields.set("notes", "AAA"));
		world.after(3900, () => a.vanish());
		await world.run();
		expect(store.text.notes).toBe("AAA");
		expect(store.log.map((entry) => entry.who)).toEqual(["B"]);
	});

	it("saves what they left when you're the last one to close it", async () => {
		const { world, store, people } = setUp(1, ["A", "B"]);
		const [a, b] = people;
		a.form = new Form(a);
		b.form = new Form(b);
		world.after(3000, () => a.form!.fields.set("notes", "AAA"));
		world.after(3900, () => a.vanish());
		world.after(5000, () => b.form!.close());
		await world.run();
		expect(store.text.notes).toBe("AAA");
	});

	it("saves nothing for a form that's only been looked at", async () => {
		const { world, store, people } = setUp(3, ["A", "B"]);
		const [a, b] = people;
		a.form = new Form(a);
		b.form = new Form(b);
		world.after(2500, () => typingFor(world, [a], 9000));
		world.after(30_000, () => b.form!.close());
		await world.run();
		expect(store.log.length).toBeGreaterThan(1);
		expect(new Set(store.log.map((entry) => entry.who))).toEqual(new Set(["A"]));
	});
});
