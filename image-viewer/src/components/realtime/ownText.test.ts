import { describe, expect, it } from "vitest";
import { OwnText, TEXT_FIELDS, TextEdit, readBehind, saveText, type TextField, type TextNow, type TextToSave } from "./ownText";
import { SharedFields, type BoxChar } from "./sharedFields";

// A box, as SharedFields gives one: every character with an id of its own, and
// the ones taken out kept in their place.
class Box {
	chars: BoxChar[];
	private ids = 0;
	readonly own: OwnText;

	constructor(stored: string, box = stored) {
		this.chars = [...box].map((ch) => this.char(ch));
		this.own = new OwnText(stored);
		this.own.swap(this.chars);
	}

	private char(ch: string): BoxChar {
		return { id: `c${this.ids++}`, ch, gone: false };
	}

	private place(at: number): number {
		let index = 0;
		for (let left = at; left > 0; index++) if (!this.chars[index].gone) left--;
		return index;
	}

	type(at: number, text: string, who: Parameters<OwnText["edit"]>[1] = "mine"): void {
		this.chars = [...this.chars];
		this.chars.splice(this.place(at), 0, ...[...text].map((ch) => this.char(ch)));
		this.own.edit(this.chars, who);
	}

	take(at: number, count: number, who: Parameters<OwnText["edit"]>[1] = "mine"): void {
		let [seen, left] = [0, count];
		this.chars = this.chars.map((char) => {
			if (char.gone || seen++ < at || left === 0) return char;
			left--;
			return { ...char, gone: true };
		});
		this.own.edit(this.chars, who);
	}

	get shown() {
		return [this.own.live, this.own.mine, this.own.stored];
	}
}

