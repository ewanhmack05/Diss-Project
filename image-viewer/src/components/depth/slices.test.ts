import { describe, expect, it } from "vitest";
import {
	FLAT,
	clampSlice,
	gapsAround,
	isVolume,
	keyStep,
	readSlices,
	sliceBaseUrl,
	sliceLabel,
	sliceUrlFrom,
	sliceWindow,
	wheelStep,
	wheelStepper,
	type Slice,
} from "./slices";

// Like the liver volume: 15 slices, a gap before slice 10.
const LIVER: Slice[] = Array.from({ length: 15 }, (_, index) => ({ index, gapBefore: index === 10 }));

describe("volumes", () => {
	it("are more than one slice", () => {
		expect(isVolume(LIVER)).toBe(true);
		expect(isVolume(FLAT)).toBe(false);
		expect(isVolume([])).toBe(false);
	});

	it("come from the tiler, or a flat slide from an older one", () => {
		expect(readSlices({ slices: LIVER, defaultSlice: 7 })).toEqual({ slices: LIVER, defaultSlice: 7 });
		expect(readSlices({})).toEqual({ slices: FLAT, defaultSlice: 0 });
		expect(readSlices({ slices: [] })).toEqual({ slices: FLAT, defaultSlice: 0 });
	});

	it("open on the first slice if the default isn't one of them", () => {
		expect(readSlices({ slices: LIVER, defaultSlice: 15 }).defaultSlice).toBe(0);
		expect(readSlices({ slices: LIVER, defaultSlice: -1 }).defaultSlice).toBe(0);
	});
});

describe("clampSlice", () => {
	it("keeps to the slices there are", () => {
		expect(clampSlice(-3, 15)).toBe(0);
		expect(clampSlice(20, 15)).toBe(14);
		expect(clampSlice(6.6, 15)).toBe(7);
		expect(clampSlice(4, 0)).toBe(0);
	});
});

describe("sliceWindow", () => {
	it("is the slice and one either side, nearest first", () => {
		expect(sliceWindow(7, 15)).toEqual([7, 6, 8]);
	});

	it("stops at the ends", () => {
		expect(sliceWindow(0, 15)).toEqual([0, 1]);
		expect(sliceWindow(14, 15)).toEqual([14, 13]);
		expect(sliceWindow(0, 1)).toEqual([0]);
	});

	it("can reach further", () => {
		expect(sliceWindow(7, 15, 2)).toEqual([7, 6, 8, 5, 9]);
	});

	it("never holds more than 3 layers by default - 3 GL contexts", () => {
		for (let slice = 0; slice < 15; slice++) expect(sliceWindow(slice, 15).length).toBeLessThanOrEqual(3);
	});
});

describe("slice urls", () => {
	it("are the tiler's slice route, or the slide's own for none", () => {
		expect(sliceBaseUrl("http://localhost:5095", "liver", 3)).toBe("http://localhost:5095/slides/liver/slice/3/");
		expect(sliceBaseUrl("http://localhost:5095", "000", null)).toBe("http://localhost:5095/slides/000/");
	});

	it("escape the slide id", () => {
		expect(sliceBaseUrl("/tiler", "a b", 0)).toBe("/tiler/slides/a%20b/slice/0/");
	});

	it("hang off the slide's base url", () => {
		expect(sliceUrlFrom("/tiler/slides/liver/", 0)).toBe("/tiler/slides/liver/slice/0/");
		expect(sliceUrlFrom("/tiler/slides/liver/", null)).toBe("/tiler/slides/liver/");
	});
});

describe("labels and gaps", () => {
	it("count from 1", () => {
		expect(sliceLabel(0, 15)).toBe("Slice 1 of 15");
		expect(sliceLabel(14, 15)).toBe("Slice 15 of 15");
	});

	it("say which side a gap is on", () => {
		expect(gapsAround(LIVER, 9)).toEqual({ before: false, after: true });
		expect(gapsAround(LIVER, 10)).toEqual({ before: true, after: false });
		expect(gapsAround(LIVER, 5)).toEqual({ before: false, after: false });
		expect(gapsAround(LIVER, 14)).toEqual({ before: false, after: false });
	});
});

describe("keyStep", () => {
	const key = (k: string, mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
		key: k,
		altKey: false,
		ctrlKey: false,
		metaKey: false,
		...mods,
	});

	it("goes deeper on Page Down and back on Page Up", () => {
		expect(keyStep(key("PageDown"))).toBe(1);
		expect(keyStep(key("PageUp"))).toBe(-1);
	});

	it("leaves other keys alone", () => {
		expect(keyStep(key("ArrowDown"))).toBeNull();
		expect(keyStep(key("f"))).toBeNull();
	});

	it("leaves the browser's own Ctrl+Page Up/Down alone", () => {
		expect(keyStep(key("PageDown", { ctrlKey: true }))).toBeNull();
		expect(keyStep(key("PageUp", { metaKey: true }))).toBeNull();
		expect(keyStep(key("PageUp", { altKey: true }))).toBeNull();
	});
});

describe("wheel", () => {
	it("scrolling down goes deeper, whichever axis Shift turned it into", () => {
		expect(wheelStep(0, 100)).toBe(1);
		expect(wheelStep(0, -100)).toBe(-1);
		expect(wheelStep(100, 0)).toBe(1);
		expect(wheelStep(0, 0)).toBeNull();
	});

	it("one mouse notch is one slice", () => {
		const wheel = wheelStepper();
		expect(wheel(0, 100, 0, 0)).toBe(1);
		expect(wheel(0, 100, 0, 50)).toBe(1);
		expect(wheel(0, -100, 0, 100)).toBe(-1);
	});

	it("a trackpad swipe of small deltas adds up to a slice, not one per event", () => {
		const wheel = wheelStepper();
		const steps = Array.from({ length: 20 }, (_, i) => wheel(0, 4, 0, i * 10)).filter((step) => step !== null);
		// 20 x 4px is 80px - exactly one slice.
		expect(steps).toEqual([1]);
	});

	it("turning back starts the count again", () => {
		const wheel = wheelStepper();
		expect(wheel(0, 60, 0, 0)).toBeNull();
		expect(wheel(0, -80, 0, 10)).toBe(-1);
	});

	it("a pause starts the count again", () => {
		const wheel = wheelStepper();
		expect(wheel(0, 60, 0, 0)).toBeNull();
		expect(wheel(0, 60, 0, 1000)).toBeNull();
		expect(wheel(0, 30, 0, 1010)).toBe(1);
	});

	it("turns lines and pages into pixels", () => {
		expect(wheelStepper()(0, 3, 1, 0)).toBe(1);
		expect(wheelStepper()(0, 1, 2, 0)).toBe(1);
		expect(wheelStepper()(0, 1, 1, 0)).toBeNull();
	});
});
