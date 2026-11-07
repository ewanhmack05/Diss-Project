// More than one person, side by side.
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
	toast,
	fillName,
	MIDDLE_NARROW as MIDDLE,
	openSaved,
	row,
	saveAnnotation,
	savedTabButton,
	seesSaved,
	shape,
	startTogether,
	TISSUE_NARROW as TISSUE,
} from "./helpers.js";

// The viewer's default colour, which anything drawn without picking one gets.
const SAVED_YELLOW = [249, 224, 6];

async function both(sam, jo, samText, joText) {
	await sam.caption(`Sam: ${samText}`, 150, { keepOthers: true });
	await jo.caption(`Jo: ${joText}`, 150, { keepOthers: true });
}

// Everything done live between two people, in the order someone would meet it.
export async function collaboration({ sam, jo }) {
	await both(sam, jo, "starts a session", "on the same slide, working alone");
	await sam.zoomAt(TISSUE, 1);
	await jo.zoomAt(TISSUE, 1);

	const { samPanel, joPanel } = await startTogether(sam, jo);
	sam.did("session-start");
	sam.did("session-link");
	sam.did("session-join-link");

	await both(sam, jo, "sees Jo join", "is in - a chip each for who's here");
	const joChip = sam.page.locator(".presence-chip--other").filter({ hasText: "Jo Bell" });
	await expect(joChip).toBeVisible({ timeout: 10_000 });
	await expect(jo.page.locator(".presence-chip--other").filter({ hasText: "Sam Reid" })).toBeVisible({ timeout: 10_000 });
	sam.did("live-presence");

	await closePanel(jo, "Collaboration");
	await both(sam, jo, "can see where Jo is looking", "moves round on their own");
	const samZoom = await sam.zoomLevel();
	const samBox = await sam.page.locator(".ol-overviewmap-box").boundingBox();
	await sam.seesChange(() => jo.drag([around(MIDDLE, 100, 60), around(MIDDLE, -100, -60)], { stepsEach: 26 }));
	await jo.tiles();
	sam.did("live-viewports");
	// Jo moved, and Sam's own view stayed where it was.
	expect(await sam.zoomLevel()).toBe(samZoom);
	const samBoxAfter = await sam.page.locator(".ol-overviewmap-box").boundingBox();
	expect(Math.hypot(samBoxAfter.x - samBox.x, samBoxAfter.y - samBox.y)).toBeLessThan(1);
	sam.did("nav-free");

	await sam.caption("Sam: hovering a chip picks Jo out, clicking turns the outline off", 300);
	await sam.moveTo(await sam.center(joChip));
	await expect(joChip).toHaveClass(/presence-chip--pointed/, { timeout: 5000 });
	await sam.pause(1000);
	sam.did("live-point");
	await sam.click(joChip, 800);
	await expect(joChip).toHaveAttribute("aria-pressed", "false");
	await sam.click(joChip, 800);
	await expect(joChip).toHaveAttribute("aria-pressed", "true");

	await sam.caption("Sam: the Active tab lists who's in right now", 300);
	await sam.click(samPanel.getByRole("tab", { name: "Active (2)" }));
	await expect(samPanel.locator(".realtime-person-name").filter({ hasText: "Jo Bell" }).first()).toBeVisible();
	await sam.pause(1200);
	sam.did("session-active");
	await sam.click(samPanel.getByRole("tab", { name: /^Session/ }));

	// Annotations
	await both(sam, jo, "draws a shape", "sees it live, before it's saved");
	await jo.drag([around(MIDDLE, -100, -60), around(MIDDLE, 100, 60)], { stepsEach: 16 });
	await jo.tiles();
	await sam.tool("Annotations");
	await jo.tool("Annotations");
	const samAnnotations = sam.panel("Annotations");
	const joAnnotations = jo.panel("Annotations");
	await sam.click(shape(samAnnotations, "Polygon"));
	await jo.seesChange(() =>
		drawPolygon(sam, [around(MIDDLE, -90, -120), around(MIDDLE, 90, -100), around(MIDDLE, 130, 60), around(MIDDLE, -40, 140)]),
	);
	sam.did("live-draw");
	await saveAnnotation(sam, "Shared region");
	await seesSaved(jo, joAnnotations, "Shared region");
	sam.did("live-saved");

	await both(sam, jo, "opens it to edit", "opens the same one - both can type at once");
	await openSaved(sam, samAnnotations, 1);
	await sam.click(row(samAnnotations, "Shared region"));
	await jo.click(row(joAnnotations, "Shared region"));
	await sam.press("Edit", samAnnotations);
	await jo.press("Edit", joAnnotations);
	const samNotes = samAnnotations.locator("textarea").first();
	const joNotes = joAnnotations.locator("textarea").first();
	await sam.type(samNotes, "Sam typing here. ", 40);
	await jo.click(joNotes, 150);
	await jo.page.keyboard.press("End");
	await jo.page.keyboard.type("And Jo here.", { delay: 40 });
	await expect(samNotes).toHaveValue(/Sam typing here\..*And Jo here\./s, { timeout: 8000 });
	await expect(samAnnotations.locator(".editing-with")).toBeVisible({ timeout: 8000 });
	sam.did("live-shared-typing");

	await both(sam, jo, "recolours it", "sees the colour change");
	await jo.seesChange(() => sam.click(samAnnotations.locator(".annotation-form-colour-card button").nth(1), 1000));
	sam.did("live-colour");
	await sam.press("Done", samAnnotations);
	await jo.press("Done", joAnnotations);
	await closePanel(sam, "Annotations");
	await closePanel(jo, "Annotations");

	// Cell counts
	await both(sam, jo, "counts cells", "sees nothing yet - a count is private until it's saved");
	await sam.tool("Cell Count");
	await jo.tool("Cell Count");
	const samCount = sam.panel("Cell Count");
	const joCount = jo.panel("Cell Count");
	await sam.press("Start counting", samCount);
	await jo.seesNoChange(() => countDots(sam, around(MIDDLE, 40, -160), DOTS.slice(0, 7)));
	await expect(countLine(samCount)).toContainText("Count 7");
	sam.did("live-count-private");
	await jo.pause(700);
	await sam.press("Stop counting", samCount);
	await fillName(sam, "Name this count", "Sam's count");
	await sam.press("Save", samCount.locator(".cell-count-form"));
	await seesSaved(jo, joCount, "Sam's count");
	await closePanel(sam, "Cell Count");
	await closePanel(jo, "Cell Count");

	// Ruler
	await both(sam, jo, "measures something", "sees the ruler too");
	await sam.tool("Measure distance");
	const samRuler = sam.panel("Ruler");
	await jo.seesChange(() => drawTwoClick(sam, around(MIDDLE, -120, 180), around(MIDDLE, 150, 240)));
	await expect(samRuler.locator(".ruler-panel-readout")).toHaveText(/\d/);
	await sam.pause(1500);
	sam.did("live-ruler");
	await closePanel(sam, "Ruler");

	// Asking
	await both(sam, jo, "moves, then asks Jo to look", "gets asked, and can say yes or no");
	await sam.zoomAt(MIDDLE, 1);
	await sam.click(sam.page.locator(".presence-look"));
	const lookingFrom = await jo.zoomLevel();
	expect(lookingFrom).not.toBe(await sam.zoomLevel());
	await answerToast(jo, "wants you to look", "Go");
	await expect.poll(() => jo.zoomLevel()).toBe(await sam.zoomLevel());
	await jo.pause(900);
	await jo.tiles();
	sam.did("nav-look-here");

	await both(sam, jo, "asks Jo to open a tab", "chooses to open it");
	await sam.click(samPanel.getByRole("tab", { name: "Active (2)" }));
	await sam.caption("Sam: can pick one person, or ask everyone", 300);
	const who = samPanel.locator(".realtime-field").filter({ hasText: "Who" }).locator("select");
	await sam.choose(who, { label: "Jo Bell" });
	sam.did("nav-ask-one");
	await sam.choose(samPanel.getByLabel("Open a tab"), "ruler");
	await answerToast(jo, "asks you to open", "Open");
	await expect(jo.panel("Ruler")).toBeVisible();
	await jo.pause(700);
	sam.did("nav-open-tab");
	await closePanel(jo, "Ruler");
	await sam.click(samPanel.getByRole("tab", { name: /^Session/ }));

	// Follow
	await both(sam, jo, "turns on Follow me", "gets taken along");
	await sam.press("Follow me", samPanel);
	const following = jo.page.locator(".presence-chip--leading");
	await expect(following).toContainText("Following Sam Reid", { timeout: 10_000 });
	await jo.seesChange(() => sam.drag([around(MIDDLE, 80, 200), around(MIDDLE, -60, 60)], { stepsEach: 24 }));
	await sam.zoomAt(MIDDLE, -1);
	await expect.poll(() => jo.zoomLevel()).toBe(await sam.zoomLevel());
	await jo.tiles();
	sam.did("nav-follow");

	await both(sam, jo, "turns the slide", "turns with it");
	await sam.tool("Rotate image");
	const samRotate = sam.panel("Rotate");
	await jo.seesChange(async () => {
		await sam.press("+15°", samRotate);
		await sam.press("+15°", samRotate);
	});
	await jo.pause(1200);
	await jo.tiles();
	sam.did("live-rotation");
	await sam.press("Reset", samRotate);
	await closePanel(sam, "Rotate");

	await both(sam, jo, "keeps going", "can step out with Stop");
	await jo.click(following.getByRole("button", { name: "Stop" }));
	await expect(following).toContainText("Sam Reid is leading", { timeout: 8000 });
	await jo.drag([around(MIDDLE, 60, 120), around(MIDDLE, -60, 40)], { stepsEach: 20 });
	await jo.tiles();
	await sam.caption("Sam: moves on regardless", 200);
	await sam.drag([around(MIDDLE, -40, 180), around(MIDDLE, 40, 80)], { stepsEach: 20 });
	await sam.tiles();
	await jo.caption("Jo: Follow goes back to Sam", 200);
	await jo.click(following.getByRole("button", { name: "Follow" }));
	await expect(following).toContainText("Following Sam Reid", { timeout: 8000 });
	await jo.pause(900);
	await jo.tiles();
	sam.did("nav-follow-break");

	// Present
	await both(sam, jo, "switches to Present", "sees Sam's screen and can't move away");
	await sam.press("Present", samPanel);
	await expect(following).toContainText("Sam Reid is presenting", { timeout: 10_000 });
	await sam.tiles();
	const restingAt = jo.at;
	await jo.seesNoChange(async () => {
		await jo.drag([around(MIDDLE, 90, 90), around(MIDDLE, -90, -90)], { stepsEach: 20 });
		// The click focused the map, so the keyboard is locked out too.
		for (const key of ["ArrowRight", "ArrowDown", "+"]) {
			await jo.page.keyboard.press(key);
			await jo.pause(280);
		}
		await jo.moveTo(restingAt);
	});
	sam.did("nav-present");

	await both(sam, jo, "opens a panel", "gets the same panel");
	await sam.tool("Annotations");
	const samPresent = sam.panel("Annotations");
	await expect(jo.panel("Annotations")).toBeVisible({ timeout: 10_000 });
	await sam.pause(700);
	await both(sam, jo, "changes tab", "follows to the same tab");
	await sam.click(samPresent.getByRole("button", { name: /^Saved/ }));
	await expect(jo.panel("Annotations").locator(".annotations-panel-tab--active")).toContainText("Saved", { timeout: 10_000 });
	sam.did("nav-present-panels");
	await sam.pause(700);
	await closePanel(sam, "Annotations");

	await both(sam, jo, "counts while presenting", "sees every dot and the tally as they go");
	await sam.tool("Cell Count");
	const presentCount = sam.panel("Cell Count");
	await expect(jo.panel("Cell Count")).toBeVisible({ timeout: 10_000 });
	await sam.press("Start counting", presentCount);
	await jo.seesChange(() => countDots(sam, { x: 810, y: 330 }, DOTS.slice(0, 5)));
	await expect(following).toContainText("counting 5", { timeout: 10_000 });
	sam.did("live-count");
	await sam.pause(1200);
	await sam.press("Stop counting", presentCount);
	await sam.press("Recount", presentCount.locator(".cell-count-form"));
	await closePanel(sam, "Cell Count");

	await both(sam, jo, "turns the brightness up", "sees it the way Sam does");
	await sam.tool("Adjustments");
	const samAdjust = sam.panel("Adjustments");
	const joAdjust = jo.panel("Adjustments");
	const joBrightness = joAdjust.locator(".adjustments-panel-slider").filter({ hasText: "Brightness" }).locator(".adjustments-panel-slider-value");
	await expect(joAdjust).toBeVisible({ timeout: 10_000 });
	await sam.slide(samAdjust.locator(".adjustments-panel-slider").filter({ hasText: "Brightness" }).locator("input"), 0.3);
	await expect(joBrightness).not.toHaveText("0.00", { timeout: 10_000 });
	await sam.slide(samAdjust.locator(".adjustments-panel-slider").filter({ hasText: "Contrast" }).locator("input"), 0.3);
	await sam.pause(1200);

	await both(sam, jo, "goes back to Free", "gets their own view and colours back");
	await sam.press("Free", samPanel);
	await expect(following).toHaveCount(0, { timeout: 10_000 });
	await jo.pause(900);
	// The toolbar button toggles, and Present's panels may have stayed open.
	if (!(await joAdjust.isVisible())) await jo.tool("Adjustments");
	await expect(joBrightness).toHaveText("0.00", { timeout: 10_000 });
	await jo.pause(1200);
	sam.did("live-adjustments");
}

