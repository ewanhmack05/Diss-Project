// How long a change takes to reach everyone else in a session, through the real
// hub over WebSockets, as the viewer connects. Run by eval_latency.py, which signs
// the people in and starts the session - see docs/evaluation.md.
//
// One person sends annotation ops and everyone else in the room times them arriving.
// Everyone's in this one process on one machine, so they share a clock, but there's
// no real network in it, and timing many receivers in one process includes waiting
// for this process as well as the hub.
//
//   node scripts/eval_latency.mjs config.json

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "image-viewer", "package.json"));

const percentile = (ordered, fraction) => ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1))];

// Median and tail of a list of times.
function stats(values) {
	if (!values.length) return { count: 0, median: null, p95: null, p99: null, max: null };
	const ordered = [...values].sort((a, b) => a - b);
	return {
		count: ordered.length,
		median: percentile(ordered, 0.5),
		p95: percentile(ordered, 0.95),
		p99: percentile(ordered, 0.99),
		max: ordered.at(-1),
	};
}

// What an edit's op looks like from the viewer: the changed fields of an annotation.
function operation(id, sentAt) {
	return { kind: "update", entity: "annotation", id, data: { label: "Region 4 (checked)", notes: "Looks mitotic", colour: "#0913FB", sentAt } };
}

function viewport(rng) {
	const [x, y] = [rng() * 100000, -rng() * 100000];
	return { center: [x, y], resolution: 8, rotation: 0, extent: [x - 6400, y - 3600, x + 6400, y + 3600] };
}

async function connect(signalR, hub, token, sessionId, onOp, onViewport) {
	const connection = new signalR.HubConnectionBuilder()
		.withUrl(hub, { accessTokenFactory: () => token, transport: signalR.HttpTransportType.WebSockets, skipNegotiation: true })
		.configureLogging(signalR.LogLevel.None)
		.build();
	connection.on("AnnotationOp", onOp);
	connection.on("ViewportUpdated", onViewport);
	for (const name of ["UserJoined", "UserLeft", "ViewportChanged", "SketchUpdated", "NavigationChanged", "RoleChanged", "ScreenUpdated"])
		connection.on(name, () => {});
	await connection.start();
	await connection.invoke("JoinSession", sessionId);
	return connection;
}

async function measure(signalR, { hub, sessionId, tokens, ops, opsPerSecond, viewportsPerSecond }) {
	const toHub = [];
	const toEveryone = [];
	const fromHub = [];
	const wholeRoom = [];
	const pending = new Map();
	const onOp = (stamped) => {
		const now = performance.now();
		const wallNow = Date.now();
		const sent = pending.get(stamped.op.id);
		if (!sent) return;
		toEveryone.push(now - sent.at);
		fromHub.push(wallNow - Date.parse(stamped.serverTime));
		sent.waiting -= 1;
		if (sent.waiting === 0) {
			wholeRoom.push(now - sent.at);
			pending.delete(stamped.op.id);
		}
	};
	// Counted so a quiet run and a busy one can be told apart for certain: a viewport
	// that never arrives would look like a hub with nothing to slow it down.
	let viewportsReceived = 0;
	let viewportsSent = 0;
	let viewportErrors = 0;
	const connections = [];
	for (const token of tokens)
		connections.push(
			await connect(signalR, hub, token, sessionId, onOp, () => {
				viewportsReceived += 1;
			}),
		);
	const [sender, ...others] = connections;

	let seed = 1;
	const rng = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const moving = viewportsPerSecond
		? connections.map((connection) =>
				setInterval(() => {
					viewportsSent += 1;
					connection.send("UpdateViewport", viewport(rng)).catch(() => {
						viewportErrors += 1;
					});
				}, 1000 / viewportsPerSecond),
			)
		: [];
	await new Promise((resolve) => setTimeout(resolve, 1000));

	let lost = 0;
	for (let i = 0; i < ops; i++) {
		const id = crypto.randomUUID();
		const at = performance.now();
		pending.set(id, { at, waiting: others.length });
		const wallAt = Date.now();
		const stamped = await sender.invoke("SendAnnotationOp", operation(id, wallAt));
		toHub.push(Date.parse(stamped.serverTime) - wallAt);
		await new Promise((resolve) => setTimeout(resolve, 1000 / opsPerSecond));
	}
	await new Promise((resolve) => setTimeout(resolve, 2000));
	lost = pending.size;
	moving.forEach(clearInterval);
	await Promise.all(connections.map((connection) => connection.stop()));
	return {
		people: tokens.length,
		viewportsPerSecond,
		ops,
		received: toEveryone.length,
		expected: ops * others.length,
		opsNotReachingEveryone: lost,
		viewportsSent,
		viewportsReceived,
		viewportErrors,
		toEveryone: stats(toEveryone),
		wholeRoom: stats(wholeRoom),
		toHub: stats(toHub),
		fromHub: stats(fromHub),
	};
}

async function main(path) {
	const signalR = require("@microsoft/signalr");
	const config = JSON.parse(readFileSync(path, "utf8"));
	const result = await measure(signalR, config);
	writeFileSync(config.out, JSON.stringify(result));
	process.exit(0);
}

export { operation, percentile, stats, viewport };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv[2]);
