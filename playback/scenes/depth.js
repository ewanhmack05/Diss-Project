// A volume: serial sections of one liver, stepped through, drawn on and
// turned into a block. On the "liver" slide, 15 slices.
import { countDots, countLine, drawTwoClick, expect, fillName, row, saveAnnotation, shape } from "./helpers.js";

export const VOLUME = "liver";
const SLICES = 15;

// Somewhere on the tissue, at the size recordings use.
const ON_TISSUE = { x: 900, y: 420 };

function depth(person) {
	return person.panel("Depth");
}

// "Slice 3 of 15", at the top of the Depth tab.
function sliceText(person) {
	return depth(person).locator(".depth-panel-slider-header span").first();
}

async function onSlice(person, n) {
	await expect(sliceText(person)).toHaveText(`Slice ${n} of ${SLICES}`, { timeout: 10_000 });
}

// The toolbar button toggles, so only press it when the panel isn't up.
async function open(person, title, panel) {
	if (!(await person.panel(panel).isVisible())) await person.tool(title);
	await expect(person.panel(panel)).toBeVisible();
}

const DEPTH = "Depth - move through the slices";

// The Depth tab scrolls once the block's settings are open. Dragged from the
// thumb's middle - at either end of the range that's a thumb's width in from
// the edge, where Actor.slide would start just off it.
const THUMB = 8;
async function slideTo(person, slider, value) {
	await slider.scrollIntoViewIfNeeded();
	await person.pause(200);
	const box = await slider.boundingBox();
	const { min, max, now } = await slider.evaluate((input) => ({ min: Number(input.min), max: Number(input.max), now: Number(input.value) }));
	const x = (v) => box.x + THUMB + (box.width - 2 * THUMB) * Math.min(1, Math.max(0, (v - min) / (max - min)));
	const y = box.y + box.height / 2;
	await person.drag(
		[
			{ x: x(now), y },
			{ x: x(value), y },
		],
		{ stepsEach: 16 },
	);
}

async function openVolume(person) {
	const url = new URL(person.page.url());
	url.searchParams.set("slide", VOLUME);
	await person.page.goto(url.toString());
	await person.tiles();
}

