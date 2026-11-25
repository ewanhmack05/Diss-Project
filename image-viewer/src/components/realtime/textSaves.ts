import { TEXT_SAVE_MS } from "./autosave";
import type { SaveOptions, TextEdit } from "./ownText";
import type { FieldChange } from "./sharedFields";

// Typing nobody's saved for this long is saved by anyone who still has the
// form open - whoever typed it has gone, as they'd have saved it by now.
const LEFT_BEHIND_MS = 6000;
// How long a box can be out of step with what's stored, with nobody typing,
// before one of the people in it puts it right. Saves sort that out between
// them and whoever puts an old version back puts it in the box, so this is for
// when they can't - they've gone, or two people's typing got muddled on the way.
const PUT_RIGHT_MS = 4000;

interface Clock {
	set: (run: () => void, ms: number) => unknown;
	clear: (timer: unknown) => void;
}

const REAL_CLOCK: Clock = {
	set: (run, ms) => setTimeout(run, ms),
	clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

// When an open form saves: a pause after your own typing, or a long one after
// someone else's that's still not stored.
class TextSaves {
	private readonly timers = new Map<"own" | "left" | "right", unknown>();
	private readonly edit: TextEdit;
	private readonly save: (options: SaveOptions) => void;
	// Puts text in the box, if it's us to.
	private readonly putRight: () => void;
	private readonly clock: Clock;

	constructor(edit: TextEdit, save: (options: SaveOptions) => void, putRight: () => void, clock: Clock = REAL_CLOCK) {
		this.edit = edit;
		this.save = save;
		this.putRight = putRight;
		this.clock = clock;
	}

	changed({ remote, delta }: Pick<FieldChange<string>, "remote" | "delta">): void {
		if (!remote) this.typed();
		// Not a whole box swapped, as that's all there already was.
		else if (delta) this.theyTyped();
		this.checkStep();
	}

	// Someone's save can leave you with one to make - you took out what they've
	// only now stored - or them.
	storedChanged(): void {
		if (this.edit.hasMore() && !this.timers.has("own")) this.typed();
		if (!this.edit.theirsUnsaved) this.stop("left");
		else if (!this.timers.has("left")) this.theyTyped();
		this.checkStep();
	}

	private checkStep(): void {
		if (!this.edit.outOfStep) {
			this.stop("right");
			return;
		}
		this.after("right", PUT_RIGHT_MS, () => {
			if (this.timers.has("own") || this.timers.has("left")) this.checkStep();
			else this.putRight();
		});
	}

	private typed(): void {
		this.after("own", TEXT_SAVE_MS, () => this.save({}));
	}

	private theyTyped(): void {
		if (this.edit.theirsUnsaved) this.after("left", LEFT_BEHIND_MS, () => this.edit.theirsUnsaved && this.save({ everyones: true }));
	}

	// alone is nobody else having it open, so theirs is yours to save.
	close(alone: boolean): void {
		const waiting = this.timers.has("own");
		this.cancel();
		if (alone && this.edit.theirsUnsaved) this.save({ everyones: true, closing: true });
		else if (waiting || this.edit.hasMore()) this.save({ closing: true });
	}

	cancel(): void {
		for (const which of [...this.timers.keys()]) this.stop(which);
	}

	private after(which: "own" | "left" | "right", ms: number, run: () => void): void {
		this.stop(which);
		this.timers.set(
			which,
			this.clock.set(() => {
				this.timers.delete(which);
				run();
			}, ms),
		);
	}

	private stop(which: "own" | "left" | "right"): void {
		const timer = this.timers.get(which);
		if (timer !== undefined) this.clock.clear(timer);
		this.timers.delete(which);
	}
}

export { TextSaves, LEFT_BEHIND_MS, PUT_RIGHT_MS };
export type { Clock };
