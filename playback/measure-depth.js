// Measures the two numbers docs/zstack.md promised for volumes, in the real
// viewer: tiles fetched and time until sharp on a slice change (phase 3),
// and the 3D view's frame rate while the cut moves (phase 6).
//
//   node measure-depth.js            # headless Chrome
//   node measure-depth.js --headed   # a window, on the real GPU
//
// Needs the stack running (python scripts/run_all.py) and the liver volume.
// Signs in as the recording's Sam, so run node record.js once first.
import { chromium } from "playwright";
import { PASSWORD, PEOPLE } from "./lib/people.js";
import { frameStats, quietAfter } from "./lib/measure.js";

const URL_BASE = "https://localhost:5173";
const VOLUME = "liver";
const STEPS = 10;
// A step is sharp once no tile has come in for this long.
const QUIET_MS = 400;
const CUT_MS = 5000;

const headed = process.argv.includes("--headed");
const browser = await chromium.launch({ channel: "chrome", headless: !headed, args: ["--ignore-gpu-blocklist", "--enable-webgl"] });
try {
	const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 900 } })).newPage();
	await page.goto(`${URL_BASE}/?slide=${VOLUME}`);
	await page.locator("#username").waitFor({ timeout: 30_000 });
	await page.fill("#username", PEOPLE.sam.username);
	await page.fill("#password", PASSWORD);
	await page.click("#kc-login");
	await page.locator("[data-testid=toolbar]").waitFor({ timeout: 30_000 });
	await page.waitForTimeout(3000);

	// Every tile response, timed, so each step's can be picked out after.
	const tiles = [];
	page.on("requestfinished", (request) => {
		if (/TileGroup\d+\//.test(request.url())) tiles.push({ at: Date.now(), slice: request.url().match(/slice\/(\d+)\//)?.[1] ?? "default" });
	});

	await page.click('[title="Depth - move through the slices"]');
	const depth = page.locator(".draggable-panel").filter({ has: page.locator(".draggable-panel-title", { hasText: /^Depth$/ }) });
	await depth.getByRole("button", { name: "Back to", exact: false }).waitFor();
	await page.waitForTimeout(2000);

	console.log(`Slice changes on ${VOLUME}, ${STEPS} steps with Next:`);
	const steps = [];
	for (let i = 0; i < STEPS; i++) {
		const next = depth.getByRole("button", { name: "Next", exact: true });
		if (await next.isDisabled()) await depth.getByRole("slider", { name: "Slice" }).fill("0");
		await page.waitForTimeout(QUIET_MS);
		const from = tiles.length;
		const clicked = Date.now();
		await next.click();
		await page.waitForTimeout(3000);
		const own = tiles.slice(from);
		steps.push({ requests: own.length, sharpMs: quietAfter(own.map((t) => t.at - clicked), QUIET_MS) });
	}
	const sharp = steps.map((s) => s.sharpMs).sort((a, b) => a - b);
	const requests = steps.map((s) => s.requests).sort((a, b) => a - b);
	console.log(`  tiles fetched per step: median ${requests[Math.floor(STEPS / 2)]}, min ${requests[0]}, max ${requests.at(-1)}`);
	console.log(`  sharp after: median ${sharp[Math.floor(STEPS / 2)]} ms, max ${sharp.at(-1)} ms (last tile in, ${QUIET_MS} ms quiet after)`);

	await depth.getByRole("button", { name: "3D", exact: true }).click();
	await page.locator(".volume-view canvas").waitFor({ timeout: 20_000 });
	await page.locator(".volume-view-status").waitFor({ state: "detached", timeout: 60_000 });
	const renderer = await page.evaluate(() => {
		const gl = document.createElement("canvas").getContext("webgl2");
		const info = gl?.getExtension("WEBGL_debug_renderer_info");
		return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
	});
	console.log(`3D view (${renderer}):`);

	const frames = (ms) =>
		page.evaluate(
			(ms) =>
				new Promise((resolve) => {
					const times = [];
					const start = performance.now();
					const tick = (now) => {
						times.push(now);
						if (now - start < ms) requestAnimationFrame(tick);
						else resolve(times);
					};
					requestAnimationFrame(tick);
				}),
			ms,
		);

	const still = frameStats(await frames(3000));
	console.log(`  still:       ${still.fps} fps, median frame ${still.median} ms, 95th ${still.p95} ms`);

	await depth.getByRole("button", { name: "X", exact: true }).click();
	const cut = depth.getByRole("slider", { name: "Where the cut is" });
	await cut.focus();
	// The cut sweeping back and forth a step a key press, while frames are timed.
	const timing = frames(CUT_MS);
	const until = Date.now() + CUT_MS;
	let right = true;
	let presses = 0;
	while (Date.now() < until) {
		await page.keyboard.press(right ? "ArrowRight" : "ArrowLeft");
		presses++;
		if (presses % 40 === 0) right = !right;
	}
	const cutting = frameStats(await timing);
	console.log(`  cut moving:  ${cutting.fps} fps, median frame ${cutting.median} ms, 95th ${cutting.p95} ms (${presses} cut changes)`);
} finally {
	await browser.close();
}
