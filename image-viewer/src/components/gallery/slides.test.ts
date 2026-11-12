import { describe, expect, it } from "vitest";
import {
	bytesText,
	collectionsText,
	fileText,
	galleryLayout,
	kindText,
	liveText,
	neighbour,
	peopleText,
	physicalText,
	pixelsText,
	positionText,
	scannerText,
	slideName,
	sortSlides,
	thumbnailUrl,
	wholeSlideTileUrl,
	zoomText,
	type GallerySlide,
} from "./slides";

// What the tiler gives for its four slides - see tiler/README.md.
const cmu: GallerySlide = {
	id: "000",
	fileName: "000.mrxs",
	width: 7436,
	height: 15494,
	tileSize: 256,
	objectivePower: 20,
	mppX: 3.71723625557207,
	mppY: 3.71631683168317,
	name: "CMU-1",
	kind: "brightfield",
	channels: [],
	levels: 7,
	objectiveName: null,
	camera: "Hitachi_HV_F22CL",
	backgroundColour: "#ffffff",
	fileBytes: 5686605,
};

const epiderm: GallerySlide = {
	id: "001",
	fileName: "001.mrxs",
	width: 76324,
	height: 170960,
	tileSize: 256,
	objectivePower: 20,
	mppX: 0.3225,
	mppY: 0.3225,
	name: "25058_Epiderm_AcH3_3",
	kind: "fluorescence",
	channels: ["Rhodamine", "FITC", "UV"],
	levels: 11,
	objectiveName: "Plan-Apochromat",
	camera: "AxioCam Mrm Rev.3",
	backgroundColour: "#808080",
	fileBytes: 65783460,
};

const hps: GallerySlide = {
	id: "003",
	fileName: "003.mrxs",
	width: 101832,
	height: 219976,
	tileSize: 256,
	objectivePower: 20,
	mppX: 0.23387573964497,
	mppY: 0.234330708661417,
	name: "003",
	kind: "brightfield",
	channels: [],
	levels: 11,
	objectiveName: "Plan-Apochromat",
	camera: "Hitachi_HV_F22CL",
	backgroundColour: "#ffffff",
	fileBytes: 3110444923,
};

// A tiler from before the gallery only sends these.
const bare: GallerySlide = { id: "002", fileName: "002.mrxs", width: 72448, height: 152080, tileSize: 256, objectivePower: null, mppX: null, mppY: null };

describe("galleryLayout", () => {
	it("is cards floating and expanded, a strip floating and collapsed", () => {
		expect(galleryLayout(null, true)).toBe("cards");
		expect(galleryLayout(null, false)).toBe("strip-horizontal");
	});

	// Docked it's always a strip, whatever the toggle said when it was floating.
	it.each([
		["left", "strip-vertical"],
		["right", "strip-vertical"],
		["top", "strip-horizontal"],
		["bottom", "strip-horizontal"],
	] as const)("docked %s is %s", (side, layout) => {
		expect(galleryLayout(side, true)).toBe(layout);
		expect(galleryLayout(side, false)).toBe(layout);
	});
});

describe("slideName", () => {
	it("is the scanner's name", () => {
		expect(slideName(cmu)).toBe("CMU-1");
	});

	it("is the id when there isn't one", () => {
		expect(slideName(bare)).toBe("002");
		expect(slideName({ id: "004", name: "   " })).toBe("004");
	});
});

describe("sortSlides", () => {
	it("puts numbers in number order and leaves the list alone", () => {
		const slides = [{ id: "10" }, { id: "2" }, { id: "001" }, { id: "b" }, { id: "a" }];
		expect(sortSlides(slides).map((s) => s.id)).toEqual(["001", "2", "10", "a", "b"]);
		expect(slides[0].id).toBe("10");
	});
});