async function zoomBoth(sam, jo) {
	await sam.zoomAt(TISSUE, 2);
	await jo.zoomAt(TISSUE, 2);
}

export async function countingTogether({ sam, jo }) {
	await both(sam, jo, "runs a comparison", "gets invited");
	await zoomBoth(sam, jo);
	await startTogether(sam, jo);
	await closePanel(sam, "Collaboration");
	await closePanel(jo, "Collaboration");
	await sam.tool("Cell Count");
	await jo.tool("Cell Count");
	const samPanel = sam.panel("Cell Count");
	const joPanel = jo.panel("Cell Count");
	const samLine = countLine(samPanel);
	const joLine = countLine(joPanel);
	const spot = { x: 720, y: 400 };

	await sam.caption("Sam: everyone counts the same region, then they're compared", 300);
	await expect(samPanel.getByRole("button", { name: "Comparison" })).toBeEnabled({ timeout: 10_000 });
	await sam.press("Comparison", samPanel);
	const confirm = samPanel.getByRole("button", { name: "Confirm placement" });
	if (await confirm.isVisible().catch(() => false)) await sam.press("Confirm placement", samPanel);
	const joInvite = joPanel.locator(".comparison-invite");
	await expect(joInvite).toContainText("wants everyone to count", { timeout: 10_000 });
	await jo.pause(1000);
	await jo.press("Join", joInvite);
	sam.did("compare-invite");

	await both(sam, jo, "counts - can't see Jo's dots", "counts - can't see Sam's dots");
	await countDots(sam, spot, DOTS.slice(0, 6));
	await countDots(jo, spot, [...DOTS.slice(0, 4), [130, -80], [-130, 100]]);
	await expect(samLine).toContainText("Count 6");
	await expect(joLine).toContainText("Count 6");
	sam.did("compare-count");

	await both(sam, jo, "hands in", "still counting");
	await sam.press("Hand in count", samPanel);
	await expect(samPanel.locator(".comparison-state--submitted").first()).toBeVisible({ timeout: 10_000 });
	await sam.pause(1400);
	sam.did("compare-waiting");

	await both(sam, jo, "sees the results once Jo's in", "hands in");
	await jo.press("Hand in count", joPanel);
	await expect(samPanel.locator(".comparison-figure").first()).toContainText("agreement", { timeout: 15_000 });
	await expect(joPanel.locator(".comparison-figure").first()).toContainText("agreement", { timeout: 15_000 });
	await sam.pause(2500);
	sam.did("compare-results");

	await both(sam, jo, "saves their count", "is done with it");
	await jo.press("Done", joPanel);
	await sam.press("Save my count", samPanel);
	const saveForm = samPanel.locator(".cell-count-form");
	await expect(saveForm).toBeVisible({ timeout: 10_000 });
	await fillName(sam, "Name this count", "From the comparison");
	await sam.press("Save", saveForm);
	await expect(savedTabButton(samPanel, 1)).toBeVisible({ timeout: 10_000 });
	sam.did("compare-save");
	await sam.pause(800);

	await both(sam, jo, "asks again", "can say no");
	await expect(samPanel.getByRole("button", { name: "Comparison" })).toBeEnabled({ timeout: 10_000 });
	await sam.press("Comparison", samPanel);
	if (await confirm.isVisible().catch(() => false)) await sam.press("Confirm placement", samPanel);
	await expect(joInvite).toBeVisible({ timeout: 10_000 });
	await jo.pause(700);
	await jo.press("Decline", joInvite);
	await expect(joInvite).toHaveCount(0, { timeout: 8000 });
	await sam.pause(700);
	const leave = samPanel.getByRole("button", { name: "Leave comparison" });
	await sam.click(leave);
	await sam.pause(700);

	await both(sam, jo, "starts a shared count", "everyone adds to one tally");
	await expect(samPanel.getByRole("button", { name: "Shared count" })).toBeEnabled({ timeout: 10_000 });
	await sam.press("Shared count", samPanel);
	if (await confirm.isVisible().catch(() => false)) await sam.press("Confirm placement", samPanel);
	await expect(joInvite).toContainText("started a shared count", { timeout: 10_000 });
	await jo.pause(800);
	await jo.press("Join", joInvite);
	sam.did("shared-invite");

	await both(sam, jo, "adds dots", "adds dots, and sees Sam's");
	await countDots(sam, spot, DOTS.slice(0, 4));
	await countDots(jo, spot, DOTS.slice(5, 9));
	await expect(samPanel.locator(".cell-counter-tool-picker-count-line")).toContainText("Total 8", { timeout: 10_000 });
	sam.did("shared-tally");

	await both(sam, jo, "sees a ring when two people count one cell", "clicks a cell Sam already did");
	await countDots(jo, spot, DOTS.slice(0, 1));
	await expect(samPanel.getByText(/same cell counted twice/)).toBeVisible({ timeout: 10_000 });
	await sam.pause(1700);
	sam.did("shared-double");

	await both(sam, jo, "keeps their dots", "undo only takes back Jo's own");
	await jo.press("Undo", joPanel);
	await expect(samPanel.locator(".cell-counter-tool-picker-count-line")).toContainText("Total 8", { timeout: 10_000 });
	await expect(joPanel.locator(".cell-counter-tool-picker-count-line")).toContainText("yours 4", { timeout: 10_000 });
	sam.did("shared-undo");
	await sam.pause(800);

	await both(sam, jo, "still has Jo's dots", "can leave, and their dots stay");
	await jo.press("Leave", joPanel);
	await expect(samPanel.locator(".comparison-counter").filter({ hasText: "Jo Bell" })).toContainText("left", { timeout: 10_000 });
	await expect(samPanel.locator(".cell-counter-tool-picker-count-line")).toContainText("Total 8");
	await sam.pause(1100);
	sam.did("shared-leave");

	await both(sam, jo, "finishes and saves it", "sees it saved, with who counted what");
	await sam.press("Finish and save", samPanel);
	const form = samPanel.locator(".cell-count-form");
	await expect(form).toBeVisible({ timeout: 10_000 });
	await fillName(sam, "Name this count", "Counted together");
	await sam.press("Save", form);
	await seesSaved(jo, joPanel, "Counted together");
	await jo.click(row(joPanel, "Counted together"));
	await sam.pause(1800);
	sam.did("shared-save");
}

