import { describe, expect, it } from "vitest";
import app from "./App.tsx?raw";

// A floating panel is hidden until it's been measured, through its entry in
// panelRefs. Leave one out and its button lights up with nothing to show for it.
describe("panels", () => {
	const ids = [...app.matchAll(/\{ id: ["']([^"']+)["'], title: /g)].map((match) => match[1]);

	it("are found", () => {
		expect(ids).toContain("messages");
		expect(ids.length).toBeGreaterThan(5);
	});

	it.each(ids)("%s can be measured", (id) => {
		// Formatting takes the quotes off a key that doesn't need them.
		expect(app).toMatch(new RegExp(`\\s["']?${id}["']?: createRef<HTMLDivElement>\\(\\)`));
	});
});
