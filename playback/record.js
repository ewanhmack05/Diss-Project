// Records the viewer being used and saves each walkthrough as an MP4.
// See README.md.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { freemem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Actor } from "./lib/actor.js";
import { enoughMemory, mergeManifest, parseArgs, pickScenes } from "./lib/options.js";
import { installOverlay } from "./lib/overlay.js";
import { collectionsToDelete, ensurePeople, PASSWORD, PEOPLE, removePeople } from "./lib/people.js";
import { encode, probe, requireTools, sideBySideArgs, singleArgs, videoProblems } from "./lib/video.js";
import { coverageGaps, FEATURES, NOT_SHOWN } from "./lib/coverage.js";
import { SCENES, SLIDE } from "./scenes/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELP = `Records the viewer being used and saves each walkthrough as an MP4.

  node record.js                     every scene
  node record.js --only ruler        just these (space separated)
  node record.js --list              the scenes
  node record.js --clean             remove the recording users and what they made
  --out DIR                          where the videos go (default videos/)
  --headed                           show the browser while it records
  --url, --keycloak, --realm, --admin-user, --admin-password
`;

// Each with its port, so a stopped service gets named rather than timing out
// part way through a scene.
const NEEDED = [
	["auth (Keycloak)", 8080],
	["tiler", 5095],
	["annotation-store", 5252],
	["realtime-hub", 5180],
	["messaging", 5260],
];

function portOpen(port, host = "127.0.0.1") {
	return new Promise((done) => {
		const socket = connect({ port, host, timeout: 1000 });
		socket.once("connect", () => {
			socket.destroy();
			done(true);
		});
		socket.once("error", () => done(false));
		socket.once("timeout", () => {
			socket.destroy();
			done(false);
		});
	});
}

async function checkServices(options) {
	const viewerPort = Number(new URL(options.url).port || 443);
	const missing = [];
	for (const [name, port] of [["viewer", viewerPort], ...NEEDED]) {
		// Vite listens on localhost, which can be IPv6 only.
		if (!(await portOpen(port)) && !(await portOpen(port, "::1"))) missing.push(`${name} on port ${port}`);
	}
	if (missing.length) throw new Error(`Not running: ${missing.join(", ")}. Start them with: python scripts/run_all.py`);
}

async function signIn(page, options, person) {
	await page.goto(`${options.url}/`);
	await page.locator("#username").waitFor({ timeout: 30_000 });
	await page.fill("#username", person.username);
	await page.fill("#password", PASSWORD);
	await page.click("#kc-login");
	await page.locator("[data-testid=toolbar]").waitFor({ timeout: 30_000 });
}

// Back to nothing, so a video shows the same thing each run. Deleting their own
// collection takes its history too - the viewer makes a new one on the next load.
async function resetPerson(browser, options, person) {
	const context = await browser.newContext({ ignoreHTTPSErrors: true });
	const page = await context.newPage();
	try {
		await signIn(page, options, person);
		// Every slide, since the gallery scenes move between them.
		const owned = await page.evaluate(async (fallback) => {
			const key = Object.keys(sessionStorage).find((name) => name.startsWith("oidc.user:"));
			const token = JSON.parse(sessionStorage.getItem(key)).access_token;
			const listed = await fetch("/tiler/slides");
			const slides = listed.ok ? (await listed.json()).map((slide) => slide.id) : [fallback];
			const collections = [];
			for (const slide of slides) {
				const response = await fetch(`/store/collections?slideId=${encodeURIComponent(slide)}`, { headers: { Authorization: `Bearer ${token}` } });
				if (!response.ok) throw new Error(`listing collections on ${slide}: ${response.status}`);
				collections.push(...(await response.json()));
			}
			return { token, collections };
		}, SLIDE);
		for (const id of collectionsToDelete(owned.collections)) {
			const status = await page.evaluate(
				async ({ id, token }) => {
					const response = await fetch(`/store/collections/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
					return response.status;
				},
				{ id, token: owned.token },
			);
			if (status >= 300) throw new Error(`deleting collection ${id}: ${status}`);
		}
		// Their conversations too, which aren't in a collection. One goes once both
		// have deleted it, and each person resets in turn.
		await page.evaluate(async (token) => {
			const headers = { Authorization: `Bearer ${token}` };
			const response = await fetch("/messaging/conversations", { headers });
			if (!response.ok) throw new Error(`listing conversations: ${response.status}`);
			for (const conversation of await response.json()) {
				const gone = await fetch(`/messaging/conversations/${conversation.id}`, { method: "DELETE", headers });
				if (!gone.ok) throw new Error(`deleting conversation ${conversation.id}: ${gone.status}`);
			}
		}, owned.token);
	} finally {
		await context.close();
	}
}

