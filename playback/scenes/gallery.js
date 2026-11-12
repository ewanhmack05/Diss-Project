// Moving between slides - one person, then two.
import { answerDialog, around, closePanel, dragPanel, drawTwoClick, expect, saveAnnotation, shape, TISSUE } from "./helpers.js";

// The order the gallery lists them, and the names the scanner gave them.
const NAMES = { "000": "CMU-1", "001": "25058_Epiderm_AcH3_3", "002": "3D_FL_test01", "003": "003" };

function gallery(person) {
	return person.panel("Gallery");
}

// A card by its slide id - the name, or the id line under a name that isn't it.
function card(person, id) {
	return gallery(person)
		.locator(".gallery-card")
		.filter({ has: person.page.locator(".gallery-card-name, .gallery-card-id", { hasText: new RegExp(`^${id}$`) }) });
}

function tile(person, id) {
	return gallery(person).getByRole("button", { name: new RegExp(`^(Open )?${NAMES[id]}(, open now)?$`) });
}

// The slide the address says. The one the viewer starts on keeps the plain address.
function slideInAddress(person) {
	return new URL(person.page.url()).searchParams.get("slide") ?? "003";
}

async function onSlide(person, id) {
	await expect.poll(() => slideInAddress(person), { timeout: 10_000 }).toBe(id);
	await person.tiles();
}

// The number on a card's collections line - "No collections yet" is 0.
async function collectionsOn(person, id) {
	const line = await card(person, id).locator(".gallery-card-line--work").textContent();
	const match = line.match(/^([\d,]+) collections?$/);
	return match ? Number(match[1].replace(/,/g, "")) : 0;
}

function canvases(person) {
	return person.page.locator("canvas").count();
}

export async function galleryAlone({ sam }) {
	const page = sam.page;
	const { width, height } = page.viewportSize();

	await sam.caption("Gallery: every slide on the tile server, without leaving the page");
	await sam.zoomAt(TISSUE, 1);
	await sam.tool("Gallery");
	const panel = gallery(sam);
	await expect(panel.locator(".gallery-card")).toHaveCount(4, { timeout: 10_000 });
	await expect(card(sam, "003")).toHaveAttribute("aria-current", "true");
	await expect(card(sam, "003")).toContainText("101,832 x 219,976 px");
	await expect(card(sam, "001")).toContainText("Fluorescence · Rhodamine, FITC, UV");

	await sam.caption("Each card has the size, max zoom, real size, kind, file size and what's been done on it", 600);
	const list = panel.locator(".gallery-cards");
	await sam.moveTo(await sam.center(list));
	for (const ticks of [3, 3, -6]) {
		await page.mouse.wheel(0, ticks * 120);
		await sam.pause(900);
	}
	sam.did("gallery-cards");

	await sam.caption("Click one to go there - same map, the whole slide in view, panels stay open");
	const zoomedIn = await sam.zoomLevel();
	const before = await canvases(sam);
	await sam.click(card(sam, "001"));
	await onSlide(sam, "001");
	await expect(card(sam, "001")).toHaveAttribute("aria-current", "true");
	await expect.poll(() => sam.zoomLevel()).not.toBe(zoomedIn);
	expect(await canvases(sam)).toBe(before);
	await expect(panel).toBeVisible();
	await sam.pause(1200);
	sam.did("gallery-move");

	await sam.caption("Work saved here is counted on the slide's card");
	// Others' shared work counts too, so it's one more than before rather than one.
	const collectionsBefore = await collectionsOn(sam, "001");
	await sam.tool("Annotations");
	const annotations = sam.panel("Annotations");
	await sam.click(shape(annotations, "Rectangle"));
	// Round the green patch - slide 001 is a thin strip down the middle.
	await drawTwoClick(sam, { x: 785, y: 330 }, { x: 905, y: 460 });
	await saveAnnotation(sam, "Bright patch");
	await expect.poll(() => collectionsOn(sam, "001"), { timeout: 10_000 }).toBe(collectionsBefore + 1);
	await sam.pause(900);
	sam.did("gallery-collections");
	await closePanel(sam, "Annotations");

	await sam.caption("Filmstrip: just the pictures, with arrows to step along");
	await sam.press("Filmstrip", panel);
	await expect(panel.locator(".gallery-strip--horizontal")).toBeVisible();
	await sam.pause(800);
	await sam.click(panel.getByRole("button", { name: /^Next slide/ }));
	await onSlide(sam, "002");
	await expect(panel.locator(".gallery-ribbon-text")).toHaveText("3 of 4");
	await sam.pause(900);
	sam.did("gallery-filmstrip");

	await sam.caption("Docked down the side it runs down the edge", 500);
	await dragPanel(sam, "Gallery", { x: 8, y: height / 2 });
	await expect(panel.locator(".gallery-strip--vertical")).toBeVisible();
	await sam.pause(700);
	await sam.click(panel.getByRole("button", { name: /^Previous slide/ }));
	await onSlide(sam, "001");
	await sam.pause(900);

	await sam.caption("Along the bottom it runs along it", 500);
	await dragPanel(sam, "Gallery", { x: width / 2, y: height / 2 });
	await dragPanel(sam, "Gallery", { x: width / 2, y: height - 60 });
	await expect(panel.locator(".gallery-strip--horizontal")).toBeVisible();
	await expect(page.locator(".draggable-panel--docked-bottom")).toHaveCount(1);
	await sam.click(tile(sam, "003"));
	await onSlide(sam, "003");
	await sam.pause(900);
	sam.did("gallery-docked");

	await sam.caption("Something not saved yet? It asks first");
	await sam.tool("Annotations");
	// It reopens where it was, which is now partly under the bottom dock.
	await dragPanel(sam, "Annotations", { x: 1300, y: 200 });
	await sam.click(shape(annotations, "Rectangle"));
	await drawTwoClick(sam, around(TISSUE, 120, -100), around(TISSUE, 300, 20));
	const form = page.locator(".annotation-form");
	await expect(form).toBeVisible();
	await sam.click(tile(sam, "000"));
	const dialog = page.getByRole("alertdialog", { name: "Go to slide 000?" });
	await expect(dialog).toContainText("thrown away");
	await sam.pause(1400);
	await sam.caption("Escape stays put, with the drawing still there", 500);
	await page.keyboard.press("Escape");
	await expect(dialog).toHaveCount(0);
	await expect(form).toBeVisible();
	expect(slideInAddress(sam)).toBe("003");
	await sam.pause(900);
	await sam.caption("Go to it throws the drawing away and moves", 400);
	await sam.click(tile(sam, "000"));
	await answerDialog(sam, "Go to it");
	await onSlide(sam, "000");
	await expect(form).toHaveCount(0);
	await sam.pause(900);
	sam.did("gallery-guard");
	await closePanel(sam, "Annotations");

	await sam.caption("The address follows the slide, so back and forward move between them");
	expect(page.url()).toContain("slide=000");
	await page.goBack();
	await onSlide(sam, "003");
	await sam.pause(1100);
	await page.goForward();
	await onSlide(sam, "000");
	await sam.pause(1100);
	sam.did("gallery-address");
}

