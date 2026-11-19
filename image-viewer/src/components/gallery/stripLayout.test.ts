import { describe, expect, it } from "vitest";
import galleryCss from "./GalleryPanel.css?raw";
import toolbarCss from "../toolbar/Toolbar.css?raw";

// The declarations of the rule with exactly this selector.
function rule(css: string, selector: string): string {
	const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = bare.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
	if (!match) throw new Error(`No rule for ${selector}`);
	return match[1];
}

// Docked along the top or bottom, the strip's scrollbar is how you get along
// 200 slides. It was cut off by the bottom of the panel (fixed 8em pictures
// plus the scrollbar didn't fit), sat under the arrow ribbon, and the toolbar's
// buttons stuck up over it. The browser checks are in playback's gallery scene;
// these keep the rules that fixed it from being undone.
describe("horizontal gallery strip", () => {
	it("sizes docked pictures to what's left over the scrollbar", () => {
		expect(rule(galleryCss, ".gallery--docked .gallery-strip--horizontal .gallery-strip-list")).toMatch(/container-type:\s*size/);
		const thumb = rule(galleryCss, ".gallery--docked .gallery-strip--horizontal .gallery-thumb");
		expect(thumb).toMatch(/100cqh/);
		expect(thumb).toMatch(/var\(--strip-scrollbar\)/);
		expect(thumb).not.toMatch(/\b8em\b/);
	});

	it("only fixes the picture size when docked down the side", () => {
		expect(rule(galleryCss, ".gallery--docked .gallery-strip--vertical .gallery-thumb")).toMatch(/height:\s*8em/);
	});

	it("keeps the arrow ribbon above the scrollbar", () => {
		expect(rule(galleryCss, ".gallery-strip--horizontal")).toMatch(/--strip-scrollbar:\s*\d+px/);
		expect(rule(galleryCss, ".gallery-strip--horizontal .gallery-ribbon")).toMatch(/bottom:\s*calc\([^)]*var\(--strip-scrollbar\)/);
	});

	it("scrolls sideways only", () => {
		const list = rule(galleryCss, ".gallery-strip--horizontal .gallery-strip-list");
		expect(list).toMatch(/overflow-x:\s*auto/);
		expect(list).toMatch(/overflow-y:\s*hidden/);
	});
});

describe("toolbar buttons", () => {
	// A button's em is the browser's button text size, not the bar's, so an em
	// height made them taller than the bar and they covered the bottom dock.
	it("are as tall as the bar, not an em height of their own", () => {
		expect(rule(toolbarCss, ".toolbar-button")).toMatch(/height:\s*100%/);
	});
});
