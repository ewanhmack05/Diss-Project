import * as Y from "yjs";
import type { DocState } from "./realtime";
import { sameEdit, type Splice } from "./textMerge";

// A handful of named text fields (an annotation's label and notes) that
// several people can type into at once. Each field is a Y.Text, so edits
// merge character by character instead of the last save winning. The hub
// only relays and keeps the raw updates - see realtime-hub/README.md.

type Delta = Y.YTextEvent["delta"];

// One character of a box, or one that's been taken out of it (gone). The id
// stays with it wherever it ends up, and is the same for everyone.
interface BoxChar {
	id: string;
	ch: string;
	gone: boolean;
}

interface FieldChange<F extends string> {
	field: F;
	// Not typed by whoever's box this is.
	remote: boolean;
	// Not typed by anyone - an old version put back (see put).
	put: boolean;
	// What's in the box now, and what was.
	chars: BoxChar[];
	// What changed, for moving the caret. Null when the whole field was
	// swapped out, e.g. after adopting the hub's copy.
	delta: Delta | null;
}

interface DocTransport {
	// Null when it couldn't be opened (not connected).
	open: (seed: Uint8Array) => Promise<DocState | null>;
	send: (update: Uint8Array) => void;
}

// Marks updates that came from the hub, so they aren't sent back.
const REMOTE = Symbol("remote");
// Text put in by us but not typed by anyone here - an old version put back.
const PUT = Symbol("put");
// In the doc, counting those, so everyone else can tell too.
const PUTS = "puts";

