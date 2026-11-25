import type { BoxChar, FieldChange } from "./sharedFields";
import { LABEL_MAX, NOTES_MAX } from "./autosave";

// Which of a label or notes box is yours. Everyone with the form open sees the
// same text (see useSharedFields), but each saves only what they typed
// themselves, so the history says who wrote what: the stored text, with their
// own typing in it and nobody else's that isn't stored yet. Theirs follows in
// their own save.
//
// That only works if a save never takes out one it hasn't seen. So each says
// what it started from, and annotation-store turns down one that's behind
// (EditConflicts.StaleText). The typing's then worked out again from what's
// there now, and saved on top of it.
//
// Which characters are stored comes from whoever saved them: they say which
// ones their text was made of (TextIds). When nobody says - an old version put
// back, someone who saved and went - it's worked out from what it spells.

type Who = "mine" | "theirs";
// nobody is an old version put back, or a whole box swapped for someone else's
// copy of it on joining. What that puts in is for whoever typed it to save, and
// what it takes out isn't for anyone to.
type Editor = Who | "nobody";

// stored - in annotation-store, as far as we know.
// mine, theirs - typed since, and not saved yet.
// lost - in the box, and it was stored but isn't any more, or was put back.
// found - already in the box when we got it, and not stored. For whoever typed it.
type By = "stored" | Who | "lost" | "found";

// Who's taken it out of the box. unseen is stored, and hasn't got to the box yet.
type Gone = null | Editor | "unseen";

interface Char {
	// BoxChar's, or empty for one we only know by what it spells.
	id: string;
	ch: string;
	by: By;
	gone: Gone;
	// In a save of ours that's still on its way.
	sent?: boolean;
	// Typed and taken out by other people. Only kept for where it was, as it can
	// be stored in between.
	passing?: boolean;
}

// How good a match each is when working out which of these a stored text is.
// Anything in the box beats what isn't, and what's known to be stored beats
// the rest.
function weight({ by, gone, passing }: Char): number {
	if (gone === "unseen" || gone === "nobody") return 1;
	if (passing) return 2;
	if (by === "stored") return gone ? 6 : 7;
	if (gone) return 2;
	return by === "theirs" ? 5 : by === "mine" ? 3 : 4;
}

// Plenty for a box this size, and it can't be typed in for ever.
const MOST_PASSING = 300;

const BROKEN_PAIR = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

class OwnText {
	private chars: Char[];
	private started = false;

	constructor(stored: string) {
		this.chars = [...units(stored)].map((ch) => ({ id: "", ch, by: "stored", gone: null }));
	}

	private text(keep: (char: Char) => boolean): string {
		return this.chars.reduce((text, char) => (keep(char) ? text + char.ch : text), "");
	}

	get stored(): string {
		return this.text((c) => c.by === "stored");
	}

	// What's in the box.
	get live(): string {
		return this.text((c) => c.gone === null);
	}

	// The stored text with your own typing in it. What they've taken out stays
	// until they save that.
	get mine(): string {
		return this.text(isMine);
	}

	// Everyone's typing, and nothing that isn't anyone's.
	get merged(): string {
		return this.text(isAnyones);
	}

	// What to save, and which characters it's made of.
	toSave(max: number, everyones: boolean): { text: string; ids: string[] } {
		let chars = this.chars.filter(everyones ? isAnyones : isMine);
		const spells = () => chars.map((c) => c.ch).join("");
		// Merged text can run past the inputs' own maxLength, and half of a pair
		// can't be sent - then it's everyone's, which is what the box says.
		if (spells().trim().length > max || BROKEN_PAIR.test(spells())) chars = this.chars.filter(isAnyones);
		// Only a space at either end of what's stored isn't worth a save.
		const { stored } = this;
		if (spells().trim().slice(0, max) === stored.trim()) return this.asStored;
		const start = spells().length - spells().trimStart().length;
		chars = chars.slice(start, start + Math.min(spells().trim().length, max));
		return { text: spells(), ids: chars.map((c) => c.id) };
	}

	// What the box should say. Someone else can still be about to save what we
	// found there.
	right(alone: boolean): string {
		return alone ? this.merged : this.text((c) => c.by !== "lost" && isShown(c));
	}

	// They've typed something, or taken out something stored, that they haven't
	// saved.
	get theirsUnsaved(): boolean {
		return this.chars.some((c) => (c.by === "theirs" && c.gone === null) || (c.by === "stored" && c.gone === "theirs"));
	}

	// The box isn't what's stored and nobody's typing accounts for it.
	get outOfStep(): boolean {
		return this.chars.some((c) => c.gone === "unseen" || c.gone === "nobody" || (c.by === "lost" && c.gone === null));
	}