export async function sessionAdmin({ sam, jo }) {
	await both(sam, jo, "shares their own collection", "can look at it, read only");
	await sam.tool("Collections");
	const samCollections = sam.panel("Collections");
	await sam.click(samCollections.locator(".collections-toggle"));
	await expect(samCollections.getByLabel("Let others view it")).toBeChecked({ timeout: 8000 });
	await jo.tool("Collections");
	const joCollections = jo.panel("Collections");
	await jo.page.reload();
	await jo.page.locator("[data-testid=toolbar]").waitFor();
	await jo.tiles();
	// The reload took Jo's caption with it.
	await jo.caption("Jo: can look at it, read only", 150, { keepOthers: true });
	await jo.zoomAt(TISSUE, 1);
	await sam.zoomAt(TISSUE, 1);
	await jo.tool("Collections");
	await jo.click(joCollections.getByRole("tab", { name: /^Shared/ }));
	const samsRow = joCollections.locator(".collections-list li").filter({ hasText: "Sam Reid" });
	await jo.press("View", samsRow);
	await expect(joCollections.getByText("read-only", { exact: false }).first()).toBeVisible({ timeout: 8000 });
	await jo.pause(1000);
	await jo.press("Back to mine", joCollections);
	sam.did("collection-view-other");
	await closePanel(sam, "Collections");
	await closePanel(jo, "Collections");

	await sam.caption("Sam: a cap of 1 editor, and first change wins", 300);
	await sam.tool("Collaboration");
	const samPanel = sam.panel("Collaboration");
	const cap = samPanel.locator("input[type=number]");
	await sam.click(cap, 150);
	await sam.page.keyboard.press("Control+A");
	await sam.page.keyboard.type("1", { delay: 100 });
	await sam.press("First change wins", samPanel);
	await sam.press("Start a session", samPanel);
	sam.did("session-start");

	await sam.caption("Sam: renames it", 300);
	await sam.click(samPanel.getByLabel("Rename session"));
	const title = samPanel.getByLabel("Session name");
	await title.fill("");
	await sam.type(title, "Review");
	await sam.page.keyboard.press("Enter");
	await expect(samPanel.getByRole("heading", { name: "Review" })).toBeVisible({ timeout: 8000 });
	sam.did("session-rename");

	await sam.caption("Sam: makes a link, then its settings", 300);
	await sam.press("Make a link", samPanel);
	await expect(samPanel.getByLabel("Invite link")).toHaveValue(/invite=/, { timeout: 8000 });
	await sam.click(samPanel.getByRole("button", { name: "Copy" }).first());
	const code = await samPanel.getByLabel("Invite code").inputValue();
	expect(await sam.page.evaluate(() => navigator.clipboard.readText())).toContain(code);
	sam.did("session-link");

	await sam.click(samPanel.getByRole("tab", { name: "Settings" }));
	await sam.press("View only", samPanel);
	await expect(samPanel.getByRole("button", { name: "View only" })).toHaveAttribute("aria-pressed", "true");
	await sam.press("Edit", samPanel);
	await sam.choose(samPanel.locator("select").first(), "1");
	await sam.press("Stop this link", samPanel);
	await expect(samPanel.getByText("No working link")).toBeVisible({ timeout: 8000 });
	sam.did("session-settings");
	await sam.click(samPanel.getByRole("tab", { name: /^Session/ }));
	await sam.press("Make a link", samPanel);
	await expect(samPanel.getByLabel("Invite link")).toHaveValue(/invite=/, { timeout: 8000 });

	await both(sam, jo, "invites Jo from the Users tab", "gets it as a message, and has a look");
	await sam.click(samPanel.getByRole("tab", { name: /^Users/ }));
	await sam.click(samPanel.getByLabel("Invite Jo Bell to your session"));
	const samInvite = sam.panel("Messages").locator(".messages-card").filter({ hasText: "Review" }).last();
	await expect(samInvite).toBeVisible({ timeout: 10_000 });
	// Fails if it's covered - the click that opened it brings the Collaboration panel forward.
	await samInvite.click({ trial: true, timeout: 5000 });
	await sam.pause(1200);
	await dragPanel(sam, "Messages", { x: 700, y: 70 });
	// Asking again with the conversation open shows up in it straight away.
	const samInvites = sam.panel("Messages").locator(".messages-card").filter({ hasText: "Review" });
	const sentSoFar = await samInvites.count();
	await sam.click(samPanel.getByLabel("Invite Jo Bell to your session"));
	await expect(samInvites).toHaveCount(sentSoFar + 1, { timeout: 10_000 });
	await closePanel(sam, "Messages");
	// Nothing pops up on Jo - it's an unread message.
	await expect(jo.page.getByText("invited you to their session")).toHaveCount(0);
	await jo.click(jo.page.locator('[title^="Messages"]'), 700);
	const joInbox = jo.panel("Messages");
	await jo.click(joInbox.locator(".messages-side .messages-row").filter({ hasText: "Sam Reid" }));
	await jo.click(joInbox.getByRole("button", { name: "Have a look" }).last());
	sam.did("session-invite-user");

	await jo.caption("Jo: past the cap, so it's view only", 300);
	const joinGate = jo.page.getByRole("button", { name: "Join session" });
	await expect(joinGate).toBeVisible({ timeout: 10_000 });
	await jo.pause(1400);
	await jo.click(joinGate);
	await closePanel(jo, "Messages");
	sam.did("session-cap");

	await jo.tool("Annotations");
	const joAnnotations = jo.panel("Annotations");
	await expect(joAnnotations.getByRole("button", { name: "Free Form" })).toHaveCount(0, { timeout: 10_000 });
	await expect(joAnnotations.getByRole("button", { name: "Groups" })).toBeVisible();
	await jo.pause(1200);
	sam.did("session-view-only");
	await closePanel(jo, "Annotations");

	await both(sam, jo, "lets Jo edit", "can edit now");
	await sam.click(samPanel.getByRole("tab", { name: "Active (2)" }));
	await sam.choose(samPanel.getByLabel("What Jo Bell can do"), "editor");
	await jo.tool("Annotations");
	await expect(joAnnotations.getByRole("button", { name: "Free Form" })).toBeVisible({ timeout: 10_000 });
	sam.did("session-roles");

	await both(sam, jo, "draws one to change", "waits for it");
	await sam.tool("Annotations");
	const samAnnotations = sam.panel("Annotations");
	await sam.click(shape(samAnnotations, "Rectangle"));
	await drawTwoClick(sam, { x: 620, y: 300 }, { x: 860, y: 420 });
	await saveAnnotation(sam, "Both changing this");
	await seesSaved(jo, joAnnotations, "Both changing this");
	await openSaved(sam, samAnnotations, 1);
	await sam.click(row(samAnnotations, "Both changing this"));
	await jo.click(row(joAnnotations, "Both changing this"));
	await sam.press("Edit", samAnnotations);
	await jo.press("Edit", joAnnotations);

	await both(sam, jo, "recolours at the same moment as Jo", "recolours - someone will get there first");
	const useMine = (person) => person.page.locator(".toast").getByRole("button", { name: "Use mine" });
	const collided = async () => (await useMine(sam).count()) + (await useMine(jo).count()) > 0;
	// Two clicks can land either side of the other's update arriving, so a few goes.
	for (let round = 0; round < 4 && !(await collided()); round++) {
		const samSwatch = samAnnotations.locator(".annotation-form-colour-card button").nth(1 + round);
		const joSwatch = joAnnotations.locator(".annotation-form-colour-card button").nth(4 + round);
		await sam.moveTo(await sam.center(samSwatch));
		await jo.moveTo(await jo.center(joSwatch));
		await Promise.all([samSwatch.click(), joSwatch.click()]);
		await sam.pause(1500);
	}
	await expect.poll(collided, { timeout: 5000 }).toBe(true);
	const loser = (await useMine(sam).count()) > 0 ? sam : jo;
	await loser.caption(`${loser === sam ? "Sam" : "Jo"}: was second, so gets the choice`, 1400);
	await loser.click(loser.page.getByRole("button", { name: "Keep theirs" }));
	sam.did("policy-first-wins");
	await sam.press("Done", samAnnotations);
	await jo.press("Done", joAnnotations);
	await closePanel(sam, "Annotations");
	await closePanel(jo, "Annotations");

	await both(sam, jo, "takes Jo out", "is told, and goes back to their own work");
	await sam.click(samPanel.getByLabel("Take Jo Bell out of the session"));
	await answerDialog(jo, "OK");
	await expect(samPanel.getByRole("tab", { name: "Active (1)" })).toBeVisible({ timeout: 10_000 });
	sam.did("session-remove");

	await sam.caption("Sam: leaves - nobody's in it, so it goes quiet", 300);
	await sam.tool("Collections");
	const collections = sam.panel("Collections");
	// Beside the Collaboration panel, not over it.
	await dragPanel(sam, "Collections", { x: 620, y: 60 });
	await sam.press("Back to mine", collections);
	await sam.click(collections.getByRole("tab", { name: /^Shared/ }));
	await sam.pause(1200);
	await sam.caption("Sam: only the host can reopen it", 300);
	const session = collections.locator(".collections-list li").filter({ hasText: "Review" });
	await sam.press("Reopen", session);
	await expect(collections.getByText("Showing").first()).toBeVisible({ timeout: 10_000 });
	sam.did("session-reopen");

	await both(sam, jo, "lets Jo back in with a new link", "joins, then leaves for good");
	await sam.click(samPanel.getByRole("tab", { name: /^Session/ }));
	const link = samPanel.getByLabel("Invite link");
	await expect(link).toHaveValue(/invite=/, { timeout: 10_000 });
	const invite = await link.inputValue();
	await jo.tool("Collaboration");
	const joPanel = jo.panel("Collaboration");
	await jo.click(joPanel.getByRole("tab", { name: /^Session/ }));
	await jo.type(joPanel.getByLabel("Invite code"), invite, 6);
	await jo.press("Join", joPanel);
	await jo.click(jo.page.getByRole("button", { name: /^(Join session|Open session)$/ }));
	await expect(samPanel.getByRole("tab", { name: "Active (2)" })).toBeVisible({ timeout: 15_000 });
	await jo.pause(800);
	await closePanel(jo, "Collaboration");
	await jo.tool("Collections");
	const joList = jo.panel("Collections");
	await jo.click(joList.getByRole("tab", { name: /^Shared/ }));
	await jo.press("Leave", joList.locator(".collections-list li").filter({ hasText: "Review" }));
	await answerDialog(jo, "Leave");
	await expect(joList.locator(".collections-list li").filter({ hasText: "Review" })).toHaveCount(0, { timeout: 10_000 });
	sam.did("session-leave");

	await sam.caption("Sam: ends it - it stays to look back at, read only", 300);
	await sam.press("End session", samPanel);
	await sam.press("End session", samPanel.locator(".realtime-confirm"));
	await expect(samPanel.getByText(/read-only/).first()).toBeVisible({ timeout: 10_000 });
	sam.did("session-end");
	await sam.tool("Annotations");
	await expect(sam.panel("Annotations").getByRole("button", { name: "Free Form" })).toHaveCount(0, { timeout: 10_000 });
	await sam.pause(1100);
	sam.did("session-ended");
	await closePanel(sam, "Annotations");

	await sam.caption("Sam: an ended session can be deleted", 300);
	await sam.press("Back to working on my own", samPanel);
	await sam.click(collections.getByRole("tab", { name: /^Shared/ }));
	const ended = collections.locator(".collections-list li").filter({ hasText: "Review" });
	await sam.press("Delete", ended);
	await answerDialog(sam, "Delete");
	await expect(ended).toHaveCount(0, { timeout: 10_000 });
	sam.did("session-delete");
	await sam.pause(900);
}