describe("the card's lines", () => {
	it("gives the size in pixels with thousands marked", () => {
		expect(pixelsText(hps)).toBe("101,832 x 219,976 px");
	});

	// Worked out by hand: 101832 * 0.23387573964497 / 1000 = 23.82, 219976 *
	// 0.234330708661417 / 1000 = 51.55.
	it("gives the real size from microns per pixel", () => {
		expect(physicalText(hps)).toBe("23.8 x 51.5 mm");
		expect(physicalText(cmu)).toBe("27.6 x 57.6 mm");
	});

	it("leaves out what the slide doesn't say", () => {
		expect(physicalText(bare)).toBeNull();
		expect(zoomText(bare)).toBeNull();
		expect(kindText(bare)).toBeNull();
		expect(fileText(bare)).toBeNull();
		expect(scannerText(bare)).toBeNull();
	});

	// 000's file says x20 but it's a small copy - the microns per pixel next to
	// it is what shows that.
	it("puts the zoom next to the microns per pixel", () => {
		expect(zoomText(hps)).toBe("Max zoom x20 · 0.23 µm/px");
		expect(zoomText(cmu)).toBe("Max zoom x20 · 3.72 µm/px");
		expect(zoomText({ objectivePower: 40, mppX: null })).toBe("Max zoom x40");
		expect(zoomText({ objectivePower: 2.5, mppX: null })).toBe("Max zoom x2.5");
	});

	it("names the channels after the kind", () => {
		expect(kindText(epiderm)).toBe("Fluorescence · Rhodamine, FITC, UV");
		expect(kindText(hps)).toBe("Brightfield");
	});

	it("gives the zoom levels and file size", () => {
		expect(fileText(hps)).toBe("11 zoom levels · 2.9 GB");
		expect(fileText(epiderm)).toBe("11 zoom levels · 63 MB");
		expect(fileText(cmu)).toBe("7 zoom levels · 5 MB");
	});

	it("puts the scanner in the tooltip", () => {
		expect(scannerText(epiderm)).toBe("Plan-Apochromat · AxioCam Mrm Rev.3");
		expect(scannerText(cmu)).toBe("Hitachi_HV_F22CL");
	});
});

describe("bytesText", () => {
	it("steps up through KB, MB and GB", () => {
		expect(bytesText(10)).toBe("1 KB");
		expect(bytesText(500 * 1024)).toBe("500 KB");
		expect(bytesText(3 * 1024 * 1024)).toBe("3 MB");
		expect(bytesText(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
	});
});

describe("what's on a slide", () => {
	it("says when there's nothing, and counts when there is", () => {
		expect(collectionsText(undefined)).toBe("No collections yet");
		expect(collectionsText({ slideId: "001", collections: 0, liveSessions: 1 })).toBe("No collections yet");
		expect(collectionsText({ slideId: "001", collections: 1, liveSessions: 0 })).toBe("1 collection");
		expect(collectionsText({ slideId: "001", collections: 1200, liveSessions: 0 })).toBe("1,200 collections");
	});

	it("only mentions live sessions and people when there are some", () => {
		expect(liveText(undefined)).toBeNull();
		expect(liveText({ slideId: "001", collections: 2, liveSessions: 0 })).toBeNull();
		expect(liveText({ slideId: "001", collections: 2, liveSessions: 1 })).toBe("1 live session");
		expect(liveText({ slideId: "001", collections: 2, liveSessions: 3 })).toBe("3 live sessions");
		expect(peopleText(0)).toBeNull();
		expect(peopleText(1)).toBe("1 person here now");
		expect(peopleText(4)).toBe("4 people here now");
	});
});

describe("moving along", () => {
	const slides = [cmu, epiderm, bare, hps];

	it("finds the one before and after", () => {
		expect(neighbour(slides, "001", -1)?.id).toBe("000");
		expect(neighbour(slides, "001", 1)?.id).toBe("002");
	});

	it("stops at the ends", () => {
		expect(neighbour(slides, "000", -1)).toBeNull();
		expect(neighbour(slides, "003", 1)).toBeNull();
	});

	// The address could name one the tiler doesn't have.
	it("has nowhere to go from one that isn't listed", () => {
		expect(neighbour(slides, "999", 1)).toBeNull();
		expect(neighbour([], "003", -1)).toBeNull();
	});

	it("says where you are", () => {
		expect(positionText(slides, "003")).toBe("4 of 4");
		expect(positionText(slides, "000")).toBe("1 of 4");
		expect(positionText(slides, "999")).toBe("4 slides");
		expect(positionText([cmu], "999")).toBe("1 slide");
	});
});

describe("pictures", () => {
	it("asks the tiler for a square from the middle, and the one tile as a fallback", () => {
		expect(thumbnailUrl("/tiler", "003")).toBe("/tiler/slides/003/thumbnail.jpg?width=192&square=true");
		expect(wholeSlideTileUrl("/tiler", "003")).toBe("/tiler/slides/003/TileGroup0/0-0-0.jpg");
	});

	it("escapes the id", () => {
		expect(thumbnailUrl("/tiler", "a b")).toBe("/tiler/slides/a%20b/thumbnail.jpg?width=192&square=true");
	});
});