	// The whole box, swapped for someone else's copy of it - or the first there
	// is of it.
	swap(chars: BoxChar[]): void {
		const { stored } = this;
		this.started = true;
		this.chars = chars.filter((c) => !c.gone).map(({ id, ch }) => ({ id, ch, by: "found", gone: null }));
		this.rebase(stored);
	}

	edit(chars: BoxChar[], who: Editor): void {
		if (!this.started) {
			this.swap(chars);
			return;
		}
		const inBox = new Set(chars.map((c) => c.id));
		const known = new Map<string, Char>();
		// The ones that have never been in the box, by what they come after.
		const between = new Map<string, Char[]>([["", []]]);
		let after = "";
		for (const char of this.chars) {
			if (inBox.has(char.id)) {
				known.set((after = char.id), char);
				between.set(after, []);
			} else between.get(after)!.push(char);
		}

		this.chars = [...between.get("")!];
		for (const { id, ch, gone } of chars) {
			const char = known.get(id);
			// Stored before it got here, and if it's gone already it's theirs to
			// save that.
			if (char?.gone === "unseen") {
				this.chars.push({ ...char, gone: gone ? "theirs" : null });
				this.chars.push(...(between.get(id) ?? []));
				continue;
			}
			// Yjs mends half a pair, in place.
			const swapped = !gone && char && char.ch !== ch;
			if (char && char.gone === null && (gone || swapped)) {
				const left = takenOut(char, who);
				if (left) this.chars.push(swapped ? { ...left, id: "" } : left);
			} else if (char) this.chars.push(char);
			if (!gone && (!char || swapped)) this.chars.push({ id, ch, by: who === "nobody" ? "lost" : who, gone: null });
			this.chars.push(...(between.get(id) ?? []));
		}
		if (this.chars.filter(isPassing).length > MOST_PASSING) this.chars = this.chars.filter((c) => !isPassing(c));
		// What's just come in may be what was stored before we'd seen it.
		if (this.chars.some((c) => c.gone === "nobody" || (c.gone === "unseen" && !c.id))) {
			const ids = this.chars.filter((c) => c.by === "stored").map((c) => (c.gone === "nobody" ? "" : c.id));
			this.rebase(this.stored, { putBack: true, ids });
		}
	}

	get asStored(): { text: string; ids: string[] } {
		return { text: this.stored, ids: this.storedIds };
	}

	private get storedIds(): string[] {
		return this.chars.filter((c) => c.by === "stored").map((c) => c.id);
	}

	// What's in annotation-store now, whoever put it there. What you've typed
	// stays yours and unsaved unless it's in there, and the box doesn't change.
	// putBack is an old version, so it's nobody's typing from just now. It can be
	// in the box already, or have been and been taken out. ids is which characters
	// it's made of, from whoever saved it.
	rebase(stored: string, { putBack = false, ids }: { putBack?: boolean; ids?: string[] } = {}): void {
		const chars = this.chars.filter((c) => !putBack || c.gone === null || (c.by !== "mine" && c.by !== "theirs"));
		const matches = match(chars, stored, ids);
		const known = new Set(this.chars.map((c) => c.id));
		const next: Char[] = [];
		const unseen = () => {
			const id = ids?.[at] ?? "";
			next.push({ id: known.has(id) ? "" : id, ch: stored[at++], by: "stored", gone: "unseen" });
		};
		let at = 0;
		for (const char of this.chars) {
			const found = matches.get(char);
			if (found === undefined) {
				if (char.by !== "stored") next.push(char);
				else if (char.gone === null) next.push({ ...char, by: "lost" });
				continue;
			}
			while (at < found) unseen();
			next.push({ ...char, by: "stored" });
			at++;
		}
		while (at < stored.length) unseen();
		this.chars = next;
	}

	// Typing you take out while it's being saved needs taking out again after,
	// so it's kept track of till the save's back.
	sending(): void {
		this.chars = this.chars.map((c) => (isMine(c) ? { ...c, sent: true } : c));
	}

	sentBack(): void {
		this.chars = this.chars.filter((c) => c.by !== "mine" || c.gone !== "mine").map((c) => ({ ...c, sent: false }));
	}
}

function isShown({ gone }: Char): boolean {
	return gone === null || gone === "unseen" || gone === "nobody";
}

function isAnyones(char: Char): boolean {
	return char.by !== "lost" && char.by !== "found" && isShown(char);
}

function isMine({ by, gone }: Char): boolean {
	return (by === "stored" || by === "mine") && gone !== "mine";
}

// Taken out of the box. Null if there's nothing more to know about it.
function takenOut(char: Char, who: Editor): Char | null {
	const { by } = char;
	if (who === "nobody") return by === "stored" ? { ...char, gone: who } : null;
	if (by === "stored") return { ...char, gone: who };
	if (by === "mine") return who === "theirs" || char.sent ? { ...char, gone: who } : null;
	// Theirs, or anyone's: once it's stored it's whoever took it out's to save.
	return who === "mine" ? { ...char, gone: who } : { ...char, gone: who, passing: true };
}

