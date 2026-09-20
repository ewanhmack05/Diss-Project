import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { SeedFile } from './data/seed';
import { startLiveServer, type LiveServer } from './liveServer';

const SEED: SeedFile = {
	meta: { generatedAt: 'x', source: 'x', citation: 'x', neuronCount: 1, connectionCount: 0 },
	neurons: [{ id: 'a', label: 'PS180', superClass: 'central', side: null, neurotransmitter: null, x: 0, y: 0, z: 0 }],
	connections: [],
};

// port 0 - the OS assigns a free ephemeral port, so these tests never
// collide with a real bot instance or with each other running in parallel.
function start(): Promise<LiveServer> {
	return startLiveServer(SEED, 0);
}

function connect(server: LiveServer): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://localhost:${server.port}`);
		ws.once('open', () => resolve(ws));
		ws.once('error', reject);
	});
}

describe('startLiveServer', () => {
	let server: LiveServer | undefined;

	afterEach(async () => {
		await server?.close();
		server = undefined;
	});

	it('serves the seed file over GET /seed with CORS enabled', async () => {
		server = await start();
		const response = await fetch(`http://localhost:${server.port}/seed`);
		expect(response.status).toBe(200);
		expect(response.headers.get('access-control-allow-origin')).toBe('*');
		expect(await response.json()).toEqual(SEED);
	});

	it('answers an OPTIONS preflight with CORS headers and no body', async () => {
		server = await start();
		const response = await fetch(`http://localhost:${server.port}/seed`, { method: 'OPTIONS' });
		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBe('*');
	});

	it('404s any other path', async () => {
		server = await start();
		const response = await fetch(`http://localhost:${server.port}/nope`);
		expect(response.status).toBe(404);
	});

	it('delivers a broadcast event to a connected WebSocket client', async () => {
		server = await start();
		const client = await connect(server);
		const received = new Promise<string>((resolve) => client.once('message', (data) => resolve(data.toString())));

		server.broadcast({ type: 'pathway', tick: 5, preId: 'a', postId: 'b', timestamp: 'now' });

		expect(JSON.parse(await received)).toEqual({ type: 'pathway', tick: 5, preId: 'a', postId: 'b', timestamp: 'now' });
		client.close();
	});

	it('delivers the same broadcast to multiple connected clients', async () => {
		server = await start();
		const [clientA, clientB] = await Promise.all([connect(server), connect(server)]);
		const receivedA = new Promise<string>((resolve) => clientA.once('message', (data) => resolve(data.toString())));
		const receivedB = new Promise<string>((resolve) => clientB.once('message', (data) => resolve(data.toString())));

		server.broadcast({ type: 'annotation', tick: 1, neuronId: 'a', timestamp: 'now' });

		expect(await receivedA).toBe(await receivedB);
		clientA.close();
		clientB.close();
	});

	it('broadcasting with no connected clients does not throw', async () => {
		server = await start();
		expect(() => server!.broadcast({ type: 'cellCount', tick: 0, neuronId: 'a', timestamp: 'now' })).not.toThrow();
	});

	it('close() shuts the server down cleanly', async () => {
		server = await start();
		await server.close();
		await expect(fetch(`http://localhost:${server.port}/seed`)).rejects.toThrow();
		server = undefined;
	});

	it('GET /control returns the default state before anything has been posted', async () => {
		server = await start();
		const response = await fetch(`http://localhost:${server.port}/control`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ annotationsEnabled: true, cellCountEnabled: true, region: null, slideId: null });
	});

	it('starts with the given initial slideId when startLiveServer is passed one', async () => {
		server = await startLiveServer(SEED, 0, '003');
		const response = await fetch(`http://localhost:${server.port}/control`);
		expect(await response.json()).toEqual({ annotationsEnabled: true, cellCountEnabled: true, region: null, slideId: '003' });
	});

	it('POST /control patches the state and returns the full resulting state', async () => {
		server = await start();
		const response = await fetch(`http://localhost:${server.port}/control`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ annotationsEnabled: false }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ annotationsEnabled: false, cellCountEnabled: true, region: null, slideId: null });
	});

	it('POST /control can report which slide is open, and GET reflects it', async () => {
		server = await start();
		const response = await fetch(`http://localhost:${server.port}/control`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ slideId: '003' }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ slideId: '003' });
		expect(server.control.slideId).toBe('003');
	});

	it('POST /control rejects a non-string slideId and leaves the state unchanged', async () => {
		server = await start();
		const response = await fetch(`http://localhost:${server.port}/control`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ slideId: 3 }),
		});
		expect(response.status).toBe(400);
		expect(server.control.slideId).toBeNull();
	});

	it('a POST /control patch is reflected by a following GET /control', async () => {
		server = await start();
		await fetch(`http://localhost:${server.port}/control`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ region: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } }),
		});
		const response = await fetch(`http://localhost:${server.port}/control`);
		expect(await response.json()).toMatchObject({ region: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } });
	});

	it('and the exact same object handed back by startLiveServer reflects that patch too, live', async () => {
		server = await start();
		await fetch(`http://localhost:${server.port}/control`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ cellCountEnabled: false }),
		});
		expect(server.control.cellCountEnabled).toBe(false);
	});

	it('POST /control with an invalid patch returns 400 and leaves the state unchanged', async () => {
		server = await start();
		const response = await fetch(`http://localhost:${server.port}/control`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ annotationsEnabled: 'yes' }),
		});
		expect(response.status).toBe(400);
		expect(server.control.annotationsEnabled).toBe(true);
	});

	it('POST /control with malformed JSON returns 400 rather than crashing the server', async () => {
		server = await start();
		const response = await fetch(`http://localhost:${server.port}/control`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{not json',
		});
		expect(response.status).toBe(400);
	});

	it('OPTIONS preflight for /control allows POST and Content-Type', async () => {
		server = await start();
		const response = await fetch(`http://localhost:${server.port}/control`, { method: 'OPTIONS' });
		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-methods')).toContain('POST');
		expect(response.headers.get('access-control-allow-headers')).toContain('Content-Type');
	});
});
