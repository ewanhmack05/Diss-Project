import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, loadSeed } from './config';
import type { SeedFile } from './data/seed';

describe('loadConfig', () => {
	it('falls back to sensible defaults when nothing is set', () => {
		const config = loadConfig({}, '/default/seed.json');
		expect(config).toEqual({
			annotationStoreUrl: 'http://localhost:5252',
			tilerUrl: 'http://localhost:5095',
			slideId: '000',
			userId: '001',
			intervalMs: 4000,
			seedPath: '/default/seed.json',
			livePort: 5300,
		});
	});

	it('lets every value be overridden by its env var', () => {
		const config = loadConfig(
			{
				ANNOTATION_STORE_URL: 'http://store:1',
				TILER_URL: 'http://tiler:2',
				SLIDE_ID: '003',
				BOT_USER_ID: 'bot-flywire',
				BOT_INTERVAL_MS: '5000',
				SEED_PATH: '/custom/seed.json',
				BOT_LIVE_PORT: '6000',
			},
			'/default/seed.json',
		);
		expect(config).toEqual({
			annotationStoreUrl: 'http://store:1',
			tilerUrl: 'http://tiler:2',
			slideId: '003',
			userId: 'bot-flywire',
			intervalMs: 5000,
			seedPath: '/custom/seed.json',
			livePort: 6000,
		});
	});
});

describe('loadSeed', () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it('parses a seed file and returns it', () => {
		dir = mkdtempSync(join(tmpdir(), 'flywire-bot-test-'));
		const path = join(dir, 'seed.json');
		const seed: SeedFile = {
			meta: { generatedAt: 'x', source: 'x', citation: 'x', neuronCount: 1, connectionCount: 0 },
			neurons: [{ id: 'a', label: 'PS180', superClass: 'central', side: null, neurotransmitter: null, x: 0, y: 0, z: 0 }],
			connections: [],
		};
		writeFileSync(path, JSON.stringify(seed));

		expect(loadSeed(path)).toEqual(seed);
	});

	it('throws a clear error when the seed has no neurons', () => {
		dir = mkdtempSync(join(tmpdir(), 'flywire-bot-test-'));
		const path = join(dir, 'seed.json');
		writeFileSync(path, JSON.stringify({ meta: {}, neurons: [], connections: [] }));

		expect(() => loadSeed(path)).toThrow(/no neurons/);
	});
});
