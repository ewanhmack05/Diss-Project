import { expect } from "playwright/test";

export { expect };

export const SLIDE = "003";
export const SLIDE_SIZE = { width: 101832, height: 219976 };

// Where the tissue is on slide 003 before zooming. Zooming keeps the point under
// the pointer still, so aiming here leaves tissue filling the view.
export const TISSUE = { x: 800, y: 330 };
export const TISSUE_NARROW = { x: 480, y: 330 };

// Clear of the panels, which open over the left of the map.
export const MIDDLE = { x: 1000, y: 430 };
export const MIDDLE_NARROW = { x: 720, y: 400 };

export const DOTS = [
	[-90, -60],
	[-30, -85],
	[40, -50],
	[85, -10],
	[20, 15],
	[-55, 25],
	[-100, 60],
	[-10, 75],
	[60, 60],
	[105, 80],
];

export function around(center, dx, dy) {
	return { x: center.x + dx, y: center.y + dy };
}

export async function fillName(person, placeholder, label, notes) {
	await person.type(person.page.getByPlaceholder(placeholder), label);
	if (notes) await person.type(person.page.locator("textarea").first(), notes, 25);
}

export async function saveAnnotation(person, label, notes) {
	await fillName(person, "Name this annotation", label, notes);
	await person.press("Save", person.page.locator(".annotation-form"));
	await person.pause(700);
}

export async function drawPolygon(person, points) {
	for (const point of points) {
		await person.clickAt(point);
		await person.pause(160);
	}
	await person.clickAt(points[0]);
	await person.pause(450);
}

export async function drawTwoClick(person, from, to) {
	await person.clickAt(from);
	await person.pause(130);
	await person.moveTo(to);
	await person.clickAt(to);
	await person.pause(450);
}

export function shape(panel, label) {
	return panel.getByRole("button", { name: label, exact: true });
}

export function savedTabButton(panel, count) {
	return panel.getByRole("button", { name: new RegExp(`^Saved \\(${count}\\)$`) });
}

export async function openSaved(person, panel, count) {
	const tab = savedTabButton(panel, count);
	await expect(tab).toBeVisible({ timeout: 10_000 });
	await person.click(tab);
	return tab;
}

// That someone else's save reached this person, by finding it in their list.
// Not by the tab's count - the live update goes out before the save, so the
// count another person sees can be one behind until the next change.
export async function seesSaved(person, panel, label) {
	await person.pause(800);
	await person.click(panel.getByRole("button", { name: /^Saved/ }));
	await expect(row(panel, label)).toBeVisible({ timeout: 10_000 });
}

export function row(panel, label) {
	return panel.locator(".saved-row-summary").filter({ hasText: label });
}

export async function countDots(person, center, offsets) {
	for (const [dx, dy] of offsets) {
		await person.clickAt(around(center, dx, dy));
		await person.pause(140);
	}
}

export function countLine(panel) {
	return panel.locator(".cell-counter-tool-picker-count-line");
}

export async function closePanel(person, title) {
	await person.press(`Close ${title}`);
}

// A button in whatever dialog is showing.
export async function answerDialog(person, label) {
	const button = person.page.locator(".dialog-actions").getByRole("button", { name: label, exact: true });
	await expect(button).toBeVisible({ timeout: 10_000 });
	await person.pause(700);
	await person.click(button);
}

export function toast(person, text) {
	return person.page.locator(".toast").filter({ hasText: text });
}

export async function answerToast(person, text, label) {
	const found = toast(person, text);
	await expect(found).toBeVisible({ timeout: 10_000 });
	await person.pause(700);
	await person.click(found.getByRole("button", { name: label, exact: true }));
}

export function filters(person) {
	return person.page.getByRole("dialog", { name: "Filters" });
}

export function filterSection(person, title) {
	return filters(person)
		.locator(".saved-filter-section")
		.filter({
			has: person.page.locator(".saved-filter-section-title", { hasText: new RegExp(`^${title}$`) }),
		});
}

export async function dragPanel(person, title, to, stepsEach = 20) {
	const handle = person.panel(title).locator(".draggable-panel-handle");
	const from = await person.center(handle);
	await person.drag([from, around(from, 12, 12), to], { stepsEach, stepMs: 14 });
	await person.pause(400);
}

// The two of them in one session. Returns their Collaboration panels, left open.
export async function startTogether(sam, jo, { maxEditors, policy } = {}) {
	await sam.tool("Collaboration");
	const samPanel = sam.panel("Collaboration");
	if (maxEditors) {
		const cap = samPanel.locator("input[type=number]");
		await sam.click(cap, 150);
		await sam.page.keyboard.press("Control+A");
		await sam.page.keyboard.type(String(maxEditors), { delay: 100 });
	}
	if (policy) await sam.press(policy, samPanel);
	await sam.press("Start a session", samPanel);
	await sam.press("Make a link", samPanel);
	const link = samPanel.getByLabel("Invite link");
	await expect(link).toHaveValue(/invite=/, { timeout: 10_000 });
	const invite = await link.inputValue();

	await jo.tool("Collaboration");
	const joPanel = jo.panel("Collaboration");
	await jo.type(joPanel.getByLabel("Invite code"), invite, 6);
	await jo.press("Join", joPanel);
	await jo.press("Join session");
	await expect(samPanel.getByRole("tab", { name: "Active (2)" })).toBeVisible({ timeout: 15_000 });
	return { samPanel, joPanel, invite };
}

// A GeoJSON file of little squares near the tissue, for importing.
export function geoJsonSquares(count, { name = "Imported", centerX = SLIDE_SIZE.width / 2, centerY = SLIDE_SIZE.height * 0.38 } = {}) {
	const size = 900;
	const columns = Math.ceil(Math.sqrt(count));
	const features = [];
	for (let i = 0; i < count; i++) {
		const x = centerX + (i % columns) * size * 1.6 - (columns * size * 1.6) / 2;
		const y = centerY + Math.floor(i / columns) * size * 1.6 - (columns * size * 1.6) / 2;
		features.push({
			type: "Feature",
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[x, y],
						[x + size, y],
						[x + size, y + size],
						[x, y + size],
						[x, y],
					],
				],
			},
			properties: { label: `${name} ${i + 1}` },
		});
	}
	return { type: "FeatureCollection", name, features };
}