async function recordScene(browser, scene, options, outDir) {
	const names = scene.cast;
	const together = names.length > 1;
	const size = together ? { width: 960, height: 900 } : { width: 1600, height: 900 };
	for (const name of names) {
		if (PEOPLE[name]) await resetPerson(browser, options, PEOPLE[name]);
	}

	const rawDir = join(outDir, ".raw", scene.name);
	rmSync(rawDir, { recursive: true, force: true });
	const errors = [];
	const cast = [];
	const shown = new Set();
	for (const name of names) {
		const context = await browser.newContext({
			ignoreHTTPSErrors: true,
			viewport: size,
			recordVideo: { dir: rawDir, size },
			permissions: ["clipboard-read", "clipboard-write"],
		});
		await context.addInitScript(installOverlay);
		const openedAt = Date.now();
		const page = await context.newPage();
		page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
		// A control that's gone should fail fast, not sit there on video.
		page.setDefaultTimeout(15_000);
		const actor = new Actor(page, name, shown);
		if (PEOPLE[name]) {
			await signIn(page, options, PEOPLE[name]);
			await actor.tiles();
		}
		cast.push({ context, page, actor, openedAt });
	}

	for (const member of cast) member.actor.others = cast.filter((other) => other !== member).map((other) => other.actor);

	const startedAt = Date.now();
	let failure = null;
	try {
		await scene.run(Object.fromEntries(names.map((name, i) => [name, cast[i].actor])), options);
		await cast[0].actor.pause(1200);
		if (errors.length) throw new Error(`The page threw: ${errors.join("; ")}`);
	} catch (error) {
		failure = error;
		mkdirSync(join(outDir, "failed"), { recursive: true });
		await Promise.all(cast.map(({ page }, i) => page.screenshot({ path: join(outDir, "failed", `${scene.name}-${names[i]}.png`) }).catch(() => {})));
	}
	for (const { context } of cast) await context.close();
	if (failure) throw failure;

	const inputs = await Promise.all(cast.map(({ page }) => page.video().path()));
	const skips = cast.map(({ openedAt }) => startedAt - openedAt);
	const output = join(outDir, `${scene.name}.mp4`);
	await encode(together ? sideBySideArgs(inputs, output, skips) : singleArgs(inputs[0], output, skips[0]));
	rmSync(rawDir, { recursive: true, force: true });

	const info = await probe(output);
	const width = together ? size.width * 2 : size.width;
	const problems = videoProblems(info, { width, height: size.height, minSeconds: scene.minSeconds ?? 5 });
	if (problems.length) throw new Error(`${output}: ${problems.join(", ")}`);
	return {
		scene: scene.name,
		title: scene.title,
		file: `${scene.name}.mp4`,
		seconds: Number(info.seconds.toFixed(1)),
		sizeMb: Number((info.bytes / (1024 * 1024)).toFixed(1)),
		width: info.width,
		height: info.height,
		shows: [...shown].sort(),
	};
}

// What the videos on disk actually proved, from the manifest.
function printCoverage(manifestPath) {
	const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { videos: [] };
	const shown = manifest.videos.flatMap((video) => video.shows ?? []);
	const { missing } = coverageGaps(shown);
	const total = Object.keys(FEATURES).length;
	console.log(`\nCoverage: ${total - missing.length} of ${total} features shown in the saved videos`);
	for (const id of missing) console.log(`  not yet: ${id} - ${FEATURES[id]}`);
	console.log(`Not shown on purpose: ${Object.keys(NOT_SHOWN).join(", ")}`);
}

function commit() {
	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", cwd: HERE }).trim();
	} catch {
		return null;
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log(HELP);
		return 0;
	}
	if (options.list) {
		for (const scene of SCENES) console.log(`${scene.name.padEnd(14)} ${scene.title}`);
		return 0;
	}
	const scenes = pickScenes(SCENES, options.only);
	await checkServices(options);

	const browser = await chromium.launch({
		channel: "chrome",
		headless: !options.headed,
		args: ["--ignore-gpu-blocklist", "--enable-webgl"],
	});
	try {
		if (options.clean) {
			await ensurePeople(options);
			for (const person of Object.values(PEOPLE)) await resetPerson(browser, options, person);
			console.log(`Removed ${await removePeople(options)} recording users and what they made`);
			return 0;
		}

		await requireTools();
		const made = await ensurePeople(options);
		if (made) console.log(`Made ${made} recording users`);

		const outDir = resolve(HERE, options.out);
		mkdirSync(outDir, { recursive: true });
		// Left behind if a run was cut short.
		rmSync(join(outDir, ".raw"), { recursive: true, force: true });
		const manifestPath = join(outDir, "manifest.json");
		const order = SCENES.map((scene) => scene.name);
		const note = (result) => {
			const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
			const merged = mergeManifest(existing, result, order, new Date().toISOString());
			// Written after every scene, so a run that dies keeps what it finished.
			writeFileSync(manifestPath, JSON.stringify({ ...merged, commit: commit() }, null, 2) + "\n");
		};

		let saved = 0;
		const failed = [];
		for (const scene of scenes) {
			const free = freemem();
			const freeGb = (free / 1024 ** 3).toFixed(1);
			if (!enoughMemory(free)) throw new Error(`Stopping before ${scene.name} - only ${freeGb} GB of memory free`);
			const start = Date.now();
			process.stdout.write(`${scene.name.padEnd(18)} `);
			try {
				const result = await recordScene(browser, scene, options, outDir);
				note(result);
				saved++;
				console.log(`ok - ${result.seconds}s, ${result.sizeMb} MB (took ${Math.round((Date.now() - start) / 1000)}s, ${freeGb} GB free at start)`);
			} catch (error) {
				note({ scene: scene.name, failed: true });
				failed.push(scene.name);
				// Playwright colours its errors. The stack says which line of the scene.
				const plain = error.stack.replace(/\x1b\[[0-9;]*m/g, "");
				const where = plain.split("\n").find((line) => line.includes("scenes\\") || line.includes("scenes/"));
				console.log(`FAILED - ${plain.split("\n").slice(0, 8).join(" | ").slice(0, 700)}\n  ${where?.trim() ?? ""}`);
			}
		}
		rmSync(join(outDir, ".raw"), { recursive: true, force: true });
		console.log(`\n${saved} saved to ${outDir}${failed.length ? `, failed: ${failed.join(", ")}` : ""}`);
		printCoverage(manifestPath);
		return failed.length ? 1 : 0;
	} finally {
		await browser.close();
	}
}

main().then(
	(code) => process.exit(code),
	(error) => {
		console.error(error.message);
		process.exit(1);
	},
);