describe("OwnText", () => {
	it("saves your typing and not theirs, in the same box", () => {
		const box = new Box("duct");
		box.type(4, " 4");
		box.type(6, " checked", "theirs");
		box.type(0, "a ");
		expect(box.shown).toEqual(["a duct 4 checked", "a duct 4", "duct"]);
	});

	it("keeps yours in place when theirs is in the middle of it", () => {
		const box = new Box("");
		box.type(0, "abcd");
		box.type(2, "XX", "theirs");
		expect(box.shown).toEqual(["abXXcd", "abcd", ""]);
	});

	it("leaves what they've taken out until they save that", () => {
		const box = new Box("one two");
		box.take(3, 4, "theirs");
		box.type(3, "!");
		expect(box.own.live).toBe("one!");
		expect(box.own.mine).toContain(" two");
		box.own.rebase("one");
		expect(box.shown).toEqual(["one!", "one!", "one"]);
	});

	it("has nothing to save for typing taken out again", () => {
		const box = new Box("a");
		box.type(1, "bc");
		box.take(1, 2);
		expect(box.own.mine).toBe(box.own.stored);
	});

	it("takes out their typing once they've saved it, not before", () => {
		const box = new Box("");
		box.type(0, "theirs", "theirs");
		box.take(0, 6);
		expect(box.shown).toEqual(["", "", ""]);
		box.own.rebase("theirs");
		expect(box.shown).toEqual(["", "", "theirs"]);
	});

	it("still has that to do after a save of someone else's", () => {
		const box = new Box("a");
		box.type(1, "X", "theirs");
		box.take(1, 1);
		box.own.rebase("ba");
		box.own.rebase("baX");
		expect(box.own.mine).toBe("ba");
	});

	// Found with two people in the app: "e." of theirs was taken for yours, as
	// that's how yours ended too.
	it("knows whose a letter is when you've both typed the same ones", () => {
		const box = new Box("");
		box.type(0, "invasive. ");
		const ids = box.own.toSave(256, false).ids;
		box.type(10, "agree.", "theirs");
		box.own.rebase("invasive.", { ids });
		expect([box.own.stored, box.own.mine]).toEqual(["invasive.", "invasive. "]);
		expect(box.own.toSave(256, false).text).toBe("invasive.");
	});

	it("knows a save by its characters before they've reached the box", () => {
		const box = new Box("ee");
		const [first, second] = box.chars.map((c) => c.id);
		box.own.rebase("eee", { ids: [first, "new", second] });
		expect([box.own.outOfStep, box.own.mine]).toEqual([true, "eee"]);
		box.chars = [box.chars[0], { id: "new", ch: "e", gone: false }, box.chars[1]];
		box.own.edit(box.chars, "theirs");
		expect([...box.shown, box.own.outOfStep]).toEqual(["eee", "eee", "eee", false]);
		// Or gone again by the time they did.
		box.own.rebase("eeee", { ids: [first, "new", second, "brief"] });
		box.chars = [...box.chars, { id: "brief", ch: "", gone: true }];
		box.own.edit(box.chars, "theirs");
		expect([...box.shown, box.own.theirsUnsaved]).toEqual(["eee", "eeee", "eeee", true]);
	});

	// Typed, paused, and backspaced while the save was on its way.
	it("takes out typing of yours that was already being saved", () => {
		const box = new Box("a");
		box.type(1, "bc");
		box.own.sending();
		box.take(1, 2);
		box.own.rebase("abc");
		box.own.sentBack();
		expect(box.shown).toEqual(["a", "a", "abc"]);
	});

	it("forgets it if that save didn't get in", () => {
		const box = new Box("a");
		box.type(1, "bc");
		box.own.sending();
		box.take(1, 2);
		box.own.sentBack();
		box.own.rebase("a bc");
		expect(box.own.mine).toBe("a bc");
	});

	it("follows their save, and yours is what's left", () => {
		const box = new Box("duct");
		box.type(4, " checked", "theirs");
		box.type(0, "My ");
		box.own.rebase("duct checked");
		expect(box.shown).toEqual(["My duct checked", "My duct checked", "duct checked"]);
	});

	it("takes a save whose answer was lost as saved", () => {
		const box = new Box("a");
		box.type(1, "b");
		box.own.rebase("ab");
		expect(box.own.mine).toBe(box.own.stored);
	});

	it("knows where typing was that's been taken out, when it's stored in between", () => {
		const box = new Box("");
		box.type(0, "X", "theirs");
		box.take(0, 1, "theirs");
		box.type(0, "Y");
		box.own.rebase("X");
		const { mine } = box.own;
		expect([mine, box.own.outOfStep, box.own.theirsUnsaved]).toEqual([mine, false, true]);
		box.own.rebase("");
		expect([box.own.mine, box.own.theirsUnsaved]).toEqual(["Y", false]);
	});

	it("doesn't save old text over what's been put back", () => {
		const box = new Box("not a duct");
		box.own.rebase("duct", { putBack: true });
		expect([box.own.live, box.own.mine]).toEqual(["not a duct", "duct"]);
		expect([box.own.outOfStep, box.own.merged, box.own.theirsUnsaved]).toEqual([true, "duct", false]);
		// Still shown, and typed on.
		box.type(10, "!");
		expect([box.own.live, box.own.mine]).toEqual(["not a duct!", "duct!"]);
		// The box put right, by whoever put it back.
		box.take(0, 6, "nobody");
		expect([box.own.live, box.own.mine, box.own.outOfStep]).toEqual(["duct!", "duct!", false]);
	});

	it("is the same whichever comes first, the put back text or the news of it", () => {
		for (const newsFirst of [true, false]) {
			const box = new Box("old words");
			if (newsFirst) box.own.rebase("new text", { putBack: true });
			box.take(0, 9, "nobody");
			box.type(0, "new text", "nobody");
			if (!newsFirst) box.own.rebase("new text", { putBack: true });
			expect([...box.shown, box.own.outOfStep]).toEqual(["new text", "new text", "new text", false]);
		}
	});

	it("takes out put back text you took out before the news of it", () => {
		const box = new Box("old");
		box.take(0, 3, "nobody");
		box.type(0, "new", "nobody");
		box.take(0, 1);
		box.own.rebase("new", { putBack: true });
		expect(box.shown).toEqual(["ew", "ew", "new"]);
	});

	// Otherwise your own typing from before would be taken out of it again.
	it("doesn't take typing you've taken out for a put back of the same", () => {
		const box = new Box("a");
		box.type(1, "duct", "theirs");
		box.take(1, 4);
		box.own.rebase("aduct", { putBack: true });
		expect(box.own.mine).toBe("aduct");
	});

	it("knows typing that arrives after the save it's in", () => {
		const box = new Box("a");
		box.own.rebase("a b");
		expect([box.own.mine, box.own.outOfStep]).toEqual(["a b", true]);
		box.type(1, " b", "theirs");
		expect([box.own.live, box.own.mine, box.own.outOfStep, box.own.theirsUnsaved]).toEqual(["a b", "a b", false, false]);
	});

	it("leaves whatever was in the box on joining for whoever typed it", () => {
		const box = new Box("duct", "duct, half typ");
		expect([box.own.live, box.own.mine, box.own.theirsUnsaved, box.own.outOfStep]).toEqual(["duct, half typ", "duct", false, false]);
		box.type(14, "?");
		expect(box.own.mine).toBe("duct?");
		box.own.rebase("duct, half typ");
		expect([box.own.mine, box.own.stored]).toEqual(["duct, half typ?", "duct, half typ"]);
	});

	it("only takes that out of the box when there's nobody left to save it", () => {
		const box = new Box("duct", "duct, half typ");
		expect([box.own.right(false), box.own.right(true)]).toEqual(["duct, half typ", "duct"]);
	});

	it("says when they've typed, or taken out something stored, and not saved it", () => {
		const box = new Box("abc");
		expect(box.own.theirsUnsaved).toBe(false);
		box.take(0, 1, "theirs");
		expect([box.own.theirsUnsaved, box.own.merged]).toEqual([true, "bc"]);
		box.own.rebase("bc");
		box.type(2, "d", "theirs");
		expect([box.own.theirsUnsaved, box.own.merged]).toEqual([true, "bcd"]);
		box.own.rebase("bcd");
		// They can't save taking out yours until you've saved it.
		box.type(3, "e");
		box.take(3, 1, "theirs");
		expect([box.own.theirsUnsaved, box.own.mine]).toEqual([false, "bcde"]);
	});

	it("starts again when the box is swapped for another copy", () => {
		const box = new Box("ab");
		box.type(2, "c");
		box.chars = [...new Box("", "abX").chars].map((c) => ({ ...c, id: `new${c.id}` }));
		box.own.swap(box.chars);
		expect(box.shown).toEqual(["abX", "ab", "ab"]);
	});

	it("is always what's in the box when Yjs mends half a pair", () => {
		const box = new Box("ab");
		box.chars = box.chars.map((c, i) => (i === 1 ? { ...c, ch: "\ufffd" } : c));
		box.own.edit(box.chars, "theirs");
		expect(box.own.live).toBe("a\ufffd");
	});

	it("can be typed in and taken out of for as long as you like", () => {
		const box = new Box("duct");
		for (let i = 0; i < 400; i++) {
			box.type(4, "x", "theirs");
			box.take(4, 1, "theirs");
		}
		expect(box.shown).toEqual(["duct", "duct", "duct"]);
		expect((box.own as unknown as { chars: unknown[] }).chars.length).toBeLessThan(320);
	});
});