export async function guests({ sam, guest }) {
	// Nothing open yet, so their side of the video says why it's empty.
	await guest.page.evaluate(() => {
		document.documentElement.style.background = "#222";
		document.body.style.cssText = "color:#bbb;font:600 22px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0";
		document.body.textContent = "Someone with no account, waiting for a link";
	});
	await sam.caption("Sam: makes a link for someone with no account", 300);
	await sam.zoomAt(TISSUE, 1);
	await sam.tool("Collaboration");
	const samPanel = sam.panel("Collaboration");
	await sam.press("Start a session", samPanel);
	await sam.press("Make a link", samPanel);
	const link = samPanel.getByLabel("Invite link");
	await expect(link).toHaveValue(/invite=/, { timeout: 10_000 });

	await guest.page.goto(await link.inputValue());
	const name = guest.page.locator("#guest-name");
	await expect(name).toBeVisible({ timeout: 15_000 });
	await guest.caption("Guest: opens it - just a name, no account", 500);
	await guest.type(name, "Priya Shah");
	await guest.click(guest.page.locator("button[type=submit]"));
	await guest.page.locator("[data-testid=toolbar]").waitFor({ timeout: 20_000 });
	await guest.tiles();
	guest.did("guest-join");

	await guest.caption("Guest: can look, but not change anything", 400);
	await guest.tool("Collaboration");
	const guestPanel = guest.panel("Collaboration");
	await expect(guestPanel.getByText("You're a guest - you can view")).toBeVisible({ timeout: 10_000 });
	await expect(guest.page.locator('[title="Collections"]')).toHaveCount(0);
	await guest.pause(1000);
	await closePanel(guest, "Collaboration");
	await guest.tool("Annotations");
	await expect(guest.panel("Annotations").getByRole("button", { name: "Free Form" })).toHaveCount(0);
	await guest.pause(700);
	await closePanel(guest, "Annotations");
	await guest.tool("Adjustments");
	await expect(guest.panel("Adjustments").getByText("Saving presets needs an account.")).toBeVisible();
	await guest.pause(1000);
	await closePanel(guest, "Adjustments");
	guest.did("guest-view-only");

	await sam.caption("Sam: sees them listed as a guest", 300);
	await sam.click(samPanel.getByRole("tab", { name: "Active (2)" }));
	const ask = samPanel.getByLabel("Ask Priya Shah to make an account so they can edit");
	await expect(ask).toBeVisible({ timeout: 10_000 });
	await sam.pause(1200);
	sam.did("guest-listed");

	await sam.caption("Sam: asks them to edit", 300);
	await guest.caption("Guest: needs an account first", 200);
	await sam.click(ask);
	await answerDialog(guest, "Not now");
	guest.did("guest-ask-edit");

	await guest.caption("Guest: leaves, and their name goes with them", 400);
	await guest.tool("Collaboration");
	await guest.press("Leave", guest.panel("Collaboration").locator(".realtime-account"));
	await expect(guest.page.getByText("You've left the session")).toBeVisible({ timeout: 10_000 });
	await expect(samPanel.getByRole("tab", { name: "Active (1)" })).toBeVisible({ timeout: 15_000 });
	await sam.pause(1400);
	guest.did("guest-leave");
}

