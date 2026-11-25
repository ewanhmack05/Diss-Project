import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_SAVE_MS } from "./autosave";
import { LEFT_BEHIND_MS, PUT_RIGHT_MS, TextSaves } from "./textSaves";

const ahead = { remote: false, delta: [{ insert: "x" }] };
const theirs = { remote: true, delta: [{ insert: "x" }] };

function setUp(state: Partial<{ hasMore: boolean; theirsUnsaved: boolean; outOfStep: boolean }> = {}) {
	const now = { hasMore: false, theirsUnsaved: false, outOfStep: false, ...state };
	const edit = {
		hasMore: () => now.hasMore,
		get theirsUnsaved() {
			return now.theirsUnsaved;
		},
		get outOfStep() {
			return now.outOfStep;
		},
	};
	const save = vi.fn();
	const putRight = vi.fn();
	return { now, save, putRight, saves: new TextSaves(edit as never, save, putRight) };
}

describe("TextSaves", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("saves a pause after your own typing", () => {
		const { saves, save } = setUp();
		saves.changed(ahead);
		vi.advanceTimersByTime(TEXT_SAVE_MS - 1);
		saves.changed(ahead);
		vi.advanceTimersByTime(TEXT_SAVE_MS - 1);
		expect(save).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(save.mock.calls).toEqual([[{}]]);
	});

	it("doesn't save for theirs, unless they leave it behind", () => {
		const { saves, save } = setUp({ theirsUnsaved: true });
		saves.changed(theirs);
		vi.advanceTimersByTime(LEFT_BEHIND_MS - 1);
		expect(save).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(save.mock.calls).toEqual([[{ everyones: true }]]);
	});

	it("doesn't once they've saved it themselves", () => {
		const { saves, save, now } = setUp({ theirsUnsaved: true });
		saves.changed(theirs);
		now.theirsUnsaved = false;
		saves.storedChanged();
		vi.advanceTimersByTime(LEFT_BEHIND_MS * 2);
		expect(save).not.toHaveBeenCalled();
	});

	it("saves nothing for a box that was there when it opened", () => {
		const { saves, save } = setUp({ theirsUnsaved: true });
		saves.changed({ remote: true, delta: null });
		vi.advanceTimersByTime(LEFT_BEHIND_MS * 2);
		expect(save).not.toHaveBeenCalled();
	});

	it("saves what theirs being stored leaves you to", () => {
		const { saves, save } = setUp({ hasMore: true });
		saves.storedChanged();
		vi.advanceTimersByTime(TEXT_SAVE_MS);
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("puts a box right once nobody's typing in it, and not before", () => {
		const { saves, putRight, now } = setUp({ outOfStep: true });
		saves.storedChanged();
		vi.advanceTimersByTime(PUT_RIGHT_MS - 1);
		saves.changed(theirs);
		vi.advanceTimersByTime(PUT_RIGHT_MS - 1);
		expect(putRight).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(putRight).toHaveBeenCalledTimes(1);
		now.outOfStep = false;
		saves.storedChanged();
		vi.advanceTimersByTime(PUT_RIGHT_MS * 3);
		expect(putRight).toHaveBeenCalledTimes(1);
	});

	it("waits for a save that's due before putting it right", () => {
		const { saves, save, putRight, now } = setUp({ outOfStep: true, theirsUnsaved: true });
		saves.changed(theirs);
		vi.advanceTimersByTime(PUT_RIGHT_MS);
		expect(putRight).not.toHaveBeenCalled();
		vi.advanceTimersByTime(LEFT_BEHIND_MS - PUT_RIGHT_MS);
		expect(save).toHaveBeenCalledTimes(1);
		now.theirsUnsaved = false;
		vi.advanceTimersByTime(PUT_RIGHT_MS);
		expect(putRight).toHaveBeenCalledTimes(1);
	});

	it("saves what's waiting on closing, and everyone's if nobody else is there to", () => {
		const left = setUp({ theirsUnsaved: true });
		left.saves.close(true);
		expect(left.save.mock.calls).toEqual([[{ everyones: true, closing: true }]]);

		const own = setUp();
		own.saves.changed(ahead);
		own.saves.close(false);
		expect(own.save.mock.calls).toEqual([[{ closing: true }]]);

		const neither = setUp({ theirsUnsaved: true });
		neither.saves.close(false);
		vi.advanceTimersByTime(LEFT_BEHIND_MS * 2);
		expect(neither.save).not.toHaveBeenCalled();
	});

	it("saves nothing once it's cancelled", () => {
		const { saves, save } = setUp();
		saves.changed(ahead);
		saves.cancel();
		vi.advanceTimersByTime(TEXT_SAVE_MS * 2);
		expect(save).not.toHaveBeenCalled();
	});
});
