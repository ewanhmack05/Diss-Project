import { describe, expect, it } from "vitest";
import { moveWarnings, type MoveState } from "./moving";

const nothing: MoveState = { drawing: false, counting: false, comparison: false, sharedCount: false, sessionName: null };

describe("moveWarnings", () => {
	it("is empty with nothing to lose, so the move just happens", () => {
		expect(moveWarnings(nothing)).toEqual([]);
	});

	it("warns about an annotation not saved", () => {
		expect(moveWarnings({ ...nothing, drawing: true })).toEqual(["The annotation you've drawn but not saved is thrown away."]);
	});

	it("warns about a count not saved", () => {
		expect(moveWarnings({ ...nothing, counting: true })).toEqual(["The cell count you haven't saved is thrown away."]);
	});

	// A comparison or shared count is counting too - one line, the one that says
	// what you're really leaving.
	it("says leaving a comparison rather than throwing a count away", () => {
		expect(moveWarnings({ ...nothing, counting: true, comparison: true })).toEqual(["You leave the comparison count."]);
		expect(moveWarnings({ ...nothing, counting: true, sharedCount: true })).toEqual(["You leave the shared count."]);
	});

	it("says you're still in the session", () => {
		expect(moveWarnings({ ...nothing, sessionName: "Bob's session" })).toEqual([
			"You leave Bob's session for now. You're still in it, and can go back in from its slide.",
		]);
	});

	it("puts losing work before leaving the session", () => {
		const warnings = moveWarnings({ ...nothing, drawing: true, counting: true, sessionName: "Lab" });
		expect(warnings).toHaveLength(3);
		expect(warnings[0]).toContain("annotation");
		expect(warnings[2]).toContain("Lab");
	});
});