// How much of a colour a preview has in it, so a preview showing the wrong thing fails.
function previewHas(card, [red, green, blue]) {
	return card.locator("canvas").evaluate(
		(canvas, colour) => {
			const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
			let found = 0;
			for (let i = 0; i < data.length; i += 4) {
				if (Math.abs(data[i] - colour[0]) < 40 && Math.abs(data[i + 1] - colour[1]) < 40 && Math.abs(data[i + 2] - colour[2]) < 40) found++;
			}
			return found;
		},
		[red, green, blue],
	);
}

// Asks who to, then writes something and sends it.
async function sendToJo(sam, words) {
	const panel = sam.panel("Messages");
	await sam.type(panel.locator(".messages-search"), "Jo Bell");
	await sam.click(panel.locator(".messages-picker-list .messages-row").filter({ hasText: "Jo Bell" }));
	await writeAndSend(sam, words);
}

async function writeAndSend(sam, words) {
	const panel = sam.panel("Messages");
	await expect(panel.locator(".messages-staged")).toBeVisible();
	await sam.click(panel.locator(".messages-input"));
	await sam.type(panel.locator(".messages-input"), words);
	await sam.pause(300);
	await sam.page.keyboard.press("Enter");
	await expect(panel.locator(".messages-staged")).toHaveCount(0, { timeout: 10_000 });
	await sam.pause(600);
}