function isPassing(char: Char): boolean {
	return !!char.passing && char.by !== "stored";
}

// Which of chars each character of it is. Where its id's known that's it, and
// the rest are the most that can be, in order, and the likeliest where there's a
// choice.
function match(chars: Char[], stored: string, ids?: string[]): Map<Char, number> {
	const taken = new Set(ids);
	const score = (char: Char, j: number) => {
		if (char.ch !== stored[j]) return 0;
		if (ids?.[j]) return char.id === ids[j] ? 1_000_000 : 0;
		return char.id && taken.has(char.id) ? 0 : 1000 + weight(char);
	};
	const [rows, columns] = [chars.length, stored.length];
	const best = Array.from({ length: rows + 1 }, () => new Float64Array(columns + 1));
	for (let i = rows - 1; i >= 0; i--) {
		const char = chars[i];
		for (let j = columns - 1; j >= 0; j--) {
			const skip = Math.max(best[i + 1][j], best[i][j + 1]);
			const points = score(char, j);
			best[i][j] = points ? Math.max(skip, points + best[i + 1][j + 1]) : skip;
		}
	}
	const matches = new Map<Char, number>();
	for (let i = 0, j = 0; i < rows && j < columns; ) {
		const char = chars[i];
		const points = score(char, j);
		if (points && best[i][j] === points + best[i + 1][j + 1]) {
			matches.set(char, j++);
			i++;
		} else if (best[i + 1][j] >= best[i][j + 1]) i++;
		else j++;
	}
	return matches;
}

// Split the way Yjs and the boxes count, so half a pair is one.
function* units(text: string): Generator<string> {
	for (let i = 0; i < text.length; i++) yield text[i];
}

interface TextNow {
	label: string;
	notes: string;
}

// Which characters each is made of (see BoxChar).
type TextIds = Record<TextField, string[]>;

// What's known about a text that's stored. at is when the store said so (see
// storedText.ts). putBack is an old version put back.
interface When {
	at?: number;
	putBack?: boolean;
	ids?: Partial<TextIds>;
}

// A save's text, with what each started from. One that's the same as its was
// isn't being changed, so annotation-store leaves it as it is.
interface TextToSave extends TextNow {
	wasLabel: string;
	wasNotes: string;
}

const TEXT_FIELDS = ["label", "notes"] as const;
type TextField = (typeof TEXT_FIELDS)[number];

// How many times a save goes again after being turned down, before waiting for
// more typing. Each one is someone else's save getting in first.
const MOST_TRIES = 8;

// The label and notes of one open form. Outlives the form, as its last save can.
class TextEdit {
	private readonly own: Record<TextField, OwnText>;
	private readonly stillOpen: () => boolean;
	// When each was what's stored, where the store's said (see storedText.ts).
	private readonly ats: Partial<Record<TextField, number>>;

	// stillOpen is false once the whole collection's been put back since - then
	// a save that's behind is dropped, as what it's behind is the old version.
	constructor(stored: TextNow, stillOpen: () => boolean = () => true, ats: Partial<Record<TextField, number>> = {}) {
		this.ats = { ...ats };
		this.own = { label: new OwnText(stored.label), notes: new OwnText(stored.notes) };
		this.stillOpen = stillOpen;
	}

	// The box as it is when the form opens.
	opened(field: TextField, chars: BoxChar[]): void {
		this.own[field].swap(chars);
	}

	changed(field: TextField, { remote, put, delta, chars }: Pick<FieldChange<string>, "remote" | "put" | "delta" | "chars">): void {
		if (!delta) this.own[field].swap(chars);
		else this.own[field].edit(chars, put ? "nobody" : remote ? "theirs" : "mine");
	}

	// everyones takes in their typing too, for when whoever typed it has gone.
	next(everyones = false): TextToSave {
		const { label, notes } = this.parts(everyones);
		return { label: label.text, notes: notes.text, wasLabel: this.own.label.stored, wasNotes: this.own.notes.stored };
	}

	private parts(everyones: boolean) {
		const { label, notes } = this.own;
		const toSave = label.toSave(LABEL_MAX, everyones);
		return {
			// Can't be saved empty, so the last one stays.
			label: toSave.text ? toSave : label.asStored,
			notes: notes.toSave(NOTES_MAX, everyones),
		};
	}

	hasMore(everyones = false): boolean {
		const { label, notes, wasLabel, wasNotes } = this.next(everyones);
		return label !== wasLabel || notes !== wasNotes;
	}