export async function depthAlone({ sam }) {
	const page = sam.page;
	await openVolume(sam);

	await sam.caption("A volume: 15 sections cut one after another through a liver, lined up");
	await open(sam, DEPTH, "Depth");
	const panel = depth(sam);
	await expect(panel).toBeVisible();
	const start = Number((await sliceText(sam).textContent()).match(/Slice (\d+)/)[1]);

	await sam.caption("Next and Previous step a slice at a time", 500);
	await sam.press("Next", panel);
	await onSlice(sam, start + 1);
	await sam.press("Previous", panel);
	await onSlice(sam, start);
	sam.did("depth-step");

	await sam.caption("or Page Down and Page Up", 500);
	await sam.clickAt(ON_TISSUE);
	await page.keyboard.press("PageDown");
	await onSlice(sam, start + 1);
	await sam.pause(500);
	await page.keyboard.press("PageUp");
	await onSlice(sam, start);
	sam.did("depth-keys");

	await sam.caption("The slider goes anywhere in the stack", 500);
	await slideTo(sam, panel.getByRole("slider", { name: "Slice" }), 2);
	await onSlice(sam, 3);
	sam.did("depth-slider");

	await sam.caption("A shape drawn on a volume goes on the slice it was drawn on");
	await open(sam, "Annotations", "Annotations");
	const annotations = sam.panel("Annotations");
	await sam.click(shape(annotations, "Rectangle"));
	await drawTwoClick(sam, { x: ON_TISSUE.x - 120, y: ON_TISSUE.y - 80 }, { x: ON_TISSUE.x + 60, y: ON_TISSUE.y + 40 });
	await expect(annotations.locator(".annotation-form-check")).toContainText("not just slice 3");
	await saveAnnotation(sam, "On slice 3");
	await sam.click(annotations.getByRole("button", { name: /^Saved/ }));
	await expect(row(annotations, "On slice 3")).toContainText("Slice 3");
	sam.did("depth-shape-on-slice");

	await sam.caption("On another slice it isn't drawn; viewing it goes back to its slice", 500);
	await sam.press("Next", panel);
	await onSlice(sam, 4);
	await sam.click(row(annotations, "On slice 3"));
	await sam.press("View on map", annotations);
	await onSlice(sam, 3);
	await sam.press("Stop viewing", annotations);
	sam.did("depth-view-on-slice");

	await sam.caption("A cell count belongs to the slice it was counted on", 500);
	await open(sam, "Cell Count", "Cell Count");
	const counter = sam.panel("Cell Count");
	await sam.press("Start counting", counter);
	await countDots(sam, ON_TISSUE, [
		[-40, -20],
		[10, 30],
		[50, -10],
	]);
	await expect(countLine(counter)).toContainText("Count 3");
	await sam.press("Stop counting", counter);
	await fillName(sam, "Name this count", "Counted on 3");
	await sam.press("Save", counter.locator(".cell-count-form"));
	await sam.click(counter.getByRole("button", { name: /^Saved/ }));
	await expect(counter.locator(".saved-row-summary").filter({ hasText: "Counted on 3" })).toContainText("Slice 3");
	sam.did("depth-count-on-slice");

	await sam.caption("3D shows the stack as a block");
	await open(sam, DEPTH, "Depth");
	await sam.press("3D", depth(sam));
	await expect(page.locator(".volume-view canvas")).toBeVisible({ timeout: 20_000 });
	await expect(page.locator(".volume-view-status")).toHaveCount(0, { timeout: 30_000 });
	await sam.pause(1500);
	sam.did("depth-block");

	await sam.caption("Drag to turn it", 500);
	const view = await page.locator(".volume-view").boundingBox();
	const middle = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
	await sam.drag([middle, { x: middle.x + 160, y: middle.y - 60 }], { stepsEach: 20 });
	sam.did("depth-turn");

	await sam.caption("Cut it open on an axis, and move the cut", 500);
	await sam.press("X", depth(sam));
	await slideTo(sam, depth(sam).getByRole("slider", { name: "Where the cut is" }), 0.4);
	await expect(depth(sam).getByRole("button", { name: "X", exact: true })).toHaveAttribute("aria-pressed", "true");
	sam.did("depth-cut");

	await sam.caption("Opacity, and how deep it's drawn", 500);
	await slideTo(sam, depth(sam).getByRole("slider", { name: "Opacity" }), 0.5);
	await expect(depth(sam).locator(".depth-panel-slider").filter({ hasText: "Opacity" })).toContainText("50%");
	await slideTo(sam, depth(sam).getByRole("slider", { name: "Depth" }), 2);
	await expect(depth(sam).locator(".depth-panel-slider").filter({ hasText: /^Depth/ })).toContainText("x2");
	sam.did("depth-block-settings");

	await sam.caption("Reset view puts the block back", 500);
	await sam.press("Reset view", depth(sam));
	await sam.press("None", depth(sam));
	sam.did("depth-reset");

	await sam.caption("Mark a box round something that runs through the slices");
	await sam.press("Mark a box", depth(sam));
	// After Reset view the middle of the block is the gap between the liver's
	// two pieces; the lower sheet is just below it.
	const first = { x: middle.x - 60, y: middle.y + 120 };
	const second = { x: middle.x + 70, y: middle.y + 190 };
	await sam.clickAt(first);
	await sam.moveTo(second);
	await sam.pause(600);
	await sam.clickAt(second);
	const form = depth(sam).locator(".depth-panel-marker-form");
	await expect(form).toBeVisible({ timeout: 5_000 });
	await sam.caption("Name it, and set which slices it spans", 500);
	const label = form.locator('input[type="text"]');
	await label.fill("");
	await sam.type(label, "Duct");
	await form.locator('input[type="number"]').nth(0).fill("4");
	await form.locator('input[type="number"]').nth(1).fill("9");
	await sam.pause(400);
	await sam.press("Save", form);
	await expect(form).toHaveCount(0);
	sam.did("depth-marker");

	await sam.caption("In 2D it's only on the slices it spans", 500);
	await open(sam, "Annotations", "Annotations");
	await expect(row(sam.panel("Annotations"), "Duct")).toContainText("3D · slices 4 to 9", { timeout: 10_000 });
	await open(sam, DEPTH, "Depth");
	await sam.press("2D", depth(sam));
	await expect(page.locator(".volume-view")).toHaveCount(0);
	sam.did("depth-marker-flat");
}
