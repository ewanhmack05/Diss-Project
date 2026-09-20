import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { applyControlPatch, defaultControlState, type BotControlState } from './control';
import type { SeedFile } from './data/seed';

// One message per bot tick - annotation/cellCount name the neuron the tick
// acted on, pathway names both ends of the connection it drew (see
// runTick.ts, which builds these from the exact same tick it's already
// posting to annotation-store, so the live feed and the persisted
// annotation always agree on what happened).
type BotEvent =
	| { type: 'annotation'; tick: number; neuronId: string; timestamp: string }
	| { type: 'cellCount'; tick: number; neuronId: string; timestamp: string }
	| { type: 'pathway'; tick: number; preId: string; postId: string; timestamp: string };

interface LiveServer {
	port: number;
	// The live, mutable state runTick reads every tick (see runTick.ts's
	// TickContext.control) - handing out the same reference the HTTP
	// handlers below mutate in place means a control change takes effect on
	// the very next tick, no polling or event-subscription needed on
	// runTick's side.
	control: BotControlState;
	broadcast: (event: BotEvent) => void;
	close: () => Promise<void>;
}

// Wide open rather than scoped to image-viewer's own origin - this only
// ever serves the public seed data and ephemeral tick events, nothing a
// browser couldn't already download straight from the public FlyWire
// release itself, so there's no origin worth restricting. POST/Content-Type
// added (beyond the original GET-only set) for the control endpoint below.
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
} as const;

const MAX_CONTROL_BODY_BYTES = 8192;

function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let received = 0;
		const chunks: Buffer[] = [];
		req.on('data', (chunk: Buffer) => {
			received += chunk.length;
			if (received > MAX_CONTROL_BODY_BYTES) {
				reject(new Error('body too large'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => {
			try {
				resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')));
			} catch {
				reject(new Error('invalid JSON'));
			}
		});
		req.on('error', reject);
	});
}

// A dedicated HTTP+WebSocket server run by the bot itself, separate from
// annotation-store, so the "is this happening right now" signal doesn't
// wait on annotation-store's own polling cadence and doesn't require
// touching a service outside this one. GET /seed hands the whole seed file
// to whichever visualization wants it (the live 3D connectome panel);
// the WebSocket upgrade on the same port pushes one BotEvent per tick;
// GET/POST /control read and patch the bot's live annotationsEnabled/
// cellCountEnabled/region state (see control.ts).
function startLiveServer(seed: SeedFile, port: number, initialSlideId: string | null = null): Promise<LiveServer> {
	return new Promise((resolve, reject) => {
		const control = defaultControlState(initialSlideId);

		const httpServer = createServer((req, res) => {
			if (req.method === 'OPTIONS') {
				res.writeHead(204, CORS_HEADERS);
				res.end();
				return;
			}
			if (req.method === 'GET' && req.url === '/seed') {
				res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
				res.end(JSON.stringify(seed));
				return;
			}
			if (req.method === 'GET' && req.url === '/control') {
				res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
				res.end(JSON.stringify(control));
				return;
			}
			if (req.method === 'POST' && req.url === '/control') {
				readJsonBody(req)
					.then((body) => {
						const next = applyControlPatch(control, body);
						if (next === null) {
							res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
							res.end(JSON.stringify({ error: 'invalid control patch' }));
							return;
						}
						Object.assign(control, next);
						res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
						res.end(JSON.stringify(control));
					})
					.catch(() => {
						res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'invalid request body' }));
					});
				return;
			}
			res.writeHead(404, CORS_HEADERS);
			res.end();
		});

		const wss = new WebSocketServer({ server: httpServer });

		httpServer.once('error', reject);
		httpServer.listen(port, () => {
			const address = httpServer.address();
			const actualPort = typeof address === 'object' && address !== null ? address.port : port;

			resolve({
				port: actualPort,
				control,
				broadcast: (event) => {
					const message = JSON.stringify(event);
					for (const client of wss.clients) {
						if (client.readyState === WebSocket.OPEN) client.send(message);
					}
				},
				close: () =>
					new Promise((resolveClose) => {
						wss.close(() => httpServer.close(() => resolveClose()));
					}),
			});
		});
	});
}

export { startLiveServer };
export type { BotEvent, LiveServer };