	get theirsUnsaved(): boolean {
		return this.own.label.theirsUnsaved || this.own.notes.theirsUnsaved;
	}

	get outOfStep(): boolean {
		return this.own.label.outOfStep || this.own.notes.outOfStep;
	}

	// What each box should say, where it's out of step with what's stored. alone
	// is nobody else having the form open.
	putRight(alone: boolean): Partial<TextNow> {
		const right: Partial<TextNow> = {};
		for (const field of TEXT_FIELDS) {
			const text = this.own[field].right(alone);
			if (text !== this.own[field].live) right[field] = text;
		}
		return right;
	}

	// Someone's save, or an old version put back - whatever annotation-store has
	// now. at is when that was. One that's no news can still say which characters
	// it is, if we've only had that from the store.
	storedNow(stored: Partial<TextNow>, { at, putBack = false, ids }: When = {}): void {
		for (const field of TEXT_FIELDS) {
			const text = stored[field];
			if (text === undefined) continue;
			const own = this.own[field];
			const old = at !== undefined && at <= (this.ats[field] ?? 0);
			if (old && (text !== own.stored || !ids?.[field])) continue;
			if (at !== undefined && !old) this.ats[field] = at;
			if (text !== own.stored || ids?.[field]) own.rebase(text, { putBack, ids: ids?.[field] });
		}
	}

	// What's being sent, by character.
	sending(everyones = false): TextIds {
		for (const field of TEXT_FIELDS) this.own[field].sending();
		const { label, notes } = this.parts(everyones);
		return { label: label.ids, notes: notes.ids };
	}

	sentBack(): void {
		for (const field of TEXT_FIELDS) this.own[field].sentBack();
	}

	// Turned down. Whether it's worth saving again from there.
	behind(current: TextNow, at?: number): boolean {
		if (!this.stillOpen()) return false;
		this.storedNow(current, { at });
		return true;
	}
}

// now is what's stored, if it isn't just what was sent. refused is turned down
// for something else, and dealt with.
type SaveAnswer<T> = { saved: T; now?: Partial<TextNow>; at?: number } | { behind: TextNow; at?: number } | { refused: true };

interface SaveOptions {
	// Takes in everyone's typing (see TextEdit.next).
	everyones?: boolean;
	// It's more than text, so goes even with none.
	always?: boolean;
	// The form's gone, so it can't wait for anything.
	closing?: boolean;
}

// Saves until it's in, or there's nothing left to save. One that's behind
// someone else's save waits for them to say which characters that was, and the
// form saves again (see TextSaves). send's ids are to tell everyone the same.
async function saveText<T>(
	edit: TextEdit,
	{ everyones = false, always = false, closing = false }: SaveOptions,
	send: (text: TextToSave, ids: TextIds) => Promise<SaveAnswer<T>>,
): Promise<T | null> {
	let waiting = false;
	for (let tries = 0; tries < MOST_TRIES; tries++) {
		const next = edit.next(everyones);
		const text = waiting ? { ...next, label: next.wasLabel, notes: next.wasNotes } : next;
		if (!always && text.label === text.wasLabel && text.notes === text.wasNotes) return null;
		const ids = edit.sending(everyones);
		try {
			const answer = await send(text, ids);
			if ("saved" in answer) {
				const now = answer.now ?? whatChanged(text);
				if (!waiting) edit.storedNow(now, { at: answer.at, ids: idsOf(now, text, ids) });
				return answer.saved;
			}
			if ("refused" in answer || !edit.behind(answer.behind, answer.at)) return null;
			waiting = !closing;
			if (waiting && !always) return null;
		} finally {
			edit.sentBack();
		}
	}
	return null;
}

// Only for what was stored as it was sent.
function idsOf(now: Partial<TextNow>, text: TextNow, ids: TextIds): Partial<TextIds> {
	return Object.fromEntries(TEXT_FIELDS.filter((field) => now[field] === text[field]).map((field) => [field, ids[field]]));
}

// A box that wasn't being changed may be someone else's by now.
function whatChanged({ label, notes, wasLabel, wasNotes }: TextToSave): Partial<TextNow> {
	return { ...(label !== wasLabel ? { label } : {}), ...(notes !== wasNotes ? { notes } : {}) };
}

// A 409's body, if it was for the text.
function readBehind(body: unknown): TextNow | null {
	if (!body || typeof body !== "object" || !("text" in body) || body.text !== true || !("current" in body)) return null;
	const { current } = body;
	if (!current || typeof current !== "object") return null;
	const { label, notes } = current as Partial<TextNow>;
	return { label: label ?? "", notes: notes ?? "" };
}

export { OwnText, TextEdit, saveText, whatChanged, idsOf, readBehind, TEXT_FIELDS };
export type { SaveOptions, TextIds, TextNow, TextToSave, TextField, When };