async function both(sam, jo, samText, joText) {
	await sam.caption(`Sam: ${samText}`, 150, { keepOthers: true });
	await jo.caption(`Jo: ${joText}`, 150, { keepOthers: true });
}

export async function galleryTogether({ sam, jo }) {
	await both(sam, jo, "opens the gallery", "is on the same slide");
	await sam.tool("Gallery");
	await jo.tool("Gallery");
	await expect(card(sam, "003")).toContainText("1 person here now", { timeout: 10_000 });
	await sam.pause(1200);

	await both(sam, jo, "sees Jo arrive on 001", "goes to slide 001");
	await jo.click(card(jo, "001"));
	await onSlide(jo, "001");
	await expect(card(sam, "001")).toContainText("1 person here now", { timeout: 10_000 });
	await expect(card(sam, "003")).not.toContainText("here now");
	await sam.pause(1200);
	sam.did("gallery-people");

	await both(sam, jo, "starts a session on 003 and invites Jo", "gets the invite as a message");
	await sam.tool("Collaboration");
	const samPanel = sam.panel("Collaboration");
	await sam.press("Start a session", samPanel);
	await sam.click(samPanel.getByRole("tab", { name: /^Users/ }));
	await sam.click(samPanel.getByLabel("Invite Jo Bell to your session"));
	await expect(sam.panel("Messages").locator(".messages-card").last()).toBeVisible({ timeout: 10_000 });
	await sam.pause(800);
	await closePanel(sam, "Messages");

	// Out of the way - Messages opens wide, over where it is.
	await closePanel(jo, "Gallery");
	await jo.click(jo.page.locator('[title^="Messages"]'), 700);
	const joInbox = jo.panel("Messages");
	await jo.click(joInbox.locator(".messages-side .messages-row").filter({ hasText: "Sam Reid" }));
	await jo.click(joInbox.getByRole("button", { name: "Have a look" }).last());
	const join = jo.page.getByRole("button", { name: "Join session on slide 003" });
	await expect(join).toBeVisible({ timeout: 10_000 });
	await jo.caption("Jo: it's on another slide, so joining goes there", 1400);
	await jo.click(join);
	await onSlide(jo, "003");
	await expect(samPanel.getByRole("tab", { name: "Active (2)" })).toBeVisible({ timeout: 15_000 });
	await closePanel(jo, "Messages");
	await jo.tool("Gallery");
	await expect(card(jo, "003")).toHaveAttribute("aria-current", "true");
	await jo.pause(1000);
	sam.did("gallery-invite-elsewhere");

	await both(sam, jo, "moves to 002 - it says that means leaving the room", "stays on 003");
	await sam.click(card(sam, "002"));
	const leaving = sam.page.getByRole("alertdialog", { name: "Go to slide 002?" });
	await expect(leaving).toContainText("You're still in it");
	await sam.pause(1400);
	await answerDialog(sam, "Go to it");
	await onSlide(sam, "002");
	await expect(card(jo, "002")).toContainText("1 person here now", { timeout: 10_000 });
	// Left the room, still a member - the session's live on 003.
	await expect(card(sam, "003")).toContainText("1 live session", { timeout: 10_000 });
	await sam.pause(1200);
	sam.did("gallery-leave-session");

	await both(sam, jo, "is on 002 now", "goes after Sam from the Users tab");
	await closePanel(jo, "Gallery");
	await jo.tool("Collaboration");
	const joPanel = jo.panel("Collaboration");
	await jo.click(joPanel.getByRole("tab", { name: /^Users/ }));
	const goThere = joPanel.getByLabel("Open slide 002, where Sam Reid is");
	await expect(goThere).toBeVisible({ timeout: 10_000 });
	await jo.click(goThere);
	await answerDialog(jo, "Go to it");
	await onSlide(jo, "002");
	await expect(card(sam, "002")).toContainText("1 person here now", { timeout: 10_000 });
	await both(sam, jo, "Jo's here too", "on 002 with Sam");
	await sam.pause(1500);
	sam.did("gallery-go-there");
}