// Both boxes of a form, the way useSharedText has them.
function form(stored: TextNow, stillOpen?: () => boolean) {
	const fields = new SharedFields<TextField>(TEXT_FIELDS, stored);
	const edit = new TextEdit(stored, stillOpen);
	for (const field of TEXT_FIELDS) edit.opened(field, fields.chars(field));
	let theirs = false;
	fields.subscribe((change) => edit.changed(change.field, { ...change, remote: theirs }));
	const type = (field: TextField, text: string) => fields.set(field, text);
	const theyType = (field: TextField, text: string) => {
		theirs = true;
		fields.set(field, text);
		theirs = false;
	};
	return { edit, fields, type, theyType };
}

describe("TextEdit", () => {
	it("sends each box with what it started from, so one you're not in stays", () => {
		const { edit, type, theyType } = form({ label: "duct", notes: "" });
		type("notes", "seen");
		theyType("label", "theirs duct");
		expect(edit.next()).toEqual({ label: "duct", wasLabel: "duct", notes: "seen", wasNotes: "" });
	});

	it("keeps the last label while the box is empty", () => {
		const { edit, type } = form({ label: "duct", notes: "" });
		type("label", "");
		expect([edit.hasMore(), edit.next().label]).toEqual([false, "duct"]);
		type("notes", "still saves");
		expect([edit.hasMore(), edit.next().label, edit.next().notes]).toEqual([true, "duct", "still saves"]);
	});

	it("doesn't save a space at either end", () => {
		const { edit, type } = form({ label: "duct", notes: " a" });
		type("label", "duct ");
		type("notes", "a");
		expect(edit.hasMore()).toBe(false);
	});

	it("saves what the box says when yours on its own won't fit", () => {
		const { edit, type, theyType } = form({ label: "x".repeat(60), notes: "" });
		theyType("label", "x".repeat(40));
		type("label", "x".repeat(40) + "y".repeat(20));
		expect(edit.next().label).toBe("x".repeat(40) + "y".repeat(20));
	});

	it("never saves more than the box holds", () => {
		const { edit, type } = form({ label: "", notes: "" });
		type("label", "a".repeat(100));
		type("notes", "b".repeat(300));
		expect([edit.next().label.length, edit.next().notes.length]).toEqual([64, 256]);
	});

	it("doesn't send half an emoji", () => {
		const { edit, type, theyType } = form({ label: "😀", notes: "" });
		theyType("label", "😁");
		type("label", "a😁");
		expect(edit.next().label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
	});

	it("takes the newest of what it's told, whatever order it hears it in", () => {
		const { edit, type } = form({ label: "a", notes: "" });
		type("notes", "mine");
		edit.storedNow({ label: "newer" }, { at: 20 });
		edit.storedNow({ label: "older" }, { at: 10 });
		edit.storedNow({ notes: "n" }, { at: 15 });
		expect([edit.next().wasLabel, edit.next().wasNotes]).toEqual(["newer", "n"]);
	});

	it("says what each box should say where that's not what it does", () => {
		const { edit, theyType } = form({ label: "duct", notes: "n" });
		expect(edit.putRight(true)).toEqual({});
		edit.storedNow({ label: "vessel" }, { putBack: true });
		theyType("notes", "n, theirs");
		expect(edit.putRight(false)).toEqual({ label: "vessel" });
	});
});

describe("saveText", () => {
	const typing = (label: string) => {
		const { edit, type } = form({ label: "", notes: "" });
		type("label", label);
		return edit;
	};
	const answering =
		<T>(sent: TextToSave[], answers: T[]) =>
		async (text: TextToSave) => {
			sent.push(text);
			return answers[Math.min(sent.length, answers.length) - 1];
		};

	it("works your typing out again from what's there, until it's in", async () => {
		const sent: TextToSave[] = [];
		const edit = typing("x");
		const send = answering(sent, [{ behind: { label: "", notes: "n" } }, { behind: { label: "", notes: "" } }, { saved: "done" }] as never[]);
		expect(await saveText(edit, { closing: true }, send)).toBe("done");
		expect(sent.map((s) => [s.wasNotes, s.notes, s.label])).toEqual([
			["", "", "x"],
			["n", "n", "x"],
			["", "", "x"],
		]);
		expect(edit.hasMore()).toBe(false);
	});

	// Worked out from what it spells, a letter of theirs could be taken for yours.
	it("waits to hear which characters it's behind, unless the form's gone", async () => {
		const behind = [{ behind: { label: "a", notes: "" } }, { saved: "done" }] as never[];
		const waiting: TextToSave[] = [];
		const edit = typing("x");
		expect(await saveText(edit, {}, answering(waiting, behind))).toBeNull();
		expect([waiting.length, edit.hasMore()]).toEqual([1, true]);
		const closing: TextToSave[] = [];
		expect(await saveText(typing("x"), { closing: true }, answering(closing, behind))).toBe("done");
		expect([closing.length, closing[1].wasLabel, [...closing[1].label].sort().join("")]).toEqual([2, "a", "ax"]);
	});

	it("follows what the answer says is stored, not just what was sent", async () => {
		const edit = typing("x");
		await saveText(edit, {}, async () => ({ saved: null, now: { label: "x", notes: "theirs" }, at: 5 }));
		expect(edit.next()).toEqual({ label: "x", wasLabel: "x", notes: "theirs", wasNotes: "theirs" });
	});

	it("doesn't go back to its own answer after hearing of a newer save", async () => {
		const edit = typing("x");
		await saveText(edit, {}, async () => {
			edit.storedNow({ label: "xy" }, { at: 9 });
			return { saved: null, at: 5 };
		});
		expect(edit.next().wasLabel).toBe("xy");
	});

	it("doesn't send what someone else has already saved", async () => {
		const sent: TextToSave[] = [];
		await saveText(typing("same"), {}, answering(sent, [{ behind: { label: "same", notes: "" } }]));
		expect(sent).toHaveLength(1);
		await saveText(new TextEdit({ label: "a", notes: "" }), {}, answering(sent, [{ saved: null }]));
		expect(sent).toHaveLength(1);
		// Unless there's more than text to it.
		await saveText(new TextEdit({ label: "a", notes: "" }), { always: true }, answering(sent, [{ saved: null }]));
		expect(sent).toHaveLength(2);
	});

	it("saves what else there is meanwhile, and leaves the typing for then", async () => {
		const sent: TextToSave[] = [];
		const edit = typing("x");
		const send = answering(sent, [{ behind: { label: "a", notes: "" } }, { saved: "done" }] as never[]);
		expect(await saveText(edit, { always: true }, send)).toBe("done");
		expect([sent[1].label, sent[1].wasLabel, edit.hasMore()]).toEqual(["a", "a", true]);
	});

	it("takes whoever saved it's word for which characters it is, once that comes", async () => {
		const { edit, fields, theyType } = form({ label: "", notes: "" });
		theyType("notes", "ee");
		const [first] = fields.chars("notes").map((c) => c.id);
		edit.storedNow({ notes: "e" }, { at: 5 });
		edit.storedNow({ notes: "e" }, { at: 4, ids: { notes: [first] } });
		theyType("notes", "e");
		expect(edit.next()).toMatchObject({ notes: "e", wasNotes: "e" });
		// Older news of something else isn't any.
		edit.storedNow({ notes: "old" }, { at: 3, ids: { notes: ["1:1", "1:2", "1:3"] } });
		expect(edit.next().wasNotes).toBe("e");
	});

	it("gives up rather than go round for ever, and still has it to save", async () => {
		let n = 0;
		const edit = typing("x");
		expect(await saveText(edit, { closing: true }, async () => ({ behind: { label: `v${n++}`, notes: "" } }))).toBeNull();
		expect(n).toBeLessThan(20);
		expect(edit.hasMore()).toBe(true);
	});

	it("drops one that's behind a whole collection put back", async () => {
		let open = true;
		const sent: TextToSave[] = [];
		const { edit, type } = form({ label: "old", notes: "" }, () => open);
		type("label", "older");
		open = false;
		await saveText(edit, { closing: true }, answering(sent, [{ behind: { label: "put back", notes: "" } }]));
		expect(sent).toHaveLength(1);
	});

	it("leaves one refused for something else", async () => {
		expect(await saveText(typing("x"), {}, async () => ({ refused: true }))).toBeNull();
	});

	it("takes out what you take out while it's on its way", async () => {
		const { edit, type } = form({ label: "duct", notes: "" });
		type("label", "duct 4");
		await saveText(edit, {}, async () => {
			type("label", "duct");
			return { saved: null };
		});
		expect(edit.next()).toEqual({ label: "duct", wasLabel: "duct 4", notes: "", wasNotes: "" });
	});
});

describe("readBehind", () => {
	it("reads the text a save was behind, and nothing from any other conflict", () => {
		expect(readBehind({ text: true, current: { id: "a", label: "l", notes: "n" } })).toEqual({ label: "l", notes: "n" });
		expect(readBehind({ text: false, current: { label: "l" } })).toBeNull();
		expect(readBehind({ id: "a", current: { colour: "#fff" } })).toBeNull();
		expect(readBehind("This session has ended")).toBeNull();
		expect(readBehind(null)).toBeNull();
	});
});