// Sending things to someone who isn't there with you: an annotation, a group of
// cell counts and the area you're looking at. Each arrives live, can be looked at
// without keeping it, and added as a copy.
export async function messaging({ sam, jo }) {
	await both(sam, jo, "draws an annotation and saves it", "is on the same slide, not in a session");
	await sam.zoomAt(TISSUE, 1);
	await sam.tiles();
	await sam.tool("Annotations");
	const annotations = sam.panel("Annotations");
	await sam.click(shape(annotations, "Rectangle"));
	await drawTwoClick(sam, around(MIDDLE, -40, -160), around(MIDDLE, 140, -30));
	await saveAnnotation(sam, "Tumour edge");

	await both(sam, jo, "presses Send on a saved annotation", "has nothing yet");
	await openSaved(sam, annotations, 1);
	await sam.click(row(annotations, "Tumour edge"));
	await sam.press("Send", annotations.locator(".saved-row--open"));
	const samMessages = sam.panel("Messages");
	await expect(samMessages.locator(".messages-chat-title")).toContainText("to");
	sam.did("message-send-saved");

	await sam.caption("Sam: it asks who to - anyone with an account, online or not", 300, { keepOthers: true });
	await sendToJo(sam, "Can you look at this edge?");
	sam.did("message-search");
	sam.did("message-send-annotation");

	await both(sam, jo, "has sent it", "a badge and a toast, without reloading");
	await expect(jo.page.locator(".toolbar-badge")).toHaveText("1", { timeout: 10_000 });
	await expect(toast(jo, "New message from Sam Reid")).toBeVisible();
	jo.did("message-live");
	await jo.pause(1500);

	await jo.click(jo.page.locator('[title^="Messages"]'), 700);
	const joMessages = jo.panel("Messages");
	await dragPanel(jo, "Messages", { x: 560, y: 70 });
	await jo.click(joMessages.locator(".messages-side .messages-row").filter({ hasText: "Sam Reid" }));
	await expect(jo.page.locator(".toolbar-badge")).toHaveCount(0, { timeout: 10_000 });
	jo.did("message-inbox");

	const edge = joMessages.locator(".messages-card").filter({ hasText: "Tumour edge" });
	await expect(edge.locator("canvas")).toBeVisible({ timeout: 10_000 });
	await both(sam, jo, "waits", "sees a preview of that part of the slide, in its own colours");
	await expect.poll(() => previewHas(edge, SAVED_YELLOW), { timeout: 10_000 }).toBeGreaterThan(50);
	jo.did("message-preview");
	await jo.pause(2000);

	await both(sam, jo, "waits", "presses it - the map goes there, nothing saved");
	const joZoom = await jo.zoomLevel();
	await jo.click(edge.locator("button.messages-preview"));
	await expect.poll(() => jo.zoomLevel()).not.toBe(joZoom);
	await expect(edge.getByRole("button", { name: "Stop showing" })).toBeVisible();
	await jo.tiles();
	jo.did("message-view");
	await jo.pause(2000);

	await both(sam, jo, "waits", "adds a copy to their own collection");
	await jo.press("Add to my collection", edge);
	await expect(edge.getByRole("button", { name: "Add again" })).toBeVisible({ timeout: 10_000 });
	jo.did("message-add");
	await jo.pause(1500);

	await both(sam, jo, "waits", "folds the list away for more of the slide");
	const wide = (await joMessages.boundingBox()).width;
	await jo.press("Fold the list away", joMessages);
	await expect.poll(async () => (await joMessages.boundingBox()).width).toBeLessThan(wide);
	await jo.pause(900);
	await jo.press("Show the list", joMessages);
	await expect.poll(async () => (await joMessages.boundingBox()).width).toBe(wide);
	jo.did("message-fold");

	// A group of cell counts
	await both(sam, jo, "counts some cells, and saves two counts", "waits");
	await closePanel(sam, "Annotations");
	await closePanel(sam, "Messages");
	await sam.tool("Cell Count");
	const counts = sam.panel("Cell Count");
	for (const [name, from, to] of [
		["Field 1", 0, 5],
		["Field 2", 5, 10],
	]) {
		await sam.press("Start counting", counts);
		await countDots(sam, MIDDLE, DOTS.slice(from, to));
		await sam.press("Stop counting", counts);
		await fillName(sam, "Name this count", name);
		await sam.press("Save", counts.locator(".cell-count-form"));
		await sam.pause(700);
		await sam.click(counts.locator(".cell-counter-tool-picker-colour-card button").nth(2));
	}

	await both(sam, jo, "makes a group and puts them in it", "waits");
	await openSaved(sam, counts, 2);
	await sam.click(counts.locator(".saved-count-groups summary"));
	await sam.type(counts.getByLabel("New group name"), "Mitoses");
	await sam.press("Add", counts.locator(".saved-count-groups form"));
	const group = counts.locator(".saved-count-groups .select-group").filter({ hasText: "Mitoses" });
	await expect(group).toBeVisible();
	sam.did("count-group-make");
	for (const name of ["Field 1", "Field 2"]) {
		await sam.click(row(counts, name));
		await sam.choose(counts.locator(".saved-row--open .saved-row-group"), { label: "Mitoses" });
		await expect(counts.locator(".saved-row--open .saved-row-summary")).toContainText("Mitoses");
		await sam.pause(500);
	}
	await expect(group.locator(".select-group-count")).toHaveText("2", { timeout: 10_000 });
	sam.did("count-group-move");

	await both(sam, jo, "sends the whole group", "waits");
	await sam.press("Send", group);
	await sendToJo(sam, "And these two counts");
	sam.did("message-send-count-group");

	await both(sam, jo, "has sent it", "it turns up in the open conversation, each dot in its colour");
	const mitoses = joMessages.locator(".messages-card").filter({ hasText: "Mitoses" });
	await expect(mitoses.locator("canvas")).toBeVisible({ timeout: 15_000 });
	await jo.pause(2000);
	await jo.click(mitoses.locator("button.messages-preview"));
	await expect(mitoses.getByRole("button", { name: "Stop showing" })).toBeVisible();
	await jo.tiles();
	await jo.pause(2000);

	await both(sam, jo, "waits", "adds it - it arrives as a group, with both counts in it");
	await jo.press("Add to my collection", mitoses);
	await expect(mitoses.getByRole("button", { name: "Add again" })).toBeVisible({ timeout: 10_000 });
	await jo.tool("Cell Count");
	const joCounts = jo.panel("Cell Count");
	await openSaved(jo, joCounts, 2);
	await jo.click(joCounts.locator(".saved-count-groups summary"));
	await expect(joCounts.locator(".saved-count-groups .select-group").filter({ hasText: "Mitoses" }).locator(".select-group-count")).toHaveText("2", {
		timeout: 10_000,
	});
	jo.did("message-add-group");
	await jo.pause(2000);
	await closePanel(jo, "Cell Count");

	// The area you're looking at
	await both(sam, jo, "goes somewhere, and sends where they are", "waits");
	await closePanel(sam, "Cell Count");
	await dragPanel(sam, "Messages", { x: 560, y: 70 });
	// Clear of the panel, which would take the scroll instead of the map.
	await sam.zoomAt({ x: 200, y: 600 }, 4);
	await sam.press("Attach an area or an invite", samMessages);
	await sam.click(samMessages.getByRole("menuitem", { name: "The area you're looking at" }));
	await writeAndSend(sam, "This bit here");
	sam.did("message-send-area");

	await both(sam, jo, "is looking here", "presses it, and lands on the same spot");
	const area = joMessages.locator(".messages-card").filter({ hasText: "Area of slide" });
	await expect(area.locator("canvas")).toBeVisible({ timeout: 15_000 });
	await jo.pause(2000);
	await jo.click(area.locator("button.messages-preview"));
	await expect.poll(() => jo.zoomLevel(), { timeout: 8000 }).toBe(await sam.zoomLevel());
	await jo.tiles();
	jo.did("message-view-area");
	await jo.pause(3500);

	await both(sam, jo, "is done", "stops showing it, and nothing was left on the map");
	await jo.press("Stop showing", area);
	await expect(area.getByRole("button", { name: "View", exact: true })).toBeVisible();
	jo.did("message-stop-showing");
	await jo.pause(1200);
}
