// One person, one video per part of the viewer.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arc, wobblyLoop } from "../lib/motion.js";
import { PASSWORD, PEOPLE } from "../lib/people.js";
import {
	answerDialog,
	answerToast,
	around,
	closePanel,
	countDots,
	countLine,
	DOTS,
	dragPanel,
	drawPolygon,
	drawTwoClick,
	expect,
	fillName,
	filters,
	filterSection,
	geoJsonSquares,
	MIDDLE,
	openSaved,
	row,
	saveAnnotation,
	savedTabButton,
	shape,
	TISSUE,
} from "./helpers.js";

export async function mapNavigation({ sam }) {
	const page = sam.page;
	const scale = page.locator('.ol-scale-bar, .ol-scale-line, [class*="scale"]').first();
	await sam.caption("Moving round the slide");

	await sam.caption("Scroll to zoom, into wherever the pointer is", 700);
	const before = await scale.textContent();
	await sam.zoomAt(TISSUE, 1);
	await expect(scale).not.toHaveText(before);
	sam.did("map-wheel-zoom");
	sam.did("map-scale-bar");

	await sam.caption("Drag to pan", 500);
	await sam.drag([around(MIDDLE, 200, 80), around(MIDDLE, -150, -60)], { stepsEach: 30 });
	await sam.tiles();
	await sam.drag([around(MIDDLE, -150, -60), around(MIDDLE, 200, 80)], { stepsEach: 30 });
	await sam.tiles();
	sam.did("map-pan");

	await sam.caption("Or the + and - buttons", 500);
	const zoomIn = page.locator(".ol-zoom-in");
	const zoomOut = page.locator(".ol-zoom-out");
	await sam.click(zoomIn, 800);
	await sam.click(zoomIn, 800);
	await sam.tiles();
	await sam.click(zoomOut, 800);
	await sam.tiles();
	sam.did("map-zoom-buttons");

	await sam.caption("Double click zooms in", 400);
	const beforeDouble = await scale.textContent();
	await sam.moveTo(MIDDLE);
	await page.mouse.dblclick(MIDDLE.x, MIDDLE.y);
	await sam.pause(900);
	await sam.tiles();
	await expect(scale).not.toHaveText(beforeDouble);
	sam.did("map-double-click");

	await sam.caption("Shift and drag a box to zoom straight to it", 400);
	await sam.click(zoomOut, 700);
	await sam.click(zoomOut, 700);
	await sam.tiles();
	const beforeBox = await scale.textContent();
	await page.keyboard.down("Shift");
	await sam.drag([around(MIDDLE, -120, -80), around(MIDDLE, 120, 80)], { stepsEach: 22 });
	await page.keyboard.up("Shift");
	await sam.pause(800);
	await sam.tiles();
	await expect(scale).not.toHaveText(beforeBox);
	sam.did("map-shift-zoom");

	await sam.caption("Once the map has been clicked, arrow keys pan, and + and - zoom", 500);
	await sam.clickAt(MIDDLE);
	await sam.tiles();
	await sam.pause(400);
	const clip = { x: 500, y: 150, width: 600, height: 500 };
	const beforeKeys = await sam.pixels(clip);
	for (const key of ["ArrowRight", "ArrowRight", "ArrowDown", "ArrowDown"]) {
		await page.keyboard.press(key);
		await sam.pause(320);
	}
	await sam.tiles();
	expect(beforeKeys.equals(await sam.pixels(clip))).toBe(false);
	const beforePlus = await page.locator(".ol-overviewmap-zoom").textContent();
	await page.keyboard.press("+");
	await sam.pause(800);
	await sam.tiles();
	await expect(page.locator(".ol-overviewmap-zoom")).not.toHaveText(beforePlus);
	await page.keyboard.press("-");
	await sam.pause(800);
	await sam.tiles();
	await expect(page.locator(".ol-overviewmap-zoom")).toHaveText(beforePlus);
	sam.did("map-keyboard");

	const box = page.locator(".ol-overviewmap-box");

	await sam.caption("The overview map shows where you are", 900);
	const overview = page.locator(".ol-overviewmap");
	await expect(overview).toBeVisible();
	sam.did("map-overview");

	await sam.caption("It grows when the pointer is over it", 300);
	const small = await page.locator(".ol-overviewmap-map").boundingBox();
	await sam.hover(page.locator(".ol-overviewmap-map"));
	await expect.poll(async () => (await page.locator(".ol-overviewmap-map").boundingBox()).width).toBeGreaterThan(small.width);
	await sam.pause(900);
	sam.did("map-overview-hover");

	await sam.caption("Click it to go straight there", 300);
	const map = await page.locator(".ol-overviewmap-map").boundingBox();
	const startBox = await box.boundingBox();
	await sam.clickAt({ x: map.x + map.width * 0.3, y: map.y + map.height * 0.7 });
	await sam.pause(1200);
	await sam.tiles();
	const movedBox = await box.boundingBox();
	expect(Math.hypot(movedBox.x - startBox.x, movedBox.y - startBox.y)).toBeGreaterThan(3);
	sam.did("map-overview-jump");

	await sam.caption("And it folds away", 300);
	const toggle = page.getByLabel("Toggle overview map");
	await sam.click(toggle, 900);
	await expect(overview).toHaveClass(/ol-collapsed/);
	await sam.click(toggle, 900);
	await expect(overview).not.toHaveClass(/ol-collapsed/);
	sam.did("map-overview-toggle");

	await sam.caption("Alt+Shift and drag turns the slide", 500);
	await page.keyboard.down("Alt");
	await page.keyboard.down("Shift");
	await sam.drag(arc({ x: 800, y: 430 }, 220, -20, 40, 20), { stepsEach: 2, stepMs: 18 });
	await page.keyboard.up("Shift");
	await page.keyboard.up("Alt");
	await sam.pause(900);
	sam.did("map-drag-rotate");

	await sam.caption("Fullscreen, from the toolbar or the F key", 600);
	const fullscreen = () => page.evaluate(() => Boolean(document.fullscreenElement));
	await sam.click(page.locator('[title="Toggle fullscreen (F)"]'), 900);
	await expect.poll(fullscreen).toBe(true);
	await page.keyboard.press("f");
	await expect.poll(fullscreen).toBe(false);
	await sam.pause(700);
	sam.did("map-fullscreen");
}