// The smallest single splice that turns `from` into `to`. Typing, pasting
// and deleting a selection are all one splice, which is all an input event
// can do. caret is where it was left, which settles which of two spaces is the
// new one.
function textDiff(from: string, to: string, caret?: number): Splice {
	const max = Math.min(from.length, to.length);
	let end = caret !== undefined && caret <= to.length && from.endsWith(to.slice(caret)) ? to.length - caret : 0;
	let start = 0;
	while (start < max - end && from[start] === to[start]) start++;
	while (end < max - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++;
	return { index: start, remove: from.length - start - end, insert: to.slice(start, to.length - end) };
}

// Where a caret at `index` ends up after someone else's change. Text they
// insert exactly at the caret goes after it, so your next keystroke still
// lands where you were typing.
function transformIndex(index: number, delta: Delta): number {
	let oldPos = 0;
	let result = index;
	for (const op of delta) {
		if (oldPos > index) break;
		if (op.retain !== undefined) {
			oldPos += op.retain;
		} else if (op.insert !== undefined) {
			if (oldPos < index) result += typeof op.insert === "string" ? op.insert.length : 1;
		} else if (op.delete !== undefined) {
			if (oldPos < index) result -= Math.min(op.delete, index - oldPos);
			oldPos += op.delete;
		}
	}
	return result;
}

class SharedFields<F extends string> {
	private doc: Y.Doc;
	private readonly fields: readonly F[];
	private readonly listeners = new Set<(change: FieldChange<F>) => void>();
	private unbind: () => void;
	private transport: DocTransport | null = null;
	// Which copy of the doc on the hub our history came from. A new one is
	// made each time the doc is dropped and re-seeded, and histories from two
	// different copies can't be merged - the seed text would appear twice.
	private instanceId: string | null = null;
	// Fields typed in while not synced, so they can be put back on top of
	// the hub's copy if we have to adopt it.
	private readonly dirty = new Set<F>();
	// Whether anything's been changed meanwhile, typed or not.
	private unsent = false;
	// What each said when it was last in step, for working out what was typed.
	private inStep: Record<F, string>;
	// Updates that arrive while the open call is in flight.
	private buffered: Uint8Array[] | null = null;
	private generation = 0;
	private disposed = false;

	constructor(fields: readonly F[], initial: Record<F, string>) {
		this.fields = fields;
		this.doc = new Y.Doc();
		this.doc.transact(() => {
			for (const field of fields) this.doc.getText(field).insert(0, initial[field]);
		}, REMOTE);
		this.unbind = this.bind(this.doc);
		this.inStep = this.values();
	}

	get(field: F): string {
		return this.doc.getText(field).toString();
	}

	// Yjs keeps the ones taken out, in their place, without what they said.
	chars(field: F): BoxChar[] {
		const chars: BoxChar[] = [];
		for (let item = this.doc.getText(field)._start; item; item = item.right) {
			const { client, clock } = item.id;
			const text = item.content instanceof Y.ContentString ? item.content.str : "";
			for (let i = 0; i < item.length; i++) chars.push({ id: `${client}:${clock + i}`, ch: text[i] ?? "", gone: item.deleted });
		}
		return chars;
	}

	values(): Record<F, string> {
		return Object.fromEntries(this.fields.map((field) => [field, this.get(field)])) as Record<F, string>;
	}

	set(field: F, value: string, caret?: number): void {
		const splice = textDiff(this.get(field), value, caret);
		if (splice.remove || splice.insert) this.splice(field, [splice]);
	}

	// For everyone with it open, as if it came from someone else. Where it said
	// was, so anything typed since stays.
	put(field: F, value: string, was = this.get(field)): void {
		this.splice(field, sameEdit(was, value, this.get(field)), PUT);
	}

	private splice(field: F, splices: Splice[], origin?: symbol): void {
		if (splices.length === 0) return;
		const text = this.doc.getText(field);
		this.doc.transact(() => {
			for (const { index, remove, insert } of splices) {
				if (remove) text.delete(index, remove);
				if (insert) text.insert(index, insert);
			}
			if (origin !== PUT) return;
			const puts = this.doc.getMap<number>(PUTS);
			puts.set(field, (puts.get(field) ?? 0) + 1);
		}, origin);
	}

	subscribe(listener: (change: FieldChange<F>) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	// Joins the shared copy. Safe to call again after a reconnect - whatever
	// was typed while offline is merged back in.
	async connect(transport: DocTransport): Promise<DocState | null> {
		if (this.transport) this.inStep = this.values();
		const generation = ++this.generation;
		this.transport = null;
		this.buffered = [];
		let state: DocState | null;
		try {
			state = await transport.open(Y.encodeStateAsUpdate(this.doc));
		} catch {
			state = null;
		}
		if (this.disposed || generation !== this.generation) return null;
		const buffered = this.buffered;
		this.buffered = null;
		if (!state) return null;

		if (state.seeded) {
			// The hub's copy is our doc as it was when we asked. Anything typed
			// since then still needs sending.
			this.instanceId = state.instanceId;
			this.transport = transport;
			if (this.unsent) transport.send(Y.encodeStateAsUpdate(this.doc));
		} else if (state.instanceId === this.instanceId) {
			// Same history, so a plain merge both ways. Our full state goes up in
			// case something we sent was lost when the connection dropped.
			this.applyRemote(state.updates);
			this.transport = transport;
			transport.send(Y.encodeStateAsUpdate(this.doc));
		} else {
			this.adopt(state, transport);
		}
		this.applyRemote(buffered);
		this.dirty.clear();
		this.unsent = false;
		return state;
	}

	// Stops sending. Edits carry on locally until the next connect.
	disconnect(): void {
		if (this.transport) this.inStep = this.values();
		this.generation++;
		this.transport = null;
		this.buffered = null;
	}

	receive(update: Uint8Array): void {
		if (this.buffered) this.buffered.push(update);
		else if (this.transport) Y.applyUpdate(this.doc, update, REMOTE);
	}

	dispose(): void {
		this.disposed = true;
		this.disconnect();
		this.unbind();
		this.doc.destroy();
		this.listeners.clear();
	}

	// Someone else already has the doc open with a history we don't share.
	// Take theirs, then redo whatever we typed on our own copy as edits on
	// top, so it reaches them without doubling the text. Fields we didn't
	// touch just take their version, including their unsaved typing.
	private adopt(state: DocState, transport: DocTransport): void {
		const mine = this.values();
		const next = new Y.Doc();
		for (const update of state.updates) Y.applyUpdate(next, update, REMOTE);

		this.unbind();
		this.doc.destroy();
		this.doc = next;
		this.unbind = this.bind(next);
		this.instanceId = state.instanceId;
		this.transport = transport;

		for (const field of this.fields) {
			this.emit({ field, remote: true, put: false, chars: this.chars(field), delta: null });
			if (this.dirty.has(field)) this.splice(field, sameEdit(this.inStep[field], mine[field], this.get(field)));
		}
	}

	private applyRemote(updates: Uint8Array[]): void {
		for (const update of updates) Y.applyUpdate(this.doc, update, REMOTE);
	}

	private bind(doc: Y.Doc): () => void {
		const onUpdate = (update: Uint8Array, origin: unknown) => {
			if (origin === REMOTE) return;
			if (this.transport) this.transport.send(update);
		};
		doc.on("update", onUpdate);

		const puts = doc.getMap(PUTS) as Y.AbstractType<unknown>;
		const observers = this.fields.map((field) => {
			const text = doc.getText(field);
			const observer = (event: Y.YTextEvent) => {
				const { origin } = event.transaction;
				if (origin !== REMOTE && !this.transport) {
					this.unsent = true;
					if (origin !== PUT) this.dirty.add(field);
				}
				this.emit({
					field,
					remote: origin === REMOTE || origin === PUT,
					put: event.transaction.changed.has(puts as never),
					chars: this.chars(field),
					delta: event.delta,
				});
			};
			text.observe(observer);
			return () => text.unobserve(observer);
		});

		return () => {
			doc.off("update", onUpdate);
			observers.forEach((off) => off());
		};
	}

	private emit(change: FieldChange<F>): void {
		this.listeners.forEach((listener) => listener(change));
	}
}

export { SharedFields, textDiff, transformIndex };
export type { BoxChar, FieldChange, DocTransport };
