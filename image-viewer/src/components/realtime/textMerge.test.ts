import { describe, expect, it } from "vitest";
import { sameEdit, spliced } from "./textMerge";

const merged = (from: string, to: string, live: string) => spliced(live, sameEdit(from, to, live));

describe("sameEdit", () => {
	it("is just the edit when nothing else has changed", () => {
		expect(merged("duct", "a big duct!", "duct")).toBe("a big duct!");
		expect(merged("one two three", "one three", "one two three")).toBe("one three");
		expect(merged("", "new", "")).toBe("new");
		expect(merged("gone", "", "gone")).toBe("");
		expect(sameEdit("same", "same", "same but longer")).toEqual([]);
	});

	it("leaves in what's been typed since, wherever it is", () => {
		expect(merged("duct", "vessel", "A duct B")).toBe("A vessel B");
		expect(merged("one two", "one", "one, two")).toBe("one,");
		expect(merged("abc", "xbz", "a1b2c3")).toBe("x1b2z3");
	});

	it("doesn't mind what's already been taken out", () => {
		expect(merged("abc def ghi", "abc ghi", "def")).toBe("");
		expect(merged("abc", "abcd", "")).toBe("d");
	});

	it("never takes out anything that wasn't there to start with", () => {
		const letters = "abc ";
		let seed = 7;
		const random = (n: number) => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed % n;
		};
		const text = () => Array.from({ length: random(12) }, () => letters[random(4)]).join("");
		for (let i = 0; i < 500; i++) {
			const [from, to] = [text(), text()];
			expect(merged(from, to, from)).toBe(to);
			const live = [...from].flatMap((ch) => (random(3) === 0 ? ["X", ch] : [ch])).join("") + "X";
			const result = merged(from, to, live);
			expect(result.replaceAll("X", "")).toBe(to);
			expect(result.split("X")).toHaveLength(live.split("X").length);
		}
	});
});