async function pickCustomColour(person, card) {
	await person.click(card.getByRole("button", { name: /custom/i }).first(), 500);
	const hex = person.page.locator(".rcp-hex-input-single");
	const before = await hex.inputValue();
	const hue = await person.page.locator(".rcp-hue").boundingBox();
	await person.drag(
		[
			{ x: hue.x + hue.width * 0.6, y: hue.y + hue.height / 2 },
			{ x: hue.x + hue.width * 0.1, y: hue.y + hue.height / 2 },
		],
		{ stepsEach: 14 },
	);
	const area = await person.page.locator(".rcp-sat").boundingBox();
	await person.drag(
		[
			{ x: area.x + area.width * 0.9, y: area.y + area.height * 0.1 },
			{ x: area.x + area.width * 0.7, y: area.y + area.height * 0.25 },
		],
		{ stepsEach: 14 },
	);
	await expect(hex).not.toHaveValue(before);
	await person.page.keyboard.press("Escape");
	await person.pause(400);
}

export async function annotations({ sam }) {
	const page = sam.page;
	await sam.caption("Annotations: six shapes, each named and saved");
	await sam.zoomAt(TISSUE, 1);
	await sam.tool("Annotations");
	const panel = sam.panel("Annotations");
	const colourCard = panel.locator(".free-form-tool-picker-colour-card");
	const selects = panel.locator(".free-form-tool-picker-row select");

	await sam.caption("Line - click each end. Redraw throws it away", 500);
	await drawTwoClick(sam, around(MIDDLE, -240, -300), around(MIDDLE, -60, -210));
	await sam.press("Redraw", panel.locator(".annotation-form"));
	await expect(panel.locator(".free-form-tool-picker")).toBeVisible();
	sam.did("draw-redraw");
	await drawTwoClick(sam, around(MIDDLE, -240, -250), around(MIDDLE, -60, -160));
	await saveAnnotation(sam, "A line");
	sam.did("draw-line");

	await sam.caption("Freehand - just drag", 500);
	await sam.click(shape(panel, "Freehand"));
	await sam.drag(wobblyLoop(around(MIDDLE, -40, 190), 75), { stepsEach: 2 });
	await saveAnnotation(sam, "Traced by hand");
	sam.did("draw-freehand");

	await sam.caption("Polygon - and it can be dragged before saving", 500);
	await sam.click(shape(panel, "Polygon"));
	const polygon = [around(MIDDLE, -120, -100), around(MIDDLE, 20, -140), around(MIDDLE, 110, -60), around(MIDDLE, 40, 30), around(MIDDLE, -100, 10)];
	await drawPolygon(sam, polygon);
	await sam.drag([around(MIDDLE, 0, -60), around(MIDDLE, 40, -40)], { stepsEach: 16 });
	sam.did("draw-move-pending");
	await sam.caption("The colour can change on the save form too", 400);
	await sam.click(panel.locator(".annotation-form-colour-card button").first());
	sam.did("draw-form-colour");
	await saveAnnotation(sam, "Example region", "Notes can go with it");
	sam.did("draw-polygon");

	await sam.caption("Arrow, dashed", 500);
	await sam.click(shape(panel, "Arrow"));
	await sam.choose(selects.nth(1), "dashed");
	sam.did("draw-dashed");
	await drawTwoClick(sam, around(MIDDLE, 170, 220), around(MIDDLE, 60, 150));
	await saveAnnotation(sam, "Look here");
	sam.did("draw-arrow");

	await sam.caption("Rectangle, blue, with a thicker line", 500);
	await sam.click(shape(panel, "Rectangle"));
	await sam.choose(selects.nth(1), "solid");
	await sam.choose(selects.nth(0), "5");
	sam.did("draw-thickness");
	await sam.click(colourCard.locator("button").nth(1));
	sam.did("draw-palette");
	await drawTwoClick(sam, around(MIDDLE, 200, -170), around(MIDDLE, 380, -40));
	await saveAnnotation(sam, "Area to review");
	sam.did("draw-rectangle");

	await sam.caption("Circle, in a custom colour", 500);
	await sam.click(shape(panel, "Circle"));
	await pickCustomColour(sam, colourCard);
	sam.did("draw-custom-colour");
	await drawTwoClick(sam, around(MIDDLE, 280, 130), around(MIDDLE, 350, 130));
	await saveAnnotation(sam, "Round area");
	sam.did("draw-circle");

	await sam.caption("Quick draw: every shape saves straight away", 500);
	await sam.click(panel.locator(".free-form-tool-picker-toggle"));
	await sam.type(panel.getByPlaceholder("Used for every shape"), "Quick mark");
	await sam.click(shape(panel, "Rectangle"));
	await drawTwoClick(sam, around(MIDDLE, -300, 80), around(MIDDLE, -240, 140));
	await drawTwoClick(sam, around(MIDDLE, -210, 80), around(MIDDLE, -150, 140));
	await expect(savedTabButton(panel, 8)).toBeVisible({ timeout: 10_000 });
	sam.did("draw-quick");
	await sam.click(panel.locator(".free-form-tool-picker-toggle"));

	await sam.caption("Everything saved is listed", 500);
	await openSaved(sam, panel, 8);
	await expect(panel.locator(".saved-row-summary")).toHaveCount(8);
	sam.did("saved-list");

	await sam.caption("Search", 400);
	const search = panel.getByPlaceholder("Search saved annotations");
	await sam.type(search, "quick");
	await expect(panel.locator(".saved-row-summary")).toHaveCount(2, { timeout: 8000 });
	sam.did("saved-search");
	await search.fill("");
	await expect(panel.locator(".saved-row-summary")).toHaveCount(8, { timeout: 8000 });

	await sam.caption("Filter by shape, colour, person, notes or date", 500);
	await sam.click(panel.locator(".saved-filter-toggle"));
	await sam.click(filterSection(sam, "Shape").getByRole("button", { name: "Circle", exact: true }));
	await expect(panel.locator(".saved-row-summary")).toHaveCount(1, { timeout: 8000 });
	sam.did("saved-filter-shape");
	await sam.press("Clear all", filters(sam));
	sam.did("saved-filter-clear");

	await sam.click(filterSection(sam, "Colour").getByRole("button", { name: /^#0913FB/ }));
	await expect(panel.locator(".saved-row-summary")).toHaveCount(1, { timeout: 8000 });
	sam.did("saved-filter-colour");
	await sam.press("Clear all", filters(sam));

	await sam.click(filterSection(sam, "Saved by").getByRole("button", { name: /^You/ }));
	await expect(panel.locator(".saved-row-summary")).toHaveCount(8, { timeout: 8000 });
	sam.did("saved-filter-person");
	await sam.press("Clear all", filters(sam));

	await sam.press("With", filterSection(sam, "Notes"));
	await expect(panel.locator(".saved-row-summary")).toHaveCount(1, { timeout: 8000 });
	sam.did("saved-filter-notes");
	await sam.press("Clear all", filters(sam));

	const dates = filterSection(sam, "Saved").locator("input[type=date]");
	const today = new Date().toISOString().slice(0, 10);
	await sam.moveTo(await sam.center(dates.first()));
	await dates.first().fill("2020-01-01");
	await dates.nth(1).fill("2020-01-02");
	await expect(panel.locator(".saved-row-summary")).toHaveCount(0, { timeout: 8000 });
	await sam.pause(700);
	await dates.nth(1).fill(today);
	await expect(panel.locator(".saved-row-summary")).toHaveCount(8, { timeout: 8000 });
	sam.did("saved-filter-date");
	await sam.press("Clear all", filters(sam));
	await sam.press("Done", filters(sam));

	await sam.caption("View on map takes you straight to it", 500);
	await sam.click(row(panel, "Example region"));
	await sam.press("View on map", panel);
	await sam.pause(1100);
	await sam.tiles();
	const stop = panel.getByRole("button", { name: "Stop viewing" });
	await expect(stop).toBeVisible();
	await sam.click(stop, 700);
	sam.did("saved-view");

	await sam.caption("Edit: label, notes and colour save as you go", 500);
	await sam.press("Edit", panel);
	const label = panel.locator(".annotation-form-field-card input[type=text]").first();
	await sam.click(label, 150);
	await page.keyboard.press("End");
	await page.keyboard.type(" (checked)", { delay: 45 });
	await sam.click(panel.locator(".annotation-form-colour-card button").nth(4));
	await sam.type(panel.locator("textarea").first(), " - and changed", 30);
	await sam.pause(900);
	await sam.press("Done", panel);
	await expect(row(panel, "Example region (checked)")).toBeVisible({ timeout: 8000 });
	sam.did("saved-edit");

	await sam.caption("And delete from there", 500);
	await sam.click(row(panel, "A line"));
	await sam.press("Edit", panel);
	await sam.click(panel.locator('[data-cy="delete-button"]'));
	await expect(panel.locator(".saved-row-summary")).toHaveCount(7, { timeout: 8000 });
	sam.did("saved-delete");
	await sam.pause(900);
}

export async function annotationGroups({ sam }) {
	const page = sam.page;
	await sam.caption("Selecting many at once, and groups");
	await sam.zoomAt(TISSUE, 1);
	await sam.tool("Annotations");
	const panel = sam.panel("Annotations");

	await sam.click(panel.locator(".free-form-tool-picker-toggle"));
	await sam.type(panel.getByPlaceholder("Used for every shape"), "Mark", 30);
	await sam.click(shape(panel, "Rectangle"));
	const columns = [880, 1040, 1200];
	const rows = [290, 470];
	for (const y of rows) {
		for (const x of columns) await drawTwoClick(sam, { x, y }, { x: x + 100, y: y + 100 });
	}
	await expect(savedTabButton(panel, 6)).toBeVisible({ timeout: 10_000 });
	await sam.click(panel.locator(".free-form-tool-picker-toggle"));

	await sam.click(panel.getByRole("button", { name: "Select", exact: true }));
	const count = panel.locator(".select-count").first();
	await expect(count).toHaveText("Nothing picked");

	await sam.caption("Box: drag round them", 500);
	await sam.drag(
		[
			{ x: 850, y: 260 },
			{ x: 1330, y: 420 },
		],
		{ stepsEach: 24 },
	);
	await expect(count).toHaveText("3 annotations picked");
	sam.did("select-box");

	await sam.caption("Shift adds to what's picked", 500);
	await page.keyboard.down("Shift");
	await sam.drag(
		[
			{ x: 850, y: 450 },
			{ x: 1000, y: 600 },
		],
		{ stepsEach: 20 },
	);
	await page.keyboard.up("Shift");
	await expect(count).toHaveText("4 annotations picked");
	sam.did("select-shift");

	await sam.caption("Clicking a shape puts it in or takes it out", 500);
	await sam.clickAt({ x: 1090, y: 520 });
	await sam.pause(400);
	await expect(count).toHaveText("5 annotations picked");
	await sam.clickAt({ x: 1090, y: 520 });
	await sam.pause(400);
	await expect(count).toHaveText("4 annotations picked");
	sam.did("select-click");

	await sam.caption("Esc clears it", 500);
	await page.keyboard.press("Escape");
	await expect(count).toHaveText("Nothing picked");
	sam.did("select-escape");

	await sam.caption("Hold Space and drag to move the map without picking", 500);
	// The overview recentres on the view, so its box can't show a small move. The map itself can.
	const clip = { x: 700, y: 100, width: 400, height: 300 };
	const beforeSpace = await sam.pixels(clip);
	await page.keyboard.down("Space");
	await sam.drag(
		[
			{ x: 1100, y: 700 },
			{ x: 1040, y: 660 },
		],
		{ stepsEach: 14 },
	);
	await page.keyboard.up("Space");
	await sam.pause(500);
	const afterSpace = await sam.pixels(clip);
	expect(beforeSpace.equals(afterSpace)).toBe(false);
	await expect(count).toHaveText("Nothing picked");
	await page.keyboard.down("Space");
	await sam.drag(
		[
			{ x: 1040, y: 660 },
			{ x: 1100, y: 700 },
		],
		{ stepsEach: 14 },
	);
	await page.keyboard.up("Space");
	await sam.pause(500);
	sam.did("select-move-map");

	await sam.caption("Lasso: draw round them", 500);
	await sam.press("Lasso", panel);
	await sam.drag(
		arc({ x: 1170, y: 340 }, 190, 0, 360, 36).map((p) => ({ x: p.x, y: 340 + (p.y - 340) * 0.7 })),
		{ stepsEach: 2 },
	);
	await expect(count).toHaveText("2 annotations picked");
	sam.did("select-lasso");

	await sam.caption("All, and Clear", 500);
	await sam.press("All", panel);
	await expect(count).toHaveText("6 annotations picked");
	await sam.press("Clear", panel);
	await expect(count).toHaveText("Nothing picked");
	sam.did("select-all-clear");
	await sam.press("Box", panel);

	await sam.caption("Recolour everything picked", 500);
	await sam.drag(
		[
			{ x: 850, y: 260 },
			{ x: 1330, y: 420 },
		],
		{ stepsEach: 20 },
	);
	await sam.click(panel.locator(".select-section").filter({ hasText: "Colour" }).locator("button").nth(4));
	await sam.press("Recolour 3 annotations", panel);
	await sam.pause(700);
	sam.did("select-recolour");

	await sam.caption("Make a group from them", 500);
	await sam.type(panel.getByLabel("New group name"), "Top row");
	await sam.press("Group 3", panel);
	await expect(panel.locator(".select-group").filter({ hasText: "Top row" })).toBeVisible({ timeout: 8000 });
	sam.did("group-new");

	await sam.press("Clear", panel);
	await sam.drag(
		[
			{ x: 850, y: 450 },
			{ x: 1170, y: 600 },
		],
		{ stepsEach: 20 },
	);
	await sam.type(panel.getByLabel("New group name"), "Bottom row");
	await sam.press("Group 2", panel);
	await expect(panel.locator(".select-group").filter({ hasText: "Bottom row" })).toBeVisible({ timeout: 8000 });
	await sam.press("Clear", panel);

	await sam.caption("Add more to a group", 500);
	await sam.drag(
		[
			{ x: 1180, y: 450 },
			{ x: 1330, y: 600 },
		],
		{ stepsEach: 20 },
	);
	const bottom = panel.locator(".select-group").filter({ hasText: "Bottom row" });
	await sam.press("Add 1", bottom);
	await expect(bottom.locator(".select-group-count")).toHaveText("3", { timeout: 8000 });
	sam.did("group-add");

	await sam.caption("Or take them back out", 500);
	await sam.click(panel.getByRole("button", { name: /out of their groups/ }));
	await expect(bottom.locator(".select-group-count")).toHaveText("2", { timeout: 8000 });
	sam.did("group-take-out");
	await sam.press("Clear", panel);

	await sam.caption("Hide a group, and show it again", 500);
	await sam.click(panel.getByLabel("Hide Top row"));
	await sam.pause(1100);
	await sam.click(panel.getByLabel("Show Top row"));
	await sam.pause(700);
	sam.did("group-hide");

	await sam.caption("Pick everything in one", 500);
	await sam.press("Select", panel.locator(".select-group").filter({ hasText: "Top row" }));
	await expect(count).toHaveText("3 annotations picked");
	sam.did("group-select");
	await sam.press("Clear", panel);

	await sam.caption("Each group has its own page", 500);
	await sam.click(panel.locator(".select-group-name").filter({ hasText: "Top row" }));
	const nameBox = panel.getByLabel("Group name");
	await sam.click(nameBox, 150);
	await page.keyboard.press("End");
	await page.keyboard.type(" of marks", { delay: 45 });
	await page.keyboard.press("Enter");
	await sam.pause(500);
	sam.did("group-rename");
	await sam.type(panel.getByLabel("Group notes"), "What this group is for", 30);
	await sam.pause(900);
	sam.did("group-notes");
	await sam.click(panel.locator(".select-section").filter({ hasText: "Colour" }).locator("button").nth(2));
	await sam.press("Recolour 3 annotations", panel);
	await sam.pause(800);
	sam.did("group-recolour");

	await sam.caption("Merge it into another", 500);
	await sam.choose(panel.getByLabel("Merge into"), { label: "Bottom row" });
	await sam.press("Merge", panel.locator(".select-section").filter({ hasText: "Merge" }));
	await answerDialog(sam, "Merge");
	const merged = panel.locator(".select-group").filter({ hasText: "Bottom row" });
	await expect(merged.locator(".select-group-count")).toHaveText("5", { timeout: 8000 });
	sam.did("group-merge");

	await sam.caption("Saved can filter by group", 500);
	await sam.click(panel.getByRole("button", { name: /^Saved/ }));
	await sam.click(panel.locator(".saved-filter-toggle"));
	await sam.click(filterSection(sam, "Group").getByRole("button", { name: /^Bottom row/ }));
	await expect(panel.locator(".saved-row-summary")).toHaveCount(5, { timeout: 8000 });
	sam.did("saved-filter-group");
	await sam.press("Clear all", filters(sam));
	await sam.press("Done", filters(sam));
	await sam.click(panel.getByRole("button", { name: "Select", exact: true }));

	await sam.caption("Delete everything in a group - with a chance to undo", 500);
	await sam.click(panel.locator(".select-group-name").filter({ hasText: "Bottom row" }));
	await sam.click(panel.getByRole("button", { name: /^Delete its 5/ }));
	await answerDialog(sam, "Delete");
	await answerToast(sam, "Deleted 5 annotations", "Undo");
	await expect(panel.locator(".select-count").first()).toHaveText("5 annotations", { timeout: 8000 });
	sam.did("group-delete-members");

	await sam.caption("Or delete the group and keep what's in it", 500);
	await sam.press("Delete the group, keep its annotations", panel);
	await answerDialog(sam, "Delete group");
	await expect(panel.locator(".select-group")).toHaveCount(0, { timeout: 8000 });
	sam.did("group-delete");

	await sam.caption("Deleting what's picked can be undone too", 500);
	await sam.press("All", panel);
	await sam.click(panel.getByRole("button", { name: /^Delete 6 annotations/ }));
	await answerDialog(sam, "Delete");
	await answerToast(sam, "Deleted 6 annotations", "Undo");
	await sam.press("All", panel);
	await expect(count).toHaveText("6 annotations picked", { timeout: 8000 });
	sam.did("select-delete-undo");
	await sam.pause(800);
}

export async function cellCounter({ sam }) {
	const page = sam.page;
	await sam.caption("Cell counter: click each cell, and it keeps the tally");
	await sam.zoomAt(TISSUE, 2);
	await sam.tool("Cell Count");
	const panel = sam.panel("Cell Count");

	await sam.caption("Pick a dot size and start", 500);
	await sam.choose(panel.locator(".cell-counter-tool-picker-field-card select"), "10");
	sam.did("count-dot-size");
	await sam.press("Start counting", panel);
	await countDots(sam, MIDDLE, DOTS.slice(0, 5));
	await expect(countLine(panel)).toContainText("Count 5");
	sam.did("count-dots");

	await sam.caption("Colours can change part way through", 500);
	await sam.click(panel.locator(".cell-counter-tool-picker-colour-card button").first());
	await countDots(sam, MIDDLE, DOTS.slice(5));
	await expect(countLine(panel)).toContainText("Count 10");
	sam.did("count-colour");
	await expect(panel.locator(".cell-counter-tool-picker-history-row")).toHaveCount(10);
	sam.did("count-history");

	await sam.caption("Undo and redo, with the buttons", 500);
	await sam.press("Undo", panel);
	await sam.press("Undo", panel);
	await expect(countLine(panel)).toContainText("Count 8");
	await sam.press("Redo", panel);
	await expect(countLine(panel)).toContainText("Count 9");
	sam.did("count-undo-redo");

	await sam.caption("or the Z and Y keys", 500);
	await page.keyboard.press("z");
	await expect(countLine(panel)).toContainText("Count 8");
	await sam.pause(500);
	await page.keyboard.press("y");
	await expect(countLine(panel)).toContainText("Count 9");
	await sam.pause(500);
	sam.did("count-keys");

	await sam.caption("Recount throws it away and starts again", 500);
	await sam.press("Stop counting", panel);
	await sam.press("Recount", panel.locator(".cell-count-form"));
	await expect(panel.getByRole("button", { name: "Start counting" })).toBeVisible();
	sam.did("count-recount");

	await sam.press("Start counting", panel);
	await countDots(sam, MIDDLE, DOTS);
	await sam.press("Stop counting", panel);
	await fillName(sam, "Name this count", "Example count", "Notes can go with it");
	await sam.press("Save", panel.locator(".cell-count-form"));
	await sam.pause(700);

	await sam.caption("Without annotation it's just a tally", 500);
	await sam.click(panel.getByLabel("With annotation"));
	await sam.press("Start counting", panel);
	await countDots(sam, around(MIDDLE, 100, 60), DOTS.slice(0, 4));
	await expect(panel.locator(".cell-counter-tool-picker-tally-big")).toHaveText("4");
	sam.did("count-no-annotation");
	await sam.pause(600);
	await sam.press("Stop counting", panel);
	await fillName(sam, "Name this count", "Tally only");
	await sam.press("Save", panel.locator(".cell-count-form"));
	await sam.pause(700);
	await sam.click(panel.getByLabel("With annotation"));

	await sam.caption("Or inside a region of interest, in microns", 500);
	await sam.click(panel.getByLabel("With region of interest"));
	await sam.choose(panel.getByLabel("Box size"), "250");
	await sam.press("Start counting", panel);
	await sam.pause(1200);
	await sam.tiles();
	await sam.caption("Cancel backs out of placing it", 500);
	await sam.press("Cancel", panel);
	await expect(panel.getByRole("button", { name: "Start counting" })).toBeVisible();
	sam.did("count-roi-cancel");

	await sam.choose(panel.getByLabel("Box size"), "500");
	await sam.press("Start counting", panel);
	await sam.pause(1200);
	await sam.tiles();
	await sam.caption("Drag the box into place and confirm", 500);
	await sam.drag(
		[
			{ x: 800, y: 430 },
			{ x: 900, y: 450 },
		],
		{ stepsEach: 20 },
	);
	sam.did("count-roi-drag");
	await sam.press("Confirm placement", panel);
	await countDots(
		sam,
		{ x: 900, y: 450 },
		DOTS.slice(0, 6).map(([x, y]) => [x / 2, y / 2]),
	);
	await expect(countLine(panel)).toContainText("Count 6");
	sam.did("count-roi");
	await sam.press("Stop counting", panel);
	await fillName(sam, "Name this count", "Region count");
	await sam.press("Save", panel.locator(".cell-count-form"));
	await sam.pause(700);

	await sam.caption("Saved counts", 500);
	await openSaved(sam, panel, 3);
	await expect(panel.locator(".saved-row-summary")).toHaveCount(3);
	sam.did("count-saved");

	await sam.caption("Search and filter them", 500);
	const search = panel.getByPlaceholder("Search saved counts");
	await sam.type(search, "region");
	await expect(panel.locator(".saved-row-summary")).toHaveCount(1, { timeout: 8000 });
	sam.did("count-search");
	await search.fill("");
	await expect(panel.locator(".saved-row-summary")).toHaveCount(3, { timeout: 8000 });
	await sam.click(panel.locator(".saved-filter-toggle"));
	await sam.press("With", filterSection(sam, "Region of interest"));
	await expect(panel.locator(".saved-row-summary")).toHaveCount(1, { timeout: 8000 });
	sam.did("count-filter");
	await sam.press("Clear all", filters(sam));
	await sam.press("Done", filters(sam));

	await sam.caption("Back on the map, dots and all", 500);
	await sam.click(row(panel, "Example count"));
	await sam.press("View on map", panel);
	await sam.pause(1500);
	await sam.tiles();
	const hide = panel.getByRole("button", { name: "Hide from map" });
	await expect(hide).toBeVisible();
	await sam.pause(1000);
	await sam.click(hide, 700);
	sam.did("count-view");

	await sam.caption("Label and notes can be edited", 500);
	await sam.press("Edit", panel);
	const label = panel.locator(".cell-count-form-field-card input[type=text]").first();
	await sam.click(label, 150);
	await page.keyboard.press("End");
	await page.keyboard.type(" (checked)", { delay: 45 });
	await sam.pause(900);
	await sam.press("Done", panel);
	await expect(row(panel, "Example count (checked)")).toBeVisible({ timeout: 8000 });
	sam.did("count-edit");

	await sam.caption("A count has its own timeline too", 500);
	await sam.press("History", panel);
	await expect(panel.getByRole("heading", { name: /History of/ })).toBeVisible({ timeout: 8000 });
	await sam.pause(1300);
	await sam.click(panel.locator(".history-back"));
	await expect(panel.locator(".saved-row-summary")).toHaveCount(3, { timeout: 8000 });
	sam.did("count-timeline");

	await sam.caption("And deleted", 500);
	await sam.click(row(panel, "Tally only"));
	await sam.press("Edit", panel);
	await sam.click(panel.locator('[data-cy="delete-button"]'));
	await expect(panel.locator(".saved-row-summary")).toHaveCount(2, { timeout: 8000 });
	sam.did("count-delete");
	await sam.pause(800);
}

export async function rotation({ sam }) {
	await sam.caption("Rotation: quick buttons, typing a value, or dragging the dial");
	await sam.tool("Rotate image");
	const panel = sam.panel("Rotate");
	const degrees = panel.locator(".rotation-panel-readout input");

	await sam.press("+15°", panel);
	await sam.press("+90°", panel);
	await sam.tiles();
	await expect(degrees).toHaveValue("105");
	await sam.press("-15°", panel);
	await sam.press("-90°", panel);
	await expect(degrees).toHaveValue("0");
	sam.did("rotate-buttons");
	await sam.press("+90°", panel);
	await sam.pause(700);

	const box = await panel.locator(".rotation-panel-dial").boundingBox();
	const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	await sam.caption("Dragging the dial turns the slide live");
	await sam.drag(arc(center, box.width * 0.38, 0, 200, 40), { stepsEach: 2, stepMs: 20 });
	await sam.tiles();
	await expect(degrees).not.toHaveValue("90");
	sam.did("rotate-dial");

	await sam.caption("Typing an exact angle");
	// Selected first - the box reads 0 when empty, so clearing it then typing gives 045.
	await sam.click(degrees, 150);
	await sam.page.keyboard.press("Control+A");
	await sam.page.keyboard.type("45", { delay: 120 });
	await expect(degrees).toHaveValue("45");
	await sam.tiles();
	await sam.pause(800);
	sam.did("rotate-typed");

	await sam.caption("Reset goes back to upright");
	await sam.press("Reset", panel);
	await expect(degrees).toHaveValue("0");
	await sam.pause(900);
	sam.did("rotate-reset");
}

export async function ruler({ sam }) {
	await sam.caption("Ruler: click two points to measure a real distance");
	await sam.zoomAt(TISSUE, 1);
	await sam.tool("Measure distance");
	const panel = sam.panel("Ruler");
	const readout = panel.locator(".ruler-panel-readout");
	await expect(readout).toHaveText("-");

	await drawTwoClick(sam, around(MIDDLE, -200, -120), around(MIDDLE, 180, 60));
	await expect(readout).toHaveText(/\d.*(µm|mm)/);
	const first = await readout.textContent();
	await sam.pause(1200);
	sam.did("ruler-measure");

	await sam.caption("A new measurement replaces the last one");
	await drawTwoClick(sam, around(MIDDLE, 240, 120), around(MIDDLE, 240, -160));
	await expect(readout).not.toHaveText(first);
	await sam.pause(1200);
	sam.did("ruler-replace");

	await sam.press("Clear", panel);
	await expect(readout).toHaveText("-");
	await sam.pause(700);
	sam.did("ruler-clear");
}

export async function imageAdjustments({ sam }) {
	await sam.caption("Image adjustments: change how the slide looks, and keep it as a preset");
	await sam.zoomAt(TISSUE, 1);
	await sam.tool("Adjustments");
	const panel = sam.panel("Adjustments");
	const slider = (label) => panel.locator(".adjustments-panel-slider").filter({ hasText: label });
	const value = (label) => slider(label).locator(".adjustments-panel-slider-value");
	const settings = [
		["Brightness", 0.25, "0.00"],
		["Contrast", 0.4, "0.00"],
		["Gamma", 1.4, "1.00"],
		["Red", 1.4, "1.00"],
		["Green", 0.8, "1.00"],
		["Blue", 0.7, "1.00"],
	];

	for (const [label, target, start] of settings) {
		await sam.slide(slider(label).locator("input"), target);
		await expect(value(label)).not.toHaveText(start);
	}
	await sam.pause(900);
	sam.did("adjust-sliders");

	await sam.caption("Saved as a preset");
	await sam.type(panel.getByPlaceholder("Preset name"), "High contrast");
	await sam.press("Save", panel.locator(".adjustments-panel-save-row"));
	const preset = panel.locator(".adjustments-panel-preset-row").filter({ hasText: "High contrast" });
	await expect(preset).toBeVisible({ timeout: 10_000 });
	const saved = await value("Contrast").textContent();
	sam.did("adjust-preset-save");

	await sam.caption("Reset takes it back to the slide as it is");
	await sam.press("Reset", panel.locator(".adjustments-panel-sliders-card"));
	await expect(value("Contrast")).toHaveText("0.00");
	await sam.pause(1100);
	sam.did("adjust-reset");

	await sam.caption("Apply brings the preset back in one click");
	await sam.press("Apply", preset);
	await expect(value("Contrast")).toHaveText(saved);
	await sam.pause(1200);
	sam.did("adjust-preset-apply");

	await sam.caption("Update saves new values over it");
	await sam.slide(slider("Contrast").locator("input"), 0.1);
	const changed = await value("Contrast").textContent();
	await sam.press("Update", preset);
	await sam.pause(700);
	await sam.press("Reset", panel.locator(".adjustments-panel-sliders-card"));
	await sam.press("Apply", preset);
	await expect(value("Contrast")).toHaveText(changed);
	await sam.pause(900);
	sam.did("adjust-preset-update");

	await sam.caption("And Delete removes it");
	await sam.press("Delete", preset);
	await expect(preset).toHaveCount(0, { timeout: 8000 });
	await sam.pause(800);
	sam.did("adjust-preset-delete");
}

export async function tabDocking({ sam }) {
	const page = sam.page;
	const { width, height } = page.viewportSize();
	await sam.caption("Panels float, or dock to any edge of the window");
	await sam.tool("Measure distance");
	await sam.tool("Rotate image");
	await sam.tool("Adjustments");

	await sam.caption("Move a floating panel by its title", 500);
	await dragPanel(sam, "Rotate", { x: 800, y: 300 });
	await dragPanel(sam, "Ruler", { x: 860, y: 340 });
	sam.did("panel-float");

	await sam.caption("Clicking one brings it to the front", 500);
	const layer = (title) => sam.panel(title).evaluate((panel) => Number(panel.style.zIndex));
	await sam.click(sam.panel("Rotate").locator(".draggable-panel-header"), 800);
	expect(await layer("Rotate")).toBeGreaterThan(await layer("Ruler"));
	sam.did("panel-front");

	await sam.caption("Drag to the left edge to dock it", 500);
	await dragPanel(sam, "Adjustments", { x: 8, y: height / 2 });
	await expect(page.locator(".draggable-panel--docked-left")).toHaveCount(1);
	sam.did("dock-left");

	await sam.caption("Then the right", 500);
	await dragPanel(sam, "Rotate", { x: width - 8, y: height / 2 });
	await expect(page.locator(".draggable-panel--docked-right")).toHaveCount(1);
	sam.did("dock-right");

	await sam.caption("Two on one edge share it", 500);
	await dragPanel(sam, "Ruler", { x: width - 8, y: height - 200 });
	await expect(page.locator(".draggable-panel--docked-right")).toHaveCount(2);
	sam.did("dock-share");
	await sam.pause(800);

	await sam.caption("Pull one away and it floats again", 500);
	await dragPanel(sam, "Adjustments", { x: width / 2, y: height / 2 });
	await expect(page.locator(".draggable-panel--docked-left")).toHaveCount(0);
	sam.did("dock-undock");

	await sam.caption("The top edge lays it out wide", 500);
	await dragPanel(sam, "Adjustments", { x: width / 2, y: 6 });
	await expect(page.locator(".draggable-panel--docked-top")).toHaveCount(1);
	sam.did("dock-top");
	await sam.pause(800);

	await sam.caption("And the bottom", 500);
	await dragPanel(sam, "Adjustments", { x: width / 2, y: height - 60 });
	await expect(page.locator(".draggable-panel--docked-bottom")).toHaveCount(1);
	sam.did("dock-bottom");
	await sam.pause(800);

	await sam.caption("Closing the bottom one gives its space back to the sides", 500);
	await dragPanel(sam, "Ruler", { x: 8, y: 300 });
	await expect(page.locator(".draggable-panel--docked-left")).toHaveCount(1);
	const bottomOf = async (selector) => {
		const box = await page.locator(selector).first().boundingBox();
		return box.y + box.height;
	};
	const toolbarTop = (await page.locator(".toolbar").boundingBox()).y;
	const scaleBar = ".ol-scalebar";
	const raised = await bottomOf(scaleBar);
	expect(await bottomOf(".dock-edge--right:not(.dock-edge--probe)")).toBeLessThan(toolbarTop - 100);
	await sam.pause(800);
	await closePanel(sam, "Adjustments");
	await expect(sam.panel("Adjustments")).toHaveCount(0);
	await expect.poll(() => bottomOf(".dock-edge--right:not(.dock-edge--probe)")).toBeCloseTo(toolbarTop, 0);
	await expect.poll(() => bottomOf(".dock-edge--left:not(.dock-edge--probe)")).toBeCloseTo(toolbarTop, 0);
	expect(await bottomOf(scaleBar)).toBeGreaterThan(raised + 100);
	await sam.pause(1200);
	sam.did("dock-close-fills");

	await sam.caption("Open it again and it goes back where it was", 500);
	await sam.tool("Adjustments");
	await expect(page.locator(".draggable-panel--docked-bottom")).toHaveCount(1);
	await expect.poll(() => bottomOf(".dock-edge--right:not(.dock-edge--probe)")).toBeLessThan(toolbarTop - 100);
	await sam.pause(1000);
	sam.did("dock-reopen");

	await sam.caption("Close from the panel, or its toolbar button", 500);
	await closePanel(sam, "Adjustments");
	await expect(sam.panel("Adjustments")).toHaveCount(0);
	await sam.tool("Rotate image");
	await expect(sam.panel("Rotate")).toHaveCount(0);
	await sam.tool("Measure distance");
	await expect(sam.panel("Ruler")).toHaveCount(0);
	sam.did("panel-close");
	await sam.pause(700);

	// A top dock is wide and short, so each panel has to lay itself out sideways.
	for (const [tool, title] of [
		["Annotations", "Annotations"],
		["Cell Count", "Cell Count"],
		["Rotate image", "Rotate"],
		["Measure distance", "Ruler"],
		["Adjustments", "Adjustments"],
		["Collaboration", "Collaboration"],
		["Collections", "Collections"],
	]) {
		// Said first, or the last one's caption is still up while this one opens.
		await sam.caption(`${title}, across the top`, 0);
		await sam.tool(tool);
		await dragPanel(sam, title, { x: width / 2, y: 6 }, 6);
		const docked = page.locator(".draggable-panel--docked-top");
		await expect(docked).toHaveCount(1);
		const dockedAt = Date.now();
		await expect(docked.locator(".draggable-panel-title")).toHaveText(title);
		expect((await docked.boundingBox()).width).toBe(width);
		// Five seconds on screen, measured from the video. The drop settling before
		// this line and the click after it take the other 1.5.
		const close = sam.button(`Close ${title}`);
		await sam.moveTo(await sam.center(close));
		await sam.pause(Math.max(0, 3500 - (Date.now() - dockedAt)));
		await sam.click(close, 0);
		await expect(docked).toHaveCount(0);
	}
	sam.did("dock-top-every-tab");
	await sam.pause(500);
}

export async function collections({ sam }) {
	const page = sam.page;
	await sam.caption("Collections: everything of yours on this slide");
	await sam.tool("Collections");
	const panel = sam.panel("Collections");

	await sam.caption("Rename it", 500);
	await sam.click(panel.getByLabel("Rename your collection"));
	const nameBox = panel.getByLabel("Collection name");
	await page.keyboard.press("Control+A").catch(() => {});
	await nameBox.fill("");
	await sam.type(nameBox, "Slide review");
	await page.keyboard.press("Enter");
	await expect(panel.getByText("Slide review")).toBeVisible({ timeout: 8000 });
	sam.did("collection-rename");

	await sam.caption("Let others look at it, read only", 500);
	const share = panel.getByLabel("Let others view it");
	await sam.click(panel.locator(".collections-toggle"));
	await expect(share).toBeChecked({ timeout: 8000 });
	await expect(panel.getByText("Shared - anyone signed in can view it")).toBeVisible();
	sam.did("collection-share");
	await sam.click(panel.locator(".collections-toggle"));
	await expect(share).not.toBeChecked({ timeout: 8000 });

	await sam.caption("Import GeoJSON, with a look at what's in it first", 500);
	const file = join(tmpdir(), "playback-import.geojson");
	writeFileSync(file, JSON.stringify(geoJsonSquares(60)));
	const chooser = page.waitForEvent("filechooser");
	await sam.press("Import", panel);
	await (await chooser).setFiles(file);
	await expect(panel.getByRole("heading", { name: "Import GeoJSON" })).toBeVisible({ timeout: 8000 });
	await sam.pause(1500);
	await sam.press("Import", panel.locator(".collections-button-row"));
	await expect(panel.getByRole("heading", { name: "Import GeoJSON" })).toHaveCount(0, { timeout: 15_000 });
	sam.did("collection-import");

	await sam.caption("Export it as GeoJSON", 500);
	const download = page.waitForEvent("download");
	await sam.press("Export", panel);
	const saved = await download;
	expect(saved.suggestedFilename()).toMatch(/\.(geo)?json$/);
	sam.did("collection-export");
	await sam.pause(900);

	await sam.caption("A long list goes page by page", 500);
	await sam.zoomAt(TISSUE, 1);
	await sam.tool("Annotations");
	const annotationsPanel = sam.panel("Annotations");
	await openSaved(sam, annotationsPanel, 60);
	await expect(annotationsPanel.locator(".saved-row-summary")).toHaveCount(50, { timeout: 8000 });
	await sam.click(annotationsPanel.getByLabel("Next page"));
	await expect(annotationsPanel.locator(".saved-row-summary")).toHaveCount(10, { timeout: 8000 });
	await sam.click(annotationsPanel.getByLabel("Previous page"));
	await expect(annotationsPanel.locator(".saved-row-summary")).toHaveCount(50, { timeout: 8000 });
	sam.did("saved-pager");
	await sam.pause(900);
}

export async function history({ sam }) {
	await sam.caption("History: every change is kept");
	await sam.zoomAt(TISSUE, 1);
	await sam.tool("Annotations");
	const panel = sam.panel("Annotations");

	await drawTwoClick(sam, around(MIDDLE, -150, -80), around(MIDDLE, 120, 60));
	await saveAnnotation(sam, "First one");
	await drawTwoClick(sam, around(MIDDLE, -150, 100), around(MIDDLE, 120, 240));
	await saveAnnotation(sam, "Keep this one");

	await sam.caption("Change one, then delete it by accident", 500);
	await openSaved(sam, panel, 2);
	await sam.click(row(panel, "First one"));
	await sam.press("Edit", panel);
	const label = panel.locator(".annotation-form-field-card input[type=text]").first();
	await sam.click(label, 150);
	await sam.page.keyboard.press("End");
	await sam.page.keyboard.type(" edited", { delay: 45 });
	await sam.pause(900);
	await sam.press("Done", panel);
	await expect(row(panel, "First one edited")).toBeVisible({ timeout: 8000 });

	await sam.click(row(panel, "Keep this one"));
	await sam.press("Edit", panel);
	await sam.click(panel.locator('[data-cy="delete-button"]'));
	await expect(row(panel, "Keep this one")).toHaveCount(0, { timeout: 10_000 });
	await sam.pause(700);

	await sam.caption("It's all in the collection's history", 500);
	await sam.tool("Collections");
	const collections = sam.panel("Collections");
	// Beside the Annotations panel, not over its list.
	await dragPanel(sam, "Collections", { x: 560, y: 60 });
	await sam.click(collections.getByRole("tab", { name: "History" }));
	const rows = collections.locator(".history-row");
	await expect(rows.first()).toBeVisible({ timeout: 8000 });
	sam.did("history-list");

	await sam.caption("Newest or oldest first", 500);
	await sam.click(collections.getByLabel("Newest first - show oldest first"));
	await expect(collections.getByLabel("Oldest first - show newest first")).toBeVisible();
	await sam.pause(700);
	await sam.click(collections.getByLabel("Oldest first - show newest first"));
	sam.did("history-order");

	await sam.caption("Filter by kind of change", 500);
	const all = await rows.count();
	await sam.click(collections.locator(".saved-filter-toggle").first());
	await sam.click(filterSection(sam, "Kind").locator(".saved-filter-chip").filter({ hasText: /delet/i }).first());
	await expect.poll(() => rows.count()).toBeLessThan(all);
	sam.did("history-filter");
	await sam.press("Clear all", filters(sam));
	await sam.press("Done", filters(sam));

	await sam.caption("Open a change to see what it did", 500);
	await sam.click(rows.filter({ hasText: /delet/i }).first());
	await expect(collections.getByRole("button", { name: "Put back" })).toBeVisible({ timeout: 8000 });
	sam.did("history-detail");
	await sam.pause(1100);

	await sam.caption("Put back brings it straight back", 500);
	await sam.press("Put back", collections);
	await expect(row(panel, "Keep this one")).toHaveCount(1, { timeout: 10_000 });
	sam.did("history-put-back");
	await sam.pause(900);

	await sam.caption("One annotation has its own timeline", 500);
	await sam.click(row(panel, "First one edited"));
	await sam.press("History", panel);
	await expect(panel.getByRole("heading", { name: /History of/ })).toBeVisible({ timeout: 8000 });
	await sam.pause(1100);
	await sam.caption("And it can go back to any point on it", 500);
	await sam.click(panel.getByRole("button", { name: "Go back to this" }).first());
	await sam.press("Go back to this", panel.locator(".collections-button-row"));
	await expect(panel.getByRole("heading", { name: /History of First one$/ })).toBeVisible({ timeout: 10_000 });
	sam.did("history-item");
	await sam.pause(900);

	await sam.caption("Or put the whole collection back to a moment", 500);
	const back = collections.locator(".history-back");
	if (await back.count()) await sam.click(back.first());
	const refreshed = collections.locator(".history-row");
	await expect(refreshed.first()).toBeVisible({ timeout: 8000 });
	await sam.click(refreshed.filter({ hasText: /add/i }).last());
	await sam.press("Put whole collection back to here…", collections);
	const go = collections.getByRole("button", { name: "Put it all back" });
	await expect(go).toBeVisible({ timeout: 10_000 });
	await sam.pause(1300);
	await sam.click(go);
	await expect(sam.page.locator(".toast").filter({ hasText: "Put the collection back" })).toBeVisible({ timeout: 10_000 });
	sam.did("history-rollback");
	await sam.pause(1200);
}

export async function signingIn({ visitor }, { url }) {
	const page = visitor.page;
	const logIn = async (person) => {
		await page.locator("#username").waitFor();
		await visitor.type(page.locator("#username"), person.username);
		await visitor.type(page.locator("#password"), PASSWORD, 90);
		await visitor.click(page.locator("#kc-login"));
		await page.locator("[data-testid=toolbar]").waitFor({ timeout: 20_000 });
		await visitor.tiles();
	};

	await page.goto(`${url}/`);
	await visitor.caption("Signing in, through Keycloak", 600);
	await logIn(PEOPLE.sam);
	visitor.did("account-sign-in");

	await visitor.caption("Who you are is in the Collaboration panel", 500);
	await visitor.tool("Collaboration");
	const panel = visitor.panel("Collaboration");
	await expect(panel.getByText("Signed in as")).toBeVisible();
	await visitor.pause(1000);

	await visitor.caption("Switch user asks for the password again - the icon picks another account", 500);
	await visitor.press("Switch user", panel);
	const another = page.locator("#reset-login");
	await expect(another).toBeVisible({ timeout: 15_000 });
	await visitor.pause(1300);
	await visitor.click(another);
	await logIn(PEOPLE.jo);
	await visitor.tool("Collaboration");
	await expect(visitor.panel("Collaboration").locator(".realtime-signed-in")).toContainText("Jo Bell", { timeout: 8000 });
	await visitor.pause(1100);
	visitor.did("account-switch");

	await visitor.caption("Sign out ends it", 500);
	await visitor.press("Sign out", visitor.panel("Collaboration"));
	await expect(page.locator("[data-testid=toolbar]")).toHaveCount(0, { timeout: 15_000 });
	await visitor.pause(1500);
	visitor.did("account-sign-out");
}
